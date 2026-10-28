/* Two-player Contigo duel.
   Signal grows like Hearthstone mana. Combat is attack-and-strike, not a block step.
   Bond Denial is a Secret. Protector stops weak enemies from attacking your other Companions. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ContigoEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STARTING_LIFE = 20;
  const MAX_SIGNAL = 10;
  const HAND_LIMIT = 7;
  const BOARD_LIMIT = 7;

  function createGame(options) {
    const rng = options.rng || Math.random;
    const catalog = new Map();
    (options.cards || []).forEach((card) => catalog.set(card.id, card));

    const names = options.playerNames || ["Player 1", "Player 2"];
    const decksIn = options.decks;
    if (!decksIn || decksIn.length !== 2) throw new Error("Two decks are required");

    const deckCopies = [decksIn[0].slice(), decksIn[1].slice()];
    deckCopies.forEach((deck) => {
      deck.forEach((id) => {
        if (!catalog.has(id)) throw new Error("Unknown card " + id);
      });
    });
    if (options.shuffle !== false) {
      shuffle(deckCopies[0], rng);
      shuffle(deckCopies[1], rng);
    }

    let first = options.firstPlayer;
    if (first !== 0 && first !== 1) first = rng() < 0.5 ? 0 : 1;

    const players = [0, 1].map((i) => ({
      index: i,
      name: cleanName(names[i], "Player " + (i + 1)),
      first: i === first,
      life: STARTING_LIFE,
      signal: 0,
      maxSignal: 0,
      fatigue: 0,
      turnCount: 0,
      nodesPlayed: 0,
      deck: deckCopies[i],
      hand: [],
      board: [],
      graveyard: [],
      secrets: [],
    }));

    let phase = "pass";
    let active = first;
    let pending = null;
    let winner = null;
    let winReason = "";
    let passTo = 0;
    let passPurpose = "mulligan-p0";
    let passMessage = "Pass the screen to " + players[0].name + " for the opening hand. Look away.";
    let mulliganPlayer = 0;
    const marked = new Set();
    const logs = [];
    let uidCounter = 1;

    for (let i = 0; i < 3; i++) drawOne(players[first], true);
    for (let i = 0; i < 4; i++) drawOne(players[1 - first], true);

    function newId() {
      uidCounter += 1;
      return "c" + uidCounter;
    }

    function log(message) {
      logs.push(message);
      if (logs.length > 80) logs.shift();
    }

    function def(id) {
      const card = catalog.get(id);
      if (!card) throw new Error("Unknown card " + id);
      return card;
    }

    function ok() {
      return { ok: true };
    }

    function fail(error) {
      return { ok: false, error };
    }

    function other(player) {
      return players[1 - player.index];
    }

    function activePlayer() {
      return players[active];
    }

    function parsePT(pt) {
      const match = /^(\d+)\/(\d+)$/.exec(pt || "");
      if (!match) return { power: 0, toughness: 0 };
      return { power: Number(match[1]), toughness: Number(match[2]) };
    }

    function kindOf(type) {
      if (type === "Companion") return "companion";
      if (type === "Node") return "node";
      if (type === "Bond") return "bond";
      return "action";
    }

    function rowLabel(kind) {
      if (kind === "companion") return "Companion";
      if (kind === "node") return "Node";
      return "Bond";
    }

    function countCard(player, id) {
      let n = 0;
      player.board.forEach((piece) => {
        if (piece.cardId === id) n += 1;
      });
      return n;
    }

    function countKind(player, kind) {
      let n = 0;
      player.board.forEach((piece) => {
        if (piece.kind === kind) n += 1;
      });
      return n;
    }

    function hasHaste(piece) {
      return !piece.vanilla && (piece.cardId === 9 || piece.cardId === 17);
    }

    function isSwift(piece) {
      return !piece.vanilla && piece.cardId === 9;
    }

    function isQuick(piece) {
      return !piece.vanilla && piece.cardId === 17;
    }

    function pieceName(piece) {
      const name = def(piece.cardId).name;
      return piece.token ? name + " token" : name;
    }

    function stats(owner, piece) {
      let power = piece.baseP + piece.bonusP;
      let toughness = piece.baseT + piece.bonusT;
      if (piece.kind === "companion") toughness += countCard(owner, 29);
      if (power < 0) power = 0;
      if (toughness < 0) toughness = 0;
      return {
        power,
        toughness,
        damage: piece.damage,
        hp: toughness - piece.damage,
      };
    }

    function findPiece(uid) {
      for (let i = 0; i < players.length; i++) {
        const piece = players[i].board.find((item) => item.uid === uid);
        if (piece) return { player: players[i], piece };
      }
      return null;
    }

    function checkWin() {
      if (phase === "over") return true;
      const dead = players.map((player) => player.life <= 0);
      if (!dead[0] && !dead[1]) return false;
      phase = "over";
      pending = null;
      if (dead[0] && dead[1]) {
        winner = null;
        winReason = "Both players reached 0 life.";
        log("The match is a draw.");
      } else if (dead[0]) {
        winner = 1;
        winReason = players[0].name + " reached 0 life.";
        log(players[1].name + " wins.");
      } else {
        winner = 0;
        winReason = players[1].name + " reached 0 life.";
        log(players[0].name + " wins.");
      }
      return true;
    }

    function drawOne(player, silent) {
      if (phase === "over") return;
      if (player.deck.length === 0) {
        player.fatigue += 1;
        player.life -= player.fatigue;
        log(player.name + " is out of cards and takes " + player.fatigue + " fatigue damage.");
        checkWin();
        return;
      }
      const cardId = player.deck.shift();
      player.hand.push({ uid: newId(), cardId });
      if (!silent) log(player.name + " draws a card.");
    }

    function modifiedCost(player, card) {
      let cost = card.cost || 0;
      if (card.type === "Companion") cost -= countCard(player, 27);
      if (card.type === "Action") cost -= countCard(player, 6);
      return cost < 0 ? 0 : cost;
    }

    function shieldedFrom(casterIndex, piece, ownerIndex) {
      if (piece.kind !== "companion") return false;
      if (casterIndex === ownerIndex) return false;
      return countCard(players[ownerIndex], 29) > 0;
    }

    function legalSpellTargets(caster, cardId) {
      const targets = [];
      if (cardId === 19) {
        targets.push({ type: "hero", player: 0 });
        targets.push({ type: "hero", player: 1 });
      }
      players.forEach((player) => {
        player.board.forEach((piece) => {
          if (piece.kind !== "companion") return;
          if (shieldedFrom(caster.index, piece, player.index)) return;
          if (cardId === 19 || cardId === 21) targets.push({ type: "minion", uid: piece.uid });
        });
      });
      return targets;
    }

    function attackTargets(piece, owner) {
      const foe = other(owner);
      const list = [{ type: "hero", player: foe.index }];
      const power = stats(owner, piece).power;
      const hasProtector = foe.board.some((item) => item.cardId === 14 && item.kind === "companion");
      foe.board.forEach((item) => {
        if (item.kind !== "companion") return;
        if (hasProtector && power <= 1 && item.cardId !== 14) return;
        list.push({ type: "minion", uid: item.uid });
      });
      return list;
    }

    function sameTarget(a, b) {
      if (!a || !b || a.type !== b.type) return false;
      if (a.type === "hero") return Number(a.player) === Number(b.player);
      return a.uid === b.uid;
    }

    function canAttack(piece, owner) {
      if (piece.kind !== "companion") return { ok: false, reason: "Only Companions can attack" };
      if (piece.tapped) return { ok: false, reason: "It already acted this turn" };
      const current = stats(owner, piece);
      if (current.power <= 0) return { ok: false, reason: "It has 0 attack" };
      if (piece.enteredTurn === owner.turnCount && !hasHaste(piece)) {
        return { ok: false, reason: "Summoning sickness" };
      }
      return { ok: true, reason: "" };
    }

    function sick(piece, owner) {
      return piece.kind === "companion" && piece.enteredTurn === owner.turnCount && !hasHaste(piece);
    }

    function abilities(piece, owner) {
      const list = [];
      const resting = piece.tapped ? "Already tapped" : "";
      const waiting = sick(piece, owner) ? "Summoning sickness" : "";
      if (piece.kind === "node" && piece.cardId !== 5) {
        list.push({
          id: "tap-signal",
          label: "Tap for 1 Signal",
          enabled: !piece.tapped,
          reason: resting,
        });
      }
      if (piece.cardId === 5) {
        list.push({
          id: "extension",
          label: "Tap: Signal or life",
          enabled: !piece.tapped,
          reason: resting,
        });
      }
      if (piece.cardId === 3) {
        const enabled = !piece.batteryUsed && owner.signal >= 1;
        list.push({
          id: "battery-life",
          label: "Pay 1 Signal: gain 1 life",
          enabled,
          reason: piece.batteryUsed ? "Already used this turn" : owner.signal < 1 ? "Not enough Signal" : "",
        });
      }
      if (piece.cardId === 10) {
        list.push({
          id: "tap-life",
          label: "Tap: gain 1 life",
          enabled: !piece.tapped && !waiting,
          reason: waiting || resting,
        });
      }
      if (piece.cardId === 13) {
        list.push({
          id: "loot",
          label: "Tap: draw, then discard",
          enabled: !piece.tapped && !waiting,
          reason: waiting || resting,
        });
      }
      return list;
    }

    function castCheck(player, card, duringResolve) {
      if (phase !== "play") return fail("Not your turn");
      if (!duringResolve && pending) return fail("Finish the current choice first");
      if (player.index !== active) return fail("Not your turn");
      const cost = modifiedCost(player, card);
      if (player.signal < cost) return fail("Not enough Signal");
      if (card.type === "Node" && player.nodesPlayed >= 1) return fail("You can only play one Node each turn");
      if (card.type !== "Action" && countKind(player, kindOf(card.type)) >= BOARD_LIMIT) {
        return fail("Your " + rowLabel(kindOf(card.type)) + " row is full");
      }
      if (card.id === 26 && countKind(player, "companion") >= BOARD_LIMIT) return fail("Your Companion row is full");
      if (card.id === 21 && legalSpellTargets(player, 21).length === 0) return fail("No companion to return");
      return { ok: true, cost };
    }

    function createPiece(player, card, extra) {
      const bonus = extra || {};
      const pt = parsePT(card.pt);
      return {
        uid: newId(),
        cardId: card.id,
        kind: bonus.kind || kindOf(card.type),
        token: !!bonus.token,
        vanilla: !!bonus.vanilla,
        baseP: bonus.baseP != null ? bonus.baseP : pt.power,
        baseT: bonus.baseT != null ? bonus.baseT : pt.toughness,
        bonusP: 0,
        bonusT: 0,
        damage: 0,
        tapped: false,
        enteredTurn: player.turnCount,
        batteryUsed: false,
      };
    }

    function cleanupDeaths() {
      const dead = [];
      players.forEach((player) => {
        player.board.forEach((piece) => {
          if (piece.kind !== "companion") return;
          const current = stats(player, piece);
          if (current.damage >= current.toughness) dead.push({ player, piece });
        });
      });
      dead.forEach(({ player, piece }) => {
        player.board = player.board.filter((item) => item.uid !== piece.uid);
        if (!piece.token) player.graveyard.push(piece.cardId);
        log(pieceName(piece) + " is destroyed.");
        if (piece.cardId === 15 && !piece.token) {
          player.life += 2;
          log(player.name + " gains 2 life.");
        }
      });
    }

    function triggerActionCast(player) {
      const copies = countCard(player, 30);
      for (let i = 0; i < copies; i++) {
        const foe = other(player);
        foe.life -= 1;
        player.life += 1;
        log(player.name + "'s Ally Network deals 1 damage and gains 1 life.");
        if (checkWin()) return true;
      }
      return false;
    }

    function tryCounter(caster, card) {
      const foe = other(caster);
      const index = foe.secrets.findIndex((secret) => secret.cardId === 24);
      if (index === -1) return false;
      const secret = foe.secrets.splice(index, 1)[0];
      foe.graveyard.push(secret.cardId);
      caster.graveyard.push(card.id);
      log("Bond Denial counters " + card.name + ".");
      return true;
    }

    function resolveEnter(player, piece) {
      if (piece.vanilla) return;
      if (piece.cardId === 4) {
        player.life += 1;
        log(player.name + " gains 1 life.");
        return;
      }
      if (piece.cardId === 7) {
        drawOne(player);
        return;
      }
      if (piece.cardId === 8) {
        if (countKind(player, "node") >= BOARD_LIMIT) {
          log("The Node row is full.");
          return;
        }
        const choices = player.hand
          .filter((handCard) => def(handCard.cardId).type === "Node")
          .map((handCard) => ({
            key: handCard.uid,
            cardId: handCard.cardId,
            label: def(handCard.cardId).name,
          }));
        if (!choices.length) {
          log("No Node is in hand.");
          return;
        }
        pending = {
          context: "put-node",
          cancellable: true,
          prompt: "You may put a Node from your hand onto the battlefield.",
          choices,
        };
        return;
      }
      if (piece.cardId === 11) {
        const others = player.board.filter((item) => item.kind === "companion" && item.uid !== piece.uid);
        if (!others.length) return;
        if (others.length === 1) {
          others[0].bonusP += 1;
          others[0].bonusT += 1;
          log(pieceName(piece) + " gives " + pieceName(others[0]) + " +1/+1.");
          return;
        }
        pending = {
          context: "buff",
          sourceUid: piece.uid,
          cancellable: false,
          prompt: "Put a +1/+1 counter on another Companion.",
          choices: others.map((item) => {
            const current = stats(player, item);
            return {
              key: item.uid,
              cardId: item.cardId,
              label: pieceName(item) + " (" + current.power + "/" + current.hp + ")",
            };
          }),
        };
        return;
      }
      if (piece.cardId === 12) {
        const foe = other(player);
        foe.life -= 1;
        log(foe.name + " takes 1 damage.");
        checkWin();
        return;
      }
      if (piece.cardId === 16) {
        if (countKind(player, "node") >= BOARD_LIMIT) {
          log("The Node row is full.");
          return;
        }
        const choices = [];
        player.deck.forEach((cardId, index) => {
          if (def(cardId).type === "Node") {
            choices.push({ key: String(index), cardId, label: def(cardId).name });
          }
        });
        if (!choices.length) {
          log("No Node is left in the library.");
          return;
        }
        pending = {
          context: "search-node",
          cancellable: false,
          prompt: "Search for a Node and put it onto the battlefield.",
          choices,
        };
      }
    }

    function resolveAction(player, card, target) {
      if (card.id === 19) {
        applySpellDamage(target, 3);
        if (phase === "over") return;
        if (player.board.some((piece) => piece.kind === "companion")) {
          log(player.name + " draws because they control a Companion.");
          drawOne(player);
        }
        return;
      }
      if (card.id === 20) {
        drawOne(player);
        if (phase === "over") return;
        drawOne(player);
        if (phase === "over") return;
        if (player.hand.length === 0) return;
        pending = {
          context: "discard-one",
          cancellable: false,
          prompt: "Discard a card.",
        };
        return;
      }
      if (card.id === 21) {
        const found = findPiece(target.uid);
        if (!found || found.piece.kind !== "companion") return;
        found.player.board = found.player.board.filter((item) => item.uid !== found.piece.uid);
        if (found.piece.token) {
          log(pieceName(found.piece) + " vanishes.");
          return;
        }
        found.player.hand.push({ uid: newId(), cardId: found.piece.cardId });
        log(pieceName(found.piece) + " returns to " + found.player.name + "'s hand.");
        return;
      }
      if (card.id === 22) {
        player.life += 3;
        const foe = other(player);
        foe.life -= 1;
        log(player.name + " gains 3 life. " + foe.name + " loses 1 life.");
        checkWin();
        return;
      }
      if (card.id === 23) {
        const count = Math.min(3, player.deck.length);
        if (count === 0) {
          log("The library is empty.");
          return;
        }
        const pile = player.deck.splice(0, count);
        pending = {
          context: "look-ahead",
          cancellable: false,
          pile,
          prompt: "Choose a card to keep. The rest go on the bottom of the library.",
          choices: pile.map((cardId, index) => ({
            key: String(index),
            cardId,
            label: def(cardId).name,
          })),
        };
        return;
      }
      if (card.id === 25) {
        const foe = other(player);
        foe.life -= 4;
        player.life += 2;
        log(foe.name + " takes 4 damage. " + player.name + " gains 2 life.");
        checkWin();
        return;
      }
      if (card.id === 26) {
        if (countKind(player, "companion") >= BOARD_LIMIT) {
          log("No room for a token.");
          return;
        }
        const token = createPiece(player, def(7), { token: true, vanilla: true, baseP: 2, baseT: 2 });
        player.board.push(token);
        log(player.name + " creates a 2/2 Loyal Companion Bot token.");
      }
    }

    function applySpellDamage(target, amount) {
      if (target.type === "hero") {
        const victim = players[target.player];
        victim.life -= amount;
        log(victim.name + " takes " + amount + " damage.");
        checkWin();
        return;
      }
      const found = findPiece(target.uid);
      if (!found) return;
      found.piece.damage += amount;
      log(pieceName(found.piece) + " takes " + amount + " damage.");
      cleanupDeaths();
      checkWin();
    }

    function commitCast(player, handCard, card, target) {
      player.signal -= modifiedCost(player, card);
      player.hand = player.hand.filter((item) => item.uid !== handCard.uid);
      log(player.name + " plays " + card.name + ".");
      if (card.type === "Node") player.nodesPlayed += 1;

      if (card.type === "Action") {
        if (tryCounter(player, card)) return ok();
        if (card.id === 24) {
          player.secrets.push({ uid: newId(), cardId: 24 });
          log(player.name + " sets a Secret.");
        } else {
          player.graveyard.push(card.id);
        }
        if (triggerActionCast(player)) return ok();
        if (card.id !== 24 && phase !== "over") resolveAction(player, card, target);
        return ok();
      }

      const piece = createPiece(player, card);
      player.board.push(piece);
      resolveEnter(player, piece);
      return ok();
    }

    function upkeep(player) {
      let lifeGain = 0;
      player.board.forEach((piece) => {
        if (piece.cardId === 18 && piece.kind === "companion") lifeGain += 1;
      });
      if (lifeGain) {
        player.life += lifeGain;
        log(player.name + " gains " + lifeGain + " life from Steady Holder.");
      }
      const presences = countCard(player, 28);
      for (let i = 0; i < presences; i++) {
        if (phase === "over") return;
        if (player.board.some((piece) => piece.kind === "companion")) {
          log(player.name + "'s Shared Presence draws a card.");
          drawOne(player, true);
        }
      }
    }

    function beginTurn(index) {
      const player = players[index];
      active = index;
      player.turnCount += 1;
      player.maxSignal = Math.min(MAX_SIGNAL, player.turnCount);
      player.signal = player.maxSignal;
      player.nodesPlayed = 0;
      player.board.forEach((piece) => {
        piece.tapped = false;
        piece.batteryUsed = false;
      });
      log("--- " + player.name + "'s turn (" + player.maxSignal + " Signal) ---");
      if (!(player.first && player.turnCount === 1)) drawOne(player);
      if (phase === "over") return;
      upkeep(player);
      if (phase !== "over") phase = "play";
    }

    function finishEndTurn() {
      players.forEach((player) => {
        player.board.forEach((piece) => {
          if (piece.kind === "companion") piece.damage = 0;
        });
      });
      const next = 1 - active;
      phase = "pass";
      passTo = next;
      passPurpose = "between";
      passMessage = "Pass the screen to " + players[next].name + ". Look away so their hand stays hidden.";
      pending = null;
    }

    function resolveCombat(attackerUid, target) {
      const found = findPiece(attackerUid);
      if (!found) return;
      const piece = found.piece;
      const owner = found.player;
      const current = stats(owner, piece);
      if (target.type === "hero") {
        const foe = players[target.player];
        log(pieceName(piece) + " attacks " + foe.name + " for " + current.power + ".");
        foe.life -= current.power;
        if (isQuick(piece) && current.power > 0 && phase !== "over") drawOne(owner);
        checkWin();
        return;
      }
      const defender = findPiece(target.uid);
      if (!defender || defender.piece.kind !== "companion") return;
      const back = stats(defender.player, defender.piece);
      log(pieceName(piece) + " attacks " + pieceName(defender.piece) + " for " + current.power + ".");
      if (back.power > 0) log(pieceName(defender.piece) + " strikes back for " + back.power + ".");
      piece.damage += back.power;
      defender.piece.damage += current.power;
      cleanupDeaths();
      if (isQuick(piece) && current.power > 0 && phase !== "over") drawOne(owner);
      if (isQuick(defender.piece) && back.power > 0 && phase !== "over") drawOne(defender.player);
      checkWin();
    }

    function playCard(handUid) {
      if (phase !== "play") return fail("Not your turn");
      if (pending) return fail("Finish the current choice first");
      const player = activePlayer();
      const handCard = player.hand.find((item) => item.uid === handUid);
      if (!handCard) return fail("That card isn't in your hand");
      const card = def(handCard.cardId);
      const check = castCheck(player, card, false);
      if (!check.ok) return check;
      if (card.id === 19 || card.id === 21) {
        const targets = legalSpellTargets(player, card.id);
        if (!targets.length) return fail(card.id === 21 ? "No companion to return" : "No legal target");
        pending = {
          context: "spell-target",
          handUid,
          cardId: card.id,
          cancellable: true,
          prompt: card.id === 19
            ? "Deal 3 damage. Choose a hero or a companion."
            : "Choose a companion to return to its owner's hand.",
        };
        return ok();
      }
      return commitCast(player, handCard, card, null);
    }

    function attack(uid) {
      if (phase !== "play") return fail("Not your turn");
      if (pending) return fail("Finish the current choice first");
      const player = activePlayer();
      const piece = player.board.find((item) => item.uid === uid);
      if (!piece) return fail("That companion isn't on your board");
      const status = canAttack(piece, player);
      if (!status.ok) return fail(status.reason);
      pending = {
        context: "attack",
        uid,
        cancellable: true,
        prompt: "Attack with " + pieceName(piece) + ". Choose an enemy hero or companion.",
      };
      return ok();
    }

    function activate(uid, abilityId) {
      if (phase !== "play") return fail("Not your turn");
      if (pending) return fail("Finish the current choice first");
      const player = activePlayer();
      const piece = player.board.find((item) => item.uid === uid);
      if (!piece) return fail("That card isn't on your board");
      const ability = abilities(piece, player).find((item) => item.id === abilityId);
      if (!ability) return fail("That ability isn't available");
      if (!ability.enabled) return fail(ability.reason || "You can't do that");

      if (abilityId === "tap-signal") {
        piece.tapped = true;
        player.signal += 1;
        log(pieceName(piece) + " adds 1 Signal.");
        return ok();
      }
      if (abilityId === "extension") {
        pending = {
          context: "extension",
          uid,
          cancellable: true,
          prompt: "Extension Cord: add 1 Signal or gain 1 life.",
          choices: [
            { key: "signal", label: "Add 1 Signal" },
            { key: "life", label: "Gain 1 life" },
          ],
        };
        return ok();
      }
      if (abilityId === "battery-life") {
        player.signal -= 1;
        piece.batteryUsed = true;
        player.life += 1;
        log(player.name + " pays 1 Signal and gains 1 life.");
        return ok();
      }
      if (abilityId === "tap-life") {
        piece.tapped = true;
        player.life += 1;
        log(pieceName(piece) + " gives " + player.name + " 1 life.");
        return ok();
      }
      if (abilityId === "loot") {
        piece.tapped = true;
        drawOne(player);
        if (phase === "over") return ok();
        if (player.hand.length === 0) return ok();
        pending = {
          context: "discard-one",
          cancellable: false,
          prompt: "Discard a card.",
        };
        return ok();
      }
      return fail("Unknown ability");
    }

    function endTurn() {
      if (phase !== "play") return fail("Not your turn");
      if (pending) return fail("Finish the current choice first");
      const player = activePlayer();
      if (player.hand.length > HAND_LIMIT) {
        pending = {
          context: "hand-limit",
          cancellable: true,
          held: [],
          prompt: discardPrompt(player.hand.length),
        };
        return ok();
      }
      finishEndTurn();
      return ok();
    }

    function discardPrompt(count) {
      return "Discard down to " + HAND_LIMIT + ". Choose " + (count - HAND_LIMIT) + " more.";
    }

    function concede() {
      if (phase !== "play") return fail("You can only concede on your turn");
      const loser = active;
      phase = "over";
      pending = null;
      winner = 1 - loser;
      winReason = players[loser].name + " conceded.";
      log(winReason);
      return ok();
    }

    function confirmMulligan() {
      if (phase !== "mulligan") return fail("Not reviewing a hand");
      const player = players[mulliganPlayer];
      const back = [];
      if (marked.size) {
        player.hand = player.hand.filter((handCard) => {
          if (!marked.has(handCard.uid)) return true;
          back.push(handCard.cardId);
          return false;
        });
        player.deck.push(...back);
        shuffle(player.deck, rng);
        for (let i = 0; i < back.length; i++) drawOne(player, true);
      }
      marked.clear();
      if (mulliganPlayer === 0) {
        phase = "pass";
        passTo = 1;
        passPurpose = "mulligan-p1";
        passMessage = "Pass the screen to " + players[1].name + " for the opening hand. Look away.";
      } else {
        phase = "pass";
        passTo = first;
        passPurpose = "start";
        passMessage = "Pass the screen to " + players[first].name + ". " + players[first].name + " goes first.";
      }
      return ok();
    }

    function toggleMulligan(uid) {
      if (phase !== "mulligan") return fail("Not reviewing a hand");
      const player = players[mulliganPlayer];
      if (!player.hand.some((handCard) => handCard.uid === uid)) return fail("That card isn't in the opening hand");
      if (marked.has(uid)) marked.delete(uid);
      else marked.add(uid);
      return ok();
    }

    function ready() {
      if (phase !== "pass") return fail("Nothing to continue");
      if (passPurpose === "mulligan-p0") {
        phase = "mulligan";
        mulliganPlayer = 0;
        marked.clear();
        return ok();
      }
      if (passPurpose === "mulligan-p1") {
        phase = "mulligan";
        mulliganPlayer = 1;
        marked.clear();
        return ok();
      }
      if (passPurpose === "start" || passPurpose === "between") {
        beginTurn(passTo);
        return ok();
      }
      return fail("Nothing to continue");
    }

    function answer(payload) {
      payload = payload || {};
      if (phase === "over") return fail("The match is over");
      if (!pending) return fail("Nothing to choose");
      const cancel = !!payload.cancel;
      if (cancel && !pending.cancellable) return fail("You can't cancel this");
      if (pending.context === "spell-target") return answerSpell(payload, cancel);
      if (pending.context === "attack") return answerAttack(payload, cancel);
      if (pending.context === "swift-draw") return answerSwift(payload);
      if (pending.context === "extension") return answerExtension(payload, cancel);
      if (pending.context === "discard-one") return answerDiscardOne(payload.key);
      if (pending.context === "hand-limit") return answerHandLimit(payload.key, cancel);
      if (pending.context === "look-ahead") return answerLook(payload);
      if (pending.context === "search-node") return answerSearch(payload);
      if (pending.context === "put-node") return answerPutNode(payload, cancel);
      if (pending.context === "buff") return answerBuff(payload);
      return fail("Unknown choice");
    }

    function answerSpell(payload, cancel) {
      if (cancel) {
        pending = null;
        return ok();
      }
      const player = activePlayer();
      const handCard = player.hand.find((item) => item.uid === pending.handUid);
      if (!handCard) {
        pending = null;
        return fail("That card isn't in your hand");
      }
      const card = def(handCard.cardId);
      const check = castCheck(player, card, true);
      if (!check.ok) {
        pending = null;
        return check;
      }
      const legal = legalSpellTargets(player, card.id);
      if (!payload.target || !legal.some((target) => sameTarget(target, payload.target))) {
        return fail("Illegal target");
      }
      pending = null;
      return commitCast(player, handCard, card, payload.target);
    }

    function answerAttack(payload, cancel) {
      if (cancel) {
        pending = null;
        return ok();
      }
      const player = activePlayer();
      const piece = player.board.find((item) => item.uid === pending.uid);
      if (!piece) {
        pending = null;
        return fail("That companion is gone");
      }
      const status = canAttack(piece, player);
      if (!status.ok) {
        pending = null;
        return fail(status.reason);
      }
      const legal = attackTargets(piece, player);
      if (!payload.target || !legal.some((target) => sameTarget(target, payload.target))) {
        return fail("Illegal target");
      }
      const target = {
        type: payload.target.type,
        player: payload.target.player == null ? undefined : Number(payload.target.player),
        uid: payload.target.uid,
      };
      pending = null;
      piece.tapped = true;
      if (isSwift(piece)) {
        pending = {
          context: "swift-draw",
          cancellable: false,
          attack: { uid: piece.uid, target },
          prompt: pieceName(piece) + " attacks. Draw a card?",
          choices: [
            { key: "yes", label: "Draw a card" },
            { key: "no", label: "Don't draw" },
          ],
        };
        return ok();
      }
      resolveCombat(piece.uid, target);
      return ok();
    }

    function answerSwift(payload) {
      if (payload.key !== "yes" && payload.key !== "no") return fail("Choose draw or skip");
      const planned = pending.attack;
      pending = null;
      if (payload.key === "yes") drawOne(activePlayer());
      if (phase !== "over") resolveCombat(planned.uid, planned.target);
      return ok();
    }

    function answerExtension(payload, cancel) {
      if (cancel) {
        pending = null;
        return ok();
      }
      if (payload.key !== "signal" && payload.key !== "life") return fail("Choose Signal or life");
      const player = activePlayer();
      const piece = player.board.find((item) => item.uid === pending.uid);
      if (!piece || piece.tapped) {
        pending = null;
        return fail("That Node can't be tapped");
      }
      piece.tapped = true;
      pending = null;
      if (payload.key === "life") {
        player.life += 1;
        log(pieceName(piece) + " gives " + player.name + " 1 life.");
      } else {
        player.signal += 1;
        log(pieceName(piece) + " adds 1 Signal.");
      }
      return ok();
    }

    function answerDiscardOne(key) {
      const player = activePlayer();
      const index = player.hand.findIndex((item) => item.uid === key);
      if (index < 0) return fail("Choose a card in your hand");
      const discarded = player.hand.splice(index, 1)[0];
      player.graveyard.push(discarded.cardId);
      log(player.name + " discards " + def(discarded.cardId).name + ".");
      pending = null;
      return ok();
    }

    function answerHandLimit(key, cancel) {
      const player = activePlayer();
      if (cancel) {
        player.hand.push(...pending.held);
        pending = null;
        return ok();
      }
      const index = player.hand.findIndex((item) => item.uid === key);
      if (index < 0) return fail("Choose a card in your hand");
      pending.held.push(player.hand.splice(index, 1)[0]);
      if (player.hand.length > HAND_LIMIT) {
        pending.prompt = discardPrompt(player.hand.length);
        return ok();
      }
      pending.held.forEach((handCard) => {
        player.graveyard.push(handCard.cardId);
        log(player.name + " discards " + def(handCard.cardId).name + ".");
      });
      pending = null;
      finishEndTurn();
      return ok();
    }

    function answerLook(payload) {
      const player = activePlayer();
      const index = Number(payload.key);
      if (!Number.isInteger(index) || index < 0 || index >= pending.pile.length) return fail("Choose one of the cards");
      const chosen = pending.pile[index];
      const rest = pending.pile.filter((_, pileIndex) => pileIndex !== index);
      player.hand.push({ uid: newId(), cardId: chosen });
      player.deck.push(...rest);
      log(player.name + " keeps a card and puts the rest on the bottom.");
      pending = null;
      return ok();
    }

    function answerSearch(payload) {
      const player = activePlayer();
      const choice = (pending.choices || []).find((item) => item.key === String(payload.key));
      if (!choice) return fail("Choose a Node");
      const index = Number(choice.key);
      if (player.deck[index] !== choice.cardId) return fail("Choose a Node");
      player.deck.splice(index, 1);
      shuffle(player.deck, rng);
      const card = def(choice.cardId);
      const piece = createPiece(player, card);
      player.board.push(piece);
      log(player.name + " puts " + card.name + " onto the battlefield.");
      pending = null;
      resolveEnter(player, piece);
      return ok();
    }

    function answerPutNode(payload, cancel) {
      const player = activePlayer();
      if (cancel) {
        pending = null;
        log(player.name + " declines to put a Node.");
        return ok();
      }
      const index = player.hand.findIndex((item) => item.uid === payload.key);
      if (index < 0) return fail("Choose a Node in your hand");
      const handCard = player.hand[index];
      if (def(handCard.cardId).type !== "Node") return fail("Choose a Node");
      if (countKind(player, "node") >= BOARD_LIMIT) return fail("Your Node row is full");
      player.hand.splice(index, 1);
      const piece = createPiece(player, def(handCard.cardId));
      player.board.push(piece);
      log(player.name + " puts " + def(handCard.cardId).name + " onto the battlefield.");
      pending = null;
      resolveEnter(player, piece);
      return ok();
    }

    function answerBuff(payload) {
      const player = activePlayer();
      const target = player.board.find((item) => item.uid === payload.key && item.kind === "companion");
      if (!target || target.uid === pending.sourceUid) return fail("Choose another Companion");
      target.bonusP += 1;
      target.bonusT += 1;
      const source = player.board.find((item) => item.uid === pending.sourceUid);
      log((source ? pieceName(source) : "Support Partner") + " gives " + pieceName(target) + " +1/+1.");
      pending = null;
      return ok();
    }

    function pieceView(owner, piece, interactive) {
      const current = stats(owner, piece);
      return {
        uid: piece.uid,
        cardId: piece.cardId,
        kind: piece.kind,
        token: piece.token,
        tapped: piece.tapped,
        sick: sick(piece, owner),
        shielded: piece.kind === "companion" && countCard(owner, 29) > 0,
        haste: hasHaste(piece),
        power: current.power,
        toughness: current.toughness,
        damage: piece.damage,
        hp: current.hp,
        baseP: piece.baseP,
        baseT: piece.baseT,
        attack: interactive ? canAttack(piece, owner) : { ok: false, reason: "" },
        abilities: interactive ? abilities(piece, owner) : [],
      };
    }

    function handView(player) {
      return player.hand.map((handCard) => {
        const card = def(handCard.cardId);
        const check = castCheck(player, card, false);
        return {
          uid: handCard.uid,
          cardId: handCard.cardId,
          cost: modifiedCost(player, card),
          playable: check.ok,
          reason: check.ok ? "" : check.error,
        };
      });
    }

    function playerPublic(player, reveal) {
      const acting = !!reveal && phase === "play" && player.index === active;
      return {
        index: player.index,
        name: player.name,
        life: player.life,
        signal: player.signal,
        maxSignal: player.maxSignal,
        fatigue: player.fatigue,
        turnCount: player.turnCount,
        deckCount: player.deck.length,
        graveyard: player.graveyard.slice(),
        nodesPlayed: player.nodesPlayed,
        hand: reveal ? handView(player) : [],
        handCount: player.hand.length,
        board: player.board.map((piece) => pieceView(player, piece, acting)),
        secrets: reveal ? player.secrets.map((secret) => ({ uid: secret.uid, cardId: secret.cardId })) : [],
        secretCount: player.secrets.length,
      };
    }

    function pendingPublic() {
      if (!pending) return null;
      const view = {
        prompt: pending.prompt,
        cancellable: !!pending.cancellable,
        discard: pending.context === "discard-one" || pending.context === "hand-limit",
        choices: pending.choices || null,
        targets: null,
        held: pending.held ? pending.held.map((handCard) => handCard.cardId) : [],
      };
      if (pending.context === "spell-target") view.targets = legalSpellTargets(activePlayer(), pending.cardId);
      if (pending.context === "attack") {
        const found = findPiece(pending.uid);
        view.targets = found ? attackTargets(found.piece, found.player) : [];
      }
      return view;
    }

    function waitView(seat, message) {
      return { phase: "wait", seat: seat, wait: { message: message } };
    }

    function mulliganBody() {
      const player = players[mulliganPlayer];
      return {
        phase: "mulligan",
        mulligan: {
          index: player.index,
          name: player.name,
          goesFirst: player.first,
          cards: player.hand.map((handCard) => ({
            uid: handCard.uid,
            cardId: handCard.cardId,
            marked: marked.has(handCard.uid),
          })),
        },
      };
    }

    function overBody() {
      return {
        phase: "over",
        over: {
          winner,
          winnerName: winner === null ? null : players[winner].name,
          reason: winReason,
          lives: players.map((player) => ({ name: player.name, life: player.life })),
        },
        log: logs.slice(-12),
      };
    }

    function playBody(you, opp) {
      return {
        phase: "play",
        active,
        yourTurn: you.index === active,
        log: logs.slice(-12),
        pending: you.index === active ? pendingPublic() : null,
        you: playerPublic(you, true),
        opp: playerPublic(opp, false),
      };
    }

    function getView(seat) {
      const seated = seat === 0 || seat === 1;
      if (phase === "pass") {
        if (seated && seat !== passTo) {
          return waitView(seat, "Waiting for " + players[passTo].name + ".");
        }
        return { phase: "pass", pass: { name: players[passTo].name, message: passMessage } };
      }
      if (phase === "mulligan") {
        if (seated && seat !== mulliganPlayer) {
          return waitView(seat, players[mulliganPlayer].name + " is choosing an opening hand.");
        }
        return mulliganBody();
      }
      if (phase === "over") return overBody();
      if (seated) return playBody(players[seat], players[1 - seat]);
      return playBody(players[active], players[1 - active]);
    }

    function snapshot() {
      return {
        phase,
        active,
        first,
        winner,
        pending: pending ? pending.context : null,
        passPurpose,
        log: logs.slice(),
        players: players.map((player) => ({
          name: player.name,
          life: player.life,
          signal: player.signal,
          maxSignal: player.maxSignal,
          fatigue: player.fatigue,
          turnCount: player.turnCount,
          nodesPlayed: player.nodesPlayed,
          first: player.first,
          deck: player.deck.slice(),
          hand: player.hand.map((handCard) => ({ uid: handCard.uid, cardId: handCard.cardId })),
          graveyard: player.graveyard.slice(),
          secrets: player.secrets.map((secret) => secret.cardId),
          board: player.board.map((piece) => {
            const current = stats(player, piece);
            return {
              uid: piece.uid,
              cardId: piece.cardId,
              kind: piece.kind,
              token: piece.token,
              vanilla: piece.vanilla,
              tapped: piece.tapped,
              damage: piece.damage,
              bonusP: piece.bonusP,
              bonusT: piece.bonusT,
              batteryUsed: piece.batteryUsed,
              enteredTurn: piece.enteredTurn,
              power: current.power,
              toughness: current.toughness,
              hp: current.hp,
            };
          }),
        })),
      };
    }

    return {
      ready,
      confirmMulligan,
      toggleMulligan,
      playCard,
      attack,
      activate,
      endTurn,
      answer,
      concede,
      getView,
      snapshot,
    };
  }

  function cleanName(name, fallback) {
    const trimmed = String(name || "").trim().slice(0, 18);
    return trimmed || fallback;
  }

  function shuffle(list, rng) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const swap = list[i];
      list[i] = list[j];
      list[j] = swap;
    }
    return list;
  }

  return { createGame };
});
