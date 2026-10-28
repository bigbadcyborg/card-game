/* Board for the Contigo duel. Hotseat keeps the active player on the bottom.
   A LAN table keeps each browser on its own seat. */
(function () {
  const setupEl = document.getElementById("g-setup");
  const stageEl = document.getElementById("g-stage");
  const rootEl = document.getElementById("g-root");
  const previewEl = document.getElementById("g-preview");
  const previewImg = previewEl.querySelector("img");
  const toastEl = document.getElementById("g-toast");

  const cardById = new Map(ContigoApp.cards.map((card) => [card.id, card]));
  let match = null;
  let ui = { selected: null, viewer: null, lastPhase: "", lastLog: [], lastActive: null, busy: false };
  const LAN_TOKEN = "contigo-lan";
  let turnStart = false;
  let dealIn = false;
  let incoming = new Set();
  let fxToken = 0;
  const fxEl = document.getElementById("g-fx");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let toastTimer = 0;
  let lastDiscard = 0;

  setupEl.innerHTML = `
    <div class="g-setup">
      <div>
        <h1>Duel</h1>
        <p class="subtitle" id="g-lead">Two players, one screen. Pass it when the turn ends.</p>
        <div class="g-mode">
          <button type="button" class="g-mode-btn active" data-mode="hotseat">Same screen</button>
          <button type="button" class="g-mode-btn" data-mode="lan">Same network</button>
        </div>
        <div class="g-panel" id="g-hotseat">
          <label>Player 1
            <input id="g-name-0" value="Player 1" maxlength="18" autocomplete="off">
          </label>
          <label>Deck
            <select data-deck="0"></select>
          </label>
          <label>Player 2
            <input id="g-name-1" value="Player 2" maxlength="18" autocomplete="off">
          </label>
          <label>Deck
            <select data-deck="1"></select>
          </label>
          <button id="g-start" class="g-btn g-start" type="button">Start match</button>
        </div>
        <div class="g-panel hidden" id="g-lan">
          <p class="g-lan-note" id="g-lan-note">Each player opens this page, picks a deck, and sits down. Your hand stays on your screen.</p>
          <label>Your name
            <input id="g-lan-name" value="Player" maxlength="18" autocomplete="off">
          </label>
          <label>Your deck
            <select data-deck="lan"></select>
          </label>
          <p class="g-lan-note" id="g-lan-status"></p>
          <button id="g-lan-sit" class="g-btn g-start" type="button">Sit down</button>
        </div>
      </div>
      <div class="g-panel g-how">
        <h2>How a turn works</h2>
        <ol>
          <li>Signal increases by 1 (up to 10) and refills. You draw a card, except the first player's first turn.</li>
          <li>Play cards by spending Signal. One Node from hand each turn. Tap a Node for extra Signal.</li>
          <li>Click a ready Companion, then click an enemy Companion or hero. Damage is dealt at the same time.</li>
          <li id="g-how-last">End the turn and hand the screen to your opponent. Hands stay hidden.</li>
        </ol>
      </div>
    </div>
  `;

  document.getElementById("g-start").addEventListener("click", startMatch);
  document.getElementById("g-lan-sit").addEventListener("click", sitDown);
  document.querySelectorAll(".g-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => setPlayMode(btn.dataset.mode));
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.view !== "play") {
        document.body.classList.remove("duel-mode");
        return;
      }
      if (match) showMatch();
      else showSetup();
    });
  });
  window.addEventListener("resize", () => {
    if (match && document.body.classList.contains("duel-mode")) fitBoard();
  });
  if (location.protocol === "http:" || location.protocol === "https:") {
    setInterval(lanTick, 700);
  } else {
    const note = document.getElementById("g-lan-note");
    note.textContent = "Double-click start-lan.bat (or run python host.py) and open the address it prints. Then both players choose Same network.";
  }

  rootEl.addEventListener("click", onRootClick);
  rootEl.addEventListener("dblclick", onRootDblClick);
  rootEl.addEventListener("mouseover", (event) => {
    const el = event.target.closest("[data-card-id]");
    if (!el || window.innerWidth < 980) return;
    showPreview(el.dataset.cardId, event.clientX);
  });
  rootEl.addEventListener("mouseout", (event) => {
    const next = event.relatedTarget && event.relatedTarget.closest
      ? event.relatedTarget.closest("[data-card-id]")
      : null;
    if (!next) hidePreview();
  });
  document.addEventListener("keydown", (event) => {
    if (!match) return;
    const modal = document.getElementById("modal");
    if (event.key === "Escape" && modal.classList.contains("show")) {
      modal.classList.remove("show");
      return;
    }
    const tag = event.target && event.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (event.key !== "Escape") return;
    const view = match.getView();
    if (view.pending && view.pending.cancellable) run(() => match.answer({ cancel: true }));
    else if (ui.viewer) {
      ui.viewer = null;
      render();
    } else {
      ui.selected = null;
      render();
    }
  });

  refreshDeckOptions();

  function startMatch() {
    const name0 = document.getElementById("g-name-0").value;
    const name1 = document.getElementById("g-name-1").value;
    const deck0 = chosenDeck(0);
    const deck1 = chosenDeck(1);
    if (!deck0 || !deck1) return;
    try {
      match = ContigoEngine.createGame({
        cards: ContigoApp.cards,
        playerNames: [name0, name1],
        decks: [deck0, deck1],
        firstPlayer: "random",
      });
    } catch (err) {
      toast(err.message || "Could not start the match");
      return;
    }
    match.local = true;
    ui = { selected: null, viewer: null, lastPhase: "", lastLog: [], lastActive: null, busy: false };
    if (lanToken()) leaveTable();
    showMatch();
  }

  function chosenDeck(index) {
    const select = document.querySelector('[data-deck="' + index + '"]');
    if (select.value === "built") {
      const ids = ContigoApp.getDeck();
      if (ids.length < 20) {
        toast("A built deck needs at least 20 cards");
        return null;
      }
      return ids;
    }
    return ContigoApp.cards.map((card) => card.id);
  }

  function refreshDeckOptions() {
    const count = ContigoApp.getDeck().length;
    document.querySelectorAll("[data-deck]").forEach((select) => {
      const previous = select.value || "set";
      select.innerHTML = "";
      const full = document.createElement("option");
      full.value = "set";
      full.textContent = "Full Tech set (30)";
      const built = document.createElement("option");
      built.value = "built";
      built.disabled = count < 20;
      built.textContent = count >= 20
        ? "My built deck (" + count + ")"
        : "My built deck (" + count + ") — need 20";
      select.append(full, built);
      select.value = previous === "built" && count >= 20 ? "built" : "set";
    });
  }

  function showSetup() {
    match = null;
    ui = { selected: null, viewer: null, lastPhase: "", lastLog: [], lastActive: null, busy: false };
    stageEl.classList.add("hidden");
    setupEl.classList.remove("hidden");
    document.body.classList.remove("duel-mode");
    hidePreview();
    refreshDeckOptions();
  }

  function showMatch() {
    setupEl.classList.add("hidden");
    stageEl.classList.remove("hidden");
    document.body.classList.add("duel-mode");
    render();
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2200);
  }

  function box(el) {
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function captureStage() {
    if (!match) return null;
    const view = match.getView();
    const cards = {};
    rootEl.querySelectorAll("[data-uid]").forEach((el) => {
      const rect = box(el);
      if (!rect) return;
      cards[el.dataset.uid] = {
        rect: rect,
        cardId: Number(el.dataset.cardId),
        token: el.dataset.token === "1",
      };
    });
    const heroes = {};
    rootEl.querySelectorAll(".g-hero").forEach((el) => {
      heroes[el.dataset.player] = box(el);
    });
    return { phase: view.phase, view: view, cards: cards, heroes: heroes };
  }

  function newLines(prev, next) {
    prev = prev || [];
    next = next || [];
    if (!prev.length) return next.slice();
    const max = Math.min(prev.length, next.length);
    for (let take = max; take > 0; take--) {
      const start = prev.length - take;
      for (let i = 0; i + take <= next.length; i++) {
        let same = true;
        for (let j = 0; j < take; j++) {
          if (prev[start + j] !== next[i + j]) {
            same = false;
            break;
          }
        }
        if (same) return next.slice(i + take);
      }
    }
    return next.slice();
  }

  function drawCountOf(after) {
    const lines = newLines(ui.lastLog, after.log || []);
    return lines.filter((line) => line.indexOf("draws") !== -1).length;
  }

  function mapBoard(player, owner, into) {
    (player.board || []).forEach((piece) => {
      into.set(piece.uid, Object.assign({ owner: owner }, piece));
    });
  }

  function hasPlan(plan) {
    return !!(
      plan.lunge || plan.summon.length || plan.spell.length || plan.discard.length ||
      plan.bounce.length || plan.draw.length || plan.death.length || plan.arrive.length ||
      plan.impacts.length || plan.taps.length
    );
  }

  function planAnimation(before, after) {
    if (reduceMotion || !before || !after) return null;
    const plan = {
      lunge: null, summon: [], spell: [], discard: [], bounce: [],
      draw: [], death: [], arrive: [], impacts: [], taps: [],
    };
    if (before.phase !== "play" || after.phase !== "play" || !before.view || before.view.active !== after.active) {
      const yourTurnBegan = after.phase === "play" && after.you && after.active === after.you.index && (
        before.phase === "pass" || (before.view && before.view.active !== after.active)
      );
      if (yourTurnBegan && drawCountOf(after) > 0) {
        const drawCount = drawCountOf(after);
        after.you.hand.slice(-drawCount).forEach((card) => {
          plan.draw.push({ uid: card.uid, cardId: card.cardId });
        });
      }
      return hasPlan(plan) ? plan : null;
    }

    const oldHand = new Map(before.view.you.hand.map((card) => [card.uid, card]));
    const newHand = new Map(after.you.hand.map((card) => [card.uid, card]));
    const oldBoard = new Map();
    const newBoard = new Map();
    mapBoard(before.view.you, "you", oldBoard);
    mapBoard(before.view.opp, "opp", oldBoard);
    mapBoard(after.you, "you", newBoard);
    mapBoard(after.opp, "opp", newBoard);
    const removedHand = [...oldHand.keys()].filter((uid) => !newHand.has(uid));
    const addedHand = [...newHand.keys()].filter((uid) => !oldHand.has(uid));
    const removedBoard = [...oldBoard.keys()].filter((uid) => !newBoard.has(uid));
    const addedBoard = [...newBoard.keys()].filter((uid) => !oldBoard.has(uid));
    const lines = newLines(before.view.log, after.log);
    const usedHand = new Set();
    const usedBoard = new Set();
    const usedRemoved = new Set();

    removedBoard.forEach((uid) => {
      const piece = oldBoard.get(uid);
      const handUid = addedHand.find((id) => !usedHand.has(id) && newHand.get(id).cardId === piece.cardId);
      if (!handUid || !lines.some((line) => line.indexOf("returns") !== -1)) return;
      usedHand.add(handUid);
      usedRemoved.add(uid);
      plan.bounce.push({ fromUid: uid, toUid: handUid, cardId: piece.cardId });
    });

    removedHand.forEach((uid) => {
      const card = oldHand.get(uid);
      const name = cardById.get(card.cardId).name;
      const toUid = addedBoard.find((id) => !usedBoard.has(id) && !newBoard.get(id).token && newBoard.get(id).cardId === card.cardId);
      if (toUid) {
        usedBoard.add(toUid);
        plan.summon.push({ fromUid: uid, toUid: toUid, cardId: card.cardId });
        return;
      }
      if (lines.some((line) => line.indexOf(" discards ") !== -1 && line.indexOf(name) !== -1)) {
        plan.discard.push({ fromUid: uid, cardId: card.cardId });
        return;
      }
      plan.spell.push({
        fromUid: uid,
        cardId: card.cardId,
        secret: lines.some((line) => line.indexOf("sets a Secret") !== -1),
        countered: lines.some((line) => line.indexOf("counters") !== -1),
      });
    });

    addedBoard.forEach((uid) => {
      if (usedBoard.has(uid)) return;
      plan.arrive.push({
        uid: uid,
        cardId: newBoard.get(uid).cardId,
        fromDeck: lines.some((line) => line.indexOf("onto the battlefield") !== -1),
      });
    });
    addedHand.forEach((uid) => {
      if (usedHand.has(uid)) return;
      plan.draw.push({ uid: uid, cardId: newHand.get(uid).cardId });
    });
    removedBoard.forEach((uid) => {
      if (usedRemoved.has(uid)) return;
      const piece = oldBoard.get(uid);
      plan.death.push({ fromUid: uid, cardId: piece.cardId });
      if (piece.kind === "companion") plan.impacts.push({ uid: uid, delta: -Math.max(1, piece.hp) });
    });

    const attack = lines.some((line) => line.indexOf(" attacks ") !== -1);
    if (attack) {
      let attackerUid = null;
      after.you.board.forEach((piece) => {
        const prev = oldBoard.get(piece.uid);
        if (prev && piece.kind === "companion" && !prev.tapped && piece.tapped) attackerUid = piece.uid;
      });
      if (!attackerUid) {
        after.opp.board.forEach((piece) => {
          const prev = oldBoard.get(piece.uid);
          if (prev && piece.kind === "companion" && !prev.tapped && piece.tapped) attackerUid = piece.uid;
        });
      }
      if (!attackerUid) {
        ["you", "opp"].forEach((owner) => {
          if (attackerUid) return;
          removedBoard.forEach((uid) => {
            const piece = oldBoard.get(uid);
            if (piece && piece.owner === owner && piece.kind === "companion") attackerUid = uid;
          });
        });
      }
      let attackerOwner = "you";
      if (attackerUid) {
        const prev = oldBoard.get(attackerUid);
        if (prev) attackerOwner = prev.owner;
        else if (after.opp.board.some((piece) => piece.uid === attackerUid)) attackerOwner = "opp";
      }
      const foe = attackerOwner === "opp" ? after.you : after.opp;
      const foeBefore = attackerOwner === "opp" ? before.view.you : before.view.opp;
      let targetUid = null;
      foe.board.forEach((piece) => {
        const prev = oldBoard.get(piece.uid);
        if (prev && piece.damage > prev.damage) targetUid = piece.uid;
      });
      if (!targetUid) {
        removedBoard.forEach((uid) => {
          const piece = oldBoard.get(uid);
          if (piece && piece.owner !== attackerOwner && piece.kind === "companion") targetUid = uid;
        });
      }
      const player = !targetUid && foe.life < foeBefore.life ? foe.index : null;
      if (attackerUid && before.cards[attackerUid] && (targetUid || player != null)) {
        plan.lunge = { attackerUid: attackerUid, targetUid: targetUid, player: player };
      }
    } else {
      [after.you, after.opp].forEach((player) => {
        player.board.forEach((piece) => {
          const prev = oldBoard.get(piece.uid);
          if (prev && !prev.tapped && piece.tapped) plan.taps.push(piece.uid);
        });
      });
    }

    if (before.view.you.life !== after.you.life) {
      plan.impacts.push({ player: after.you.index, delta: after.you.life - before.view.you.life });
    }
    if (before.view.opp.life !== after.opp.life) {
      plan.impacts.push({ player: after.opp.index, delta: after.opp.life - before.view.opp.life });
    }
    [after.you, after.opp].forEach((player) => {
      player.board.forEach((piece) => {
        const prev = oldBoard.get(piece.uid);
        if (prev && piece.hp !== prev.hp) plan.impacts.push({ uid: piece.uid, delta: piece.hp - prev.hp });
      });
    });

    const when = plan.lunge ? "hit" : plan.spell.length ? "land" : "after";
    plan.impacts.forEach((impact) => { impact.when = when; });
    return hasPlan(plan) ? plan : null;
  }

  function clearFx() {
    if (fxEl) fxEl.replaceChildren();
  }

  function spawnCard(cardId, rect, extra) {
    const card = cardById.get(cardId);
    const el = document.createElement("img");
    el.className = "g-fx-card" + (extra ? " " + extra : "");
    el.src = card ? card.image : "";
    el.alt = "";
    el.draggable = false;
    el.style.left = rect.x + "px";
    el.style.top = rect.y + "px";
    el.style.width = rect.w + "px";
    el.style.height = rect.h + "px";
    fxEl.appendChild(el);
    return el;
  }

  function shiftTo(el, from, to) {
    const sx = to.w / from.w;
    const sy = to.h / from.h;
    el.style.transform = "translate(" + (to.x - from.x) + "px," + (to.y - from.y) + "px) scale(" + sx + "," + sy + ")";
  }

  function deckOrigin() {
    const deck = box(rootEl.querySelector(".g-bottom .g-deck"));
    if (!deck) return { x: 72, y: window.innerHeight - 180, w: 52, h: 74 };
    return { x: deck.x, y: deck.y - 16, w: 52, h: 74 };
  }

  function gravePoint() {
    return box(rootEl.querySelector(".g-bottom [data-act='grave']")) || deckOrigin();
  }

  function tableCenter() {
    const rect = box(rootEl.querySelector(".g-table"));
    if (!rect) return { x: window.innerWidth / 2 - 36, y: window.innerHeight / 2 - 52, w: 72, h: 104 };
    return { x: rect.x + rect.w / 2 - 36, y: rect.y + rect.h / 2 - 52, w: 72, h: 104 };
  }

  function burst(rect) {
    const el = document.createElement("div");
    el.className = "g-fx-burst";
    el.style.left = (rect.x + rect.w / 2) + "px";
    el.style.top = (rect.y + rect.h / 2) + "px";
    fxEl.appendChild(el);
    setTimeout(() => el.remove(), 520);
  }

  function floatNum(text, rect, kind) {
    if (!rect) return;
    const el = document.createElement("div");
    el.className = "g-fx-num " + kind;
    el.textContent = text;
    el.style.left = (rect.x + rect.w / 2) + "px";
    el.style.top = (rect.y + rect.h * 0.42) + "px";
    fxEl.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  function impactRect(impact, before) {
    if (impact.uid) {
      const live = rootEl.querySelector('[data-uid="' + impact.uid + '"]');
      return (live && box(live)) || (before.cards[impact.uid] && before.cards[impact.uid].rect);
    }
    const live = rootEl.querySelector('.g-hero[data-player="' + impact.player + '"]');
    return (live && box(live)) || before.heroes[String(impact.player)];
  }

  function showImpacts(plan, before, when) {
    plan.impacts.forEach((impact) => {
      if (impact.when !== when || impact.shown) return;
      impact.shown = true;
      const rect = impactRect(impact, before);
      const kind = impact.delta < 0 ? "is-dmg" : "is-heal";
      floatNum(impact.delta < 0 ? String(impact.delta) : "+" + impact.delta, rect, kind);
      const live = impact.uid
        ? rootEl.querySelector('[data-uid="' + impact.uid + '"]')
        : rootEl.querySelector('.g-hero[data-player="' + impact.player + '"]');
      if (live && impact.delta < 0) live.classList.add("is-hit");
    });
  }

  function spellDestination(item, before, plan) {
    if (item.secret && before.view && before.heroes[String(before.view.you.index)]) {
      const hero = before.heroes[String(before.view.you.index)];
      return { x: hero.x + hero.w + 8, y: hero.y, w: 58, h: 82 };
    }
    const blow = plan.impacts.find((impact) => impact.delta < 0 && impact.uid && before.cards[impact.uid]);
    if (blow) {
      const rect = before.cards[blow.uid].rect;
      return { x: rect.x + rect.w / 2 - 34, y: rect.y + rect.h / 2 - 48, w: 68, h: 96 };
    }
    const heroBlow = plan.impacts.find((impact) => impact.delta < 0 && impact.player != null && before.heroes[String(impact.player)]);
    if (heroBlow) {
      const rect = before.heroes[String(heroBlow.player)];
      return { x: rect.x + rect.w / 2 - 30, y: rect.y - 10, w: 64, h: 90 };
    }
    return tableCenter();
  }

  async function flyOnto(cardId, from, toUid) {
    const dest = rootEl.querySelector('[data-uid="' + toUid + '"]');
    const to = box(dest);
    if (!from || !to) {
      if (dest) {
        dest.classList.remove("g-arriving");
        dest.classList.add("g-slam");
      }
      return;
    }
    const el = spawnCard(cardId, from);
    await wait(20);
    shiftTo(el, from, to);
    await wait(430);
    el.remove();
    if (dest) {
      dest.classList.remove("g-arriving");
      dest.classList.add("g-slam");
    }
  }

  async function flySpell(item, before, plan) {
    const source = before.cards[item.fromUid];
    if (!source) return;
    const to = spellDestination(item, before, plan);
    const el = spawnCard(item.cardId, source.rect, item.countered ? "is-countered" : "is-spell");
    await wait(20);
    shiftTo(el, source.rect, to);
    await wait(400);
    burst(to);
    el.style.transition = "none";
    el.style.transform = "none";
    el.style.left = to.x + "px";
    el.style.top = to.y + "px";
    el.style.width = to.w + "px";
    el.style.height = to.h + "px";
    el.classList.add("is-dying");
    await wait(280);
    el.remove();
  }

  async function playDeath(item, before, delay) {
    const source = before.cards[item.fromUid];
    if (!source) return;
    if (delay) await wait(delay);
    const el = spawnCard(item.cardId, source.rect, "is-motion");
    el.classList.add("is-dying");
    await wait(480);
    el.remove();
  }

  async function doLunge(plan, before) {
    const source = before.cards[plan.lunge.attackerUid];
    const to = plan.lunge.targetUid
      ? (before.cards[plan.lunge.targetUid] && before.cards[plan.lunge.targetUid].rect)
      : before.heroes[String(plan.lunge.player)];
    if (!source || !to) return;
    const from = source.rect;
    const real = rootEl.querySelector('[data-uid="' + plan.lunge.attackerUid + '"]');
    if (real) real.style.visibility = "hidden";
    const el = spawnCard(source.cardId, from, "is-motion");
    const dx = (to.x + to.w / 2) - (from.x + from.w / 2);
    const dy = (to.y + to.h / 2) - (from.y + from.h / 2);
    const len = Math.hypot(dx, dy) || 1;
    const reach = Math.max(0, Math.min(len * 0.72, len - 28));
    const x = dx / len * reach;
    const y = dy / len * reach;
    el.animate([
      { transform: "translate(0,0) scale(1)" },
      { transform: "translate(" + x + "px," + y + "px) scale(1.05)", offset: 0.42 },
      { transform: "translate(" + x + "px," + y + "px) scale(1.05)", offset: 0.6 },
      { transform: "translate(0,0) scale(1)" },
    ], { duration: 560, easing: "cubic-bezier(.2,.65,.2,1)" });
    await wait(230);
    burst(to);
    showImpacts(plan, before, "hit");
    const targetEl = plan.lunge.targetUid
      ? rootEl.querySelector('[data-uid="' + plan.lunge.targetUid + '"]')
      : rootEl.querySelector('.g-hero[data-player="' + plan.lunge.player + '"]');
    if (targetEl) targetEl.classList.add("is-hit");
    await wait(340);
    el.remove();
  }

  function run(fn) {
    if (ui.busy) return;
    const before = captureStage();
    ui.viewer = null;
    let result;
    try {
      result = fn();
    } catch (err) {
      toast(err.message || "Something went wrong");
      return;
    }
    if (result && typeof result.then === "function") {
      ui.busy = true;
      result.then((value) => {
        ui.busy = false;
        finishCommand(before, value);
      }, (err) => {
        ui.busy = false;
        toast(err.message || "The table did not answer");
        render();
      });
      return;
    }
    finishCommand(before, result);
  }

  function finishCommand(before, result) {
    if (result && result.ok === false) {
      toast(result.error);
      render();
      drainRemote();
      return;
    }
    const after = match.getView();
    const plan = planAnimation(before, after);
    if (!plan) {
      render();
      drainRemote();
      return;
    }
    const token = ++fxToken;
    ui.busy = true;
    clearTimeout(ui.busyTimer);
    ui.busyTimer = setTimeout(() => {
      if (token !== fxToken) return;
      ui.busy = false;
      render();
      drainRemote();
    }, 2000);
    playAnimation(token, plan, before).then(() => {
      clearTimeout(ui.busyTimer);
      if (token === fxToken) ui.busy = false;
      drainRemote();
    }, () => {
      clearTimeout(ui.busyTimer);
      if (token === fxToken) ui.busy = false;
      render();
      drainRemote();
    });
  }

  async function playAnimation(token, plan, before) {
    hidePreview();
    if (plan.lunge) await doLunge(plan, before);
    if (token !== fxToken) return;
    incoming = new Set();
    plan.summon.forEach((item) => incoming.add(item.toUid));
    plan.bounce.forEach((item) => incoming.add(item.toUid));
    plan.draw.forEach((item) => incoming.add(item.uid));
    plan.arrive.forEach((item) => incoming.add(item.uid));
    render();
    incoming = new Set();
    if (token !== fxToken) return;
    plan.impacts.forEach((impact) => {
      if (impact.when !== "hit" || impact.delta >= 0) return;
      const live = impact.uid
        ? rootEl.querySelector('[data-uid="' + impact.uid + '"]')
        : rootEl.querySelector('.g-hero[data-player="' + impact.player + '"]');
      if (live) live.classList.add("is-hit");
    });
    showImpacts(plan, before, "after");
    const jobs = [];
    plan.summon.forEach((item) => {
      const source = before.cards[item.fromUid];
      jobs.push(flyOnto(item.cardId, source && source.rect, item.toUid));
    });
    plan.bounce.forEach((item) => {
      const source = before.cards[item.fromUid];
      jobs.push(flyOnto(item.cardId, source && source.rect, item.toUid));
    });
    plan.draw.forEach((item, index) => {
      jobs.push(wait(index * 80).then(() => flyOnto(item.cardId, deckOrigin(), item.uid)));
    });
    plan.discard.forEach((item) => {
      const source = before.cards[item.fromUid];
      if (!source) return;
      jobs.push(shrinkAway(item.cardId, source.rect, gravePoint()));
    });
    plan.spell.forEach((item) => jobs.push(flySpell(item, before, plan)));
    plan.death.forEach((item) => jobs.push(playDeath(item, before, plan.spell.length ? 300 : 0)));
    plan.arrive.forEach((item) => {
      if (item.fromDeck) jobs.push(flyOnto(item.cardId, deckOrigin(), item.uid));
      else jobs.push(slamOnly(item.uid));
    });
    plan.taps.forEach((uid) => {
      const el = rootEl.querySelector('[data-uid="' + uid + '"]');
      if (el) el.classList.add("just-tapped");
    });
    if (plan.spell.length) jobs.push(wait(360).then(() => showImpacts(plan, before, "land")));
    await Promise.all(jobs);
  }

  async function shrinkAway(cardId, from, to) {
    const el = spawnCard(cardId, from);
    await wait(20);
    shiftTo(el, from, { x: to.x, y: to.y, w: Math.max(24, to.w), h: Math.max(32, to.h) });
    el.style.opacity = "0.15";
    await wait(380);
    el.remove();
  }

  function slamOnly(uid) {
    const el = rootEl.querySelector('[data-uid="' + uid + '"]');
    if (!el) return Promise.resolve();
    el.classList.remove("g-arriving");
    el.classList.add("g-slam");
    return Promise.resolve();
  }

  function render() {
    if (!match) return;
    const view = match.getView();
    const yourTurn = view.yourTurn !== false;
    turnStart = view.phase === "play" && yourTurn && (
      ui.lastPhase === "pass" || ui.lastPhase === "wait" || ui.lastPhase === "mulligan" ||
      (ui.lastActive !== null && ui.lastActive !== view.active)
    );
    dealIn = view.phase === "mulligan" && ui.lastPhase !== "mulligan";
    if (view.phase !== "play") hidePreview();
    if (view.phase === "pass") rootEl.innerHTML = passHtml(view);
    else if (view.phase === "wait") rootEl.innerHTML = waitHtml(view);
    else if (view.phase === "mulligan") rootEl.innerHTML = mulliganHtml(view);
    else if (view.phase === "over") rootEl.innerHTML = overHtml(view);
    else rootEl.innerHTML = playHtml(view);
    ui.lastPhase = view.phase;
    if (view.phase === "play") {
      ui.lastLog = (view.log || []).slice();
      ui.lastActive = view.active;
      fitBoard();
    }
    const focus = rootEl.querySelector("[data-autofocus]");
    if (focus) focus.focus();
    const log = rootEl.querySelector(".g-log");
    if (log) log.scrollTop = log.scrollHeight;
  }

  function fitBoard() {
    if (window.innerWidth <= 820) {
      rootEl.querySelectorAll(".g-unit").forEach((unit) => {
        unit.style.height = "";
        unit.style.width = "";
      });
      rootEl.querySelectorAll(".g-board .g-row").forEach((row) => { row.style.height = ""; });
      return;
    }
    rootEl.querySelectorAll(".g-board .g-row").forEach((row) => {
      row.style.height = "";
      row.querySelectorAll(".g-unit").forEach((unit) => {
        unit.style.height = "";
        unit.style.width = "";
      });
      const zone = row.parentElement;
      if (!zone) return;
      const label = zone.querySelector(".g-zone-label");
      const available = zone.clientHeight - (label ? label.offsetHeight : 0) - 4;
      const height = Math.min(148, Math.max(0, available - 6));
      if (height < 8) return;
      const width = Math.round(height * (784 / 1168));
      row.style.height = (height + 6) + "px";
      row.querySelectorAll(".g-unit").forEach((unit) => {
        unit.style.height = height + "px";
        unit.style.width = width + "px";
      });
    });
  }

  function waitHtml(view) {
    const message = view.wait && view.wait.message ? view.wait.message : "Waiting for the other player.";
    return takeover(`
      <p class="g-kicker">Same network</p>
      <h2>Hold on</h2>
      <p>${esc(message)}</p>
      <div class="g-actions">
        <button class="g-link" type="button" data-act="abandon">Leave table</button>
      </div>
    `);
  }

  function passHtml(view) {
    return takeover(`
      <p class="g-kicker">Hotseat</p>
      <h2>Hand the screen over</h2>
      <p>${esc(view.pass.message)}</p>
      <div class="g-actions">
        <button class="g-btn" type="button" data-act="ready" data-autofocus>I'm ${esc(view.pass.name)}</button>
        <button class="g-link" type="button" data-act="abandon">Back to setup</button>
      </div>
    `);
  }

  function mulliganHtml(view) {
    const marked = view.mulligan.cards.some((card) => card.marked);
    const cards = view.mulligan.cards.map((card) => {
      const def = cardById.get(card.cardId);
      return `<button type="button" class="g-pick${card.marked ? " is-marked" : ""}" data-act="mulligan-toggle" data-uid="${esc(card.uid)}" data-card-id="${card.cardId}">
        <img src="${esc(def.image)}" alt="${esc(def.name)}" draggable="false">
        ${card.marked ? '<span class="g-ribbon">Replace</span>' : ""}
      </button>`;
    }).join("");
    const note = view.mulligan.goesFirst
      ? "You go first. This opening hand is 3 cards, and you do not draw on turn 1."
      : "You go second. This opening hand is 4 cards.";
    return takeover(`
      <span class="g-pill">${view.mulligan.goesFirst ? "First" : "Second"}</span>
      <h2>${esc(view.mulligan.name)}</h2>
      <p>${note} Click any cards you want to replace.</p>
      <div class="g-choice-row${dealIn ? " is-dealing" : ""}">${cards}</div>
      <div class="g-actions">
        <button class="g-btn" type="button" data-act="confirm-mulligan" data-autofocus>${marked ? "Mulligan selected" : "Keep hand"}</button>
        <button class="g-link" type="button" data-act="abandon">Back to setup</button>
      </div>
    `);
  }

  function overHtml(view) {
    const title = view.over.winnerName ? esc(view.over.winnerName) + " wins" : "Draw";
    const lives = view.over.lives.map((entry) => `<li>${esc(entry.name)}: ${entry.life} life</li>`).join("");
    return takeover(`
      <p class="g-kicker">Match over</p>
      <h2>${title}</h2>
      <p>${esc(view.over.reason)}</p>
      <ul style="list-style:none;margin-bottom:0.8rem;">${lives}</ul>
      ${logHtml(view.log)}
      <div class="g-actions">
        <button class="g-btn" type="button" data-act="again" data-autofocus>New match</button>
      </div>
    `);
  }

  function takeover(inner) {
    return `<div class="g-takeover"><div class="g-takeover-card">${inner}</div></div>`;
  }

  function playHtml(view) {
    const selected = livingSelection(view);
    const targeting = view.pending && view.pending.targets;
    const discarding = view.pending && view.pending.discard;
    const classes = ["g-table"];
    if (targeting) classes.push("is-targeting");
    if (discarding) classes.push("is-discarding");
    const banner = turnStart ? `<div class="g-turn-banner">${esc(view.you.name)}'s turn</div>` : "";
    const lines = view.log.length ? view.log : ["Play cards, attack, then end the turn."];
    return `<div class="${classes.join(" ")}">
      ${banner}
      <div class="g-top">${sideHtml(view.opp, false, view)}</div>
      <div class="g-bottom">
        ${zonesHtml(view.you, ["companion", "bond", "node"], view)}
        ${heroHtml(view.you, true, view)}
      </div>
      <div class="g-dock">
        ${actionHtml(selected, view)}
        <div class="g-hand">${handHtml(view.you)}</div>
      </div>
      <aside class="g-log-pane">
        <div class="g-log-title">Moves</div>
        ${logHtml(lines)}
      </aside>
      ${promptHtml(view.pending)}
      ${viewerHtml()}
    </div>`;
  }

  function sideHtml(player, mine, view) {
    const backs = Array.from({ length: player.handCount }, () => '<span class="g-back">C</span>').join("");
    const secrets = player.secretCount
      ? Array.from({ length: player.secretCount }, () => '<span class="g-back">?</span>').join("")
      : "";
    const pile = `<div class="g-backs" title="${player.handCount} in hand">${backs}${secrets}</div>`;
    return `
      ${heroHtml(player, mine, view, pile)}
      ${zonesHtml(player, ["node", "bond", "companion"], view)}
    `;
  }

  function heroHtml(player, mine, view, pile) {
    const legal = isLegalHero(player.index, view);
    const lifeClass = player.life <= 5 ? "low" : player.life <= 10 ? "mid" : "";
    const fatigue = player.fatigue ? `<span title="The next missed draw deals ${player.fatigue + 1}">Fatigue ${player.fatigue}</span>` : "";
    const nodeNote = mine && player.nodesPlayed ? "<span>Node played</span>" : "";
    const concede = mine && view.yourTurn !== false ? '<button type="button" data-act="concede">Concede</button>' : "";
    const ownSecrets = mine && player.secrets.length
      ? `<div class="g-row">${player.secrets.map((secret) => secretHtml(secret)).join("")}</div>`
      : "";
    return `<div class="g-hero-bar">
      <div class="g-identity">
        <button type="button" class="g-hero${legal ? " is-legal" : ""}" data-act="hero" data-player="${player.index}">
          <span class="g-life ${lifeClass}">${player.life}</span>
        </button>
        <div>
          <div class="g-hero-name">${esc(player.name)}</div>
          <div class="g-meta">
            <span class="g-deck">Deck ${player.deckCount}</span>
            <button type="button" data-act="grave" data-who="${mine ? "you" : "opp"}">Grave ${player.graveyard.length}</button>
            ${fatigue}
            ${nodeNote}
            ${concede}
          </div>
        </div>
      </div>
      ${pile || ""}
      <div>
        ${gemsHtml(player.signal, player.maxSignal, mine && turnStart)}
        ${ownSecrets}
      </div>
    </div>`;
  }

  function gemsHtml(signal, max, pop) {
    const total = Math.max(max, signal, 0);
    let gems = "";
    for (let i = 0; i < total; i++) {
      const on = i < signal;
      const bonus = i >= max;
      const delay = pop && on ? ' style="animation-delay:' + (i * 45) + 'ms"' : "";
      gems += `<i class="g-gem${on ? " on" : ""}${bonus ? " bonus" : ""}${pop && on ? " pop" : ""}"${delay}></i>`;
    }
    return `<div class="g-crystals" title="Signal">${gems}<span class="g-gem-num">${signal}/${max}</span></div>`;
  }

  function zonesHtml(player, order, view) {
    const blocks = order.map((kind) => {
      const pieces = player.board.filter((piece) => piece.kind === kind);
      if (!pieces.length) return "";
      const label = kind === "companion" ? "Companions" : kind === "node" ? "Nodes" : "Bonds";
      const body = pieces.map((piece) => unitHtml(piece, view)).join("");
      return `<div class="g-zone"><span class="g-zone-label">${label}</span><div class="g-row">${body}</div></div>`;
    }).filter(Boolean);
    const body = blocks.length ? blocks.join("") : '<div class="g-zone"><span class="g-empty">No cards in play</span></div>';
    return `<div class="g-board">${body}</div>`;
  }

  function unitHtml(piece, view) {
    const card = cardById.get(piece.cardId);
    const classes = ["g-unit"];
    if (piece.tapped) classes.push("is-tapped");
    if (incoming.has(piece.uid)) classes.push("g-arriving");
    if (ui.selected && ui.selected.zone === "board" && ui.selected.uid === piece.uid) classes.push("is-selected");
    if (isLegalMinion(piece.uid, view)) classes.push("is-legal");
    const powerClass = piece.power > piece.baseP ? "up" : "";
    const hpClass = piece.damage > 0 ? "down" : piece.toughness > piece.baseT ? "up" : "";
    const badges = piece.kind === "companion"
      ? `<span class="g-atk ${powerClass}">${piece.power}</span><span class="g-hp ${hpClass}">${piece.hp}</span>`
      : "";
    const flags = [
      piece.sick ? '<span class="g-flag">Wait</span>' : "",
      piece.tapped ? '<span class="g-flag">Resting</span>' : "",
      piece.haste ? '<span class="g-flag haste">Haste</span>' : "",
      piece.shielded ? '<span class="g-flag shield">Shield</span>' : "",
      piece.token ? '<span class="g-flag">Token</span>' : "",
    ].join("");
    return `<button type="button" class="${classes.join(" ")}" data-act="board" data-uid="${esc(piece.uid)}" data-card-id="${piece.cardId}" data-token="${piece.token ? "1" : "0"}">
      <img src="${esc(card.image)}" alt="${esc(piece.token ? card.name + " token" : card.name)}" draggable="false">
      <span class="g-flags">${flags}</span>
      ${badges}
    </button>`;
  }

  function handHtml(player) {
    if (!player.hand.length) return '<span class="g-empty">No cards in hand</span>';
    const count = player.hand.length;
    return player.hand.map((handCard, index) => {
      const card = cardById.get(handCard.cardId);
      const selected = ui.selected && ui.selected.zone === "hand" && ui.selected.uid === handCard.uid;
      const tilt = count === 1 ? 0 : -7 + (index * 14) / (count - 1);
      const arriving = incoming.has(handCard.uid) ? " g-arriving" : "";
      return `<button type="button" class="g-hand-card${selected ? " is-selected" : ""}${arriving}" style="--tilt:${tilt.toFixed(2)}deg" data-act="hand" data-uid="${esc(handCard.uid)}" data-card-id="${handCard.cardId}" title="${esc(handCard.playable ? "Play for " + handCard.cost + " Signal" : handCard.reason)}">
        <img src="${esc(card.image)}" alt="${esc(card.name)}" draggable="false">
      </button>`;
    }).join("");
  }

  function secretHtml(secret) {
    const card = cardById.get(secret.cardId);
    return `<button type="button" class="g-secret" data-act="inspect" data-card-id="${secret.cardId}" data-token="0">
      <img src="${esc(card.image)}" alt="${esc(card.name)}" draggable="false">
    </button>`;
  }

  function actionHtml(selected, view) {
    const yourTurn = !view || view.yourTurn !== false;
    const turnName = yourTurn ? view.you.name : view.opp.name;
    const end = yourTurn
      ? '<button class="g-end" type="button" data-act="end">End Turn</button>'
      : "";
    if (view && view.yourTurn === false) {
      return `<div class="g-action">
        <div>
          <div class="g-turn">${esc(turnName)}'s turn</div>
          <p>Waiting. You can look through your own cards.</p>
        </div>
      </div>`;
    }
    if (!selected) {
      return `<div class="g-action">
        <div>
          <div class="g-turn">${esc(turnName)}'s turn</div>
          <p>Select a card, then play or attack. Click it again to commit.</p>
        </div>
        <div class="g-action-btns">${end}</div>
      </div>`;
    }
    const card = selected.card;
    const buttons = [`<button type="button" class="g-mini" data-act="inspect" data-card-id="${card.id}" data-token="${selected.piece && selected.piece.token ? "1" : "0"}">Inspect</button>`];
    let note = "";
    if (selected.zone === "hand") {
      if (selected.hand.playable) {
        buttons.push(`<button type="button" class="g-mini g-go is-play" data-act="play">Play · ${selected.hand.cost}</button>`);
      } else note = selected.hand.reason;
    } else if (selected.owner === "you" && selected.piece.kind === "companion") {
      if (selected.piece.attack.ok) {
        buttons.push(`<button type="button" class="g-mini g-go is-attack" data-act="attack-go">Attack · ${selected.piece.power}</button>`);
      } else if (selected.piece.attack.reason) note = selected.piece.attack.reason;
    }
    if (selected.owner === "you" && selected.piece) {
      selected.piece.abilities.forEach((ability) => {
        if (ability.enabled) {
          buttons.push(`<button type="button" class="g-mini g-go is-ability" data-act="ability" data-ability="${esc(ability.id)}">${esc(ability.label)}</button>`);
        } else if (ability.reason) note = note || ability.reason;
      });
    }
    buttons.push('<button type="button" class="g-mini" data-act="clear-select">Cancel</button>');
    const ability = selected.piece && selected.piece.token ? "A 2/2 Companion token." : card.ability;
    return `<div class="g-action">
      <div>
        <div class="g-turn">${esc(turnName)}'s turn</div>
        <strong>${esc(selected.piece && selected.piece.token ? card.name + " token" : card.name)}</strong>
        <p>${esc(ability)}</p>
        ${note ? `<div class="g-reason">${esc(note)}</div>` : ""}
      </div>
      <div class="g-action-btns">${buttons.join("")}${end}</div>
    </div>`;
  }

  function promptHtml(pending) {
    if (!pending) return "";
    if (pending.choices) {
      const choices = pending.choices.map((choice) => {
        if (!choice.cardId) {
          return `<button type="button" class="g-mini primary" data-act="choice" data-key="${esc(choice.key)}">${esc(choice.label)}</button>`;
        }
        const card = cardById.get(choice.cardId);
        return `<button type="button" class="g-pick" data-act="choice" data-key="${esc(choice.key)}" data-card-id="${choice.cardId}">
          <img src="${esc(card.image)}" alt="${esc(card.name)}" draggable="false">
          <span class="g-zone-label">${esc(choice.label)}</span>
        </button>`;
      }).join("");
      const held = (pending.held || []).map((id) => {
        const card = cardById.get(id);
        return `<img src="${esc(card.image)}" alt="${esc(card.name)}">`;
      }).join("");
      const cancel = pending.cancellable ? '<button type="button" class="g-link" data-act="cancel-pending">Cancel</button>' : "";
      const rowClass = pending.choices.some((choice) => choice.cardId) ? "g-choice-row" : "g-text-choices";
      return `<div class="g-prompt cards" data-act="${pending.cancellable ? "cancel-pending" : "noop"}">
        <div class="g-dialog" data-act="noop">
          <h3>${esc(pending.prompt)}</h3>
          ${held ? `<div class="g-held">${held}</div>` : ""}
          <div class="${rowClass}">${choices}</div>
          <div class="g-actions">${cancel}</div>
        </div>
      </div>`;
    }
    const cancel = pending.cancellable ? '<button type="button" class="g-mini" data-act="cancel-pending">Cancel</button>' : "";
    return `<div class="g-prompt"><strong>${esc(pending.prompt)}</strong>${cancel}</div>`;
  }

  function viewerHtml() {
    if (!ui.viewer) return "";
    const cards = ui.viewer.ids.length
      ? ui.viewer.ids.map((id) => {
        const card = cardById.get(id);
        return `<button type="button" class="g-pick" data-act="inspect" data-card-id="${id}" data-token="0"><img src="${esc(card.image)}" alt="${esc(card.name)}" draggable="false"></button>`;
      }).join("")
      : "<p>No cards yet.</p>";
    return `<div class="g-prompt cards" data-act="close-viewer">
      <div class="g-dialog" data-act="noop">
        <h3>${esc(ui.viewer.title)}</h3>
        <div class="g-choice-row">${cards}</div>
        <div class="g-actions"><button type="button" class="g-mini" data-act="close-viewer">Close</button></div>
      </div>
    </div>`;
  }

  function logHtml(lines) {
    return `<div class="g-log">${lines.map((line) => `<div>${esc(line)}</div>`).join("")}</div>`;
  }

  function livingSelection(view) {
    if (!ui.selected) return null;
    if (ui.selected.zone === "hand") {
      const hand = view.you.hand.find((item) => item.uid === ui.selected.uid);
      if (!hand) {
        ui.selected = null;
        return null;
      }
      return { zone: "hand", hand, card: cardById.get(hand.cardId) };
    }
    const mine = view.you.board.find((item) => item.uid === ui.selected.uid);
    if (mine) return { zone: "board", owner: "you", piece: mine, card: cardById.get(mine.cardId) };
    const theirs = view.opp.board.find((item) => item.uid === ui.selected.uid);
    if (theirs) return { zone: "board", owner: "opp", piece: theirs, card: cardById.get(theirs.cardId) };
    ui.selected = null;
    return null;
  }

  function isLegalMinion(uid, view) {
    return !!(view.pending && view.pending.targets && view.pending.targets.some((target) => target.type === "minion" && target.uid === uid));
  }

  function isLegalHero(index, view) {
    return !!(view.pending && view.pending.targets && view.pending.targets.some((target) => target.type === "hero" && Number(target.player) === index));
  }

  function onRootClick(event) {
    const el = event.target.closest("[data-act]");
    if (!el || !match) return;
    const act = el.dataset.act;
    if (ui.busy && act !== "inspect") return;
    const view = match.getView();

    if (act === "abandon") {
      if (confirm("Leave this match and return to setup?")) leaveAndSetup();
      return;
    }
    if (act === "again") {
      leaveAndSetup();
      return;
    }
    if (act === "ready") return run(() => match.ready());
    if (act === "confirm-mulligan") return run(() => match.confirmMulligan());
    if (act === "mulligan-toggle") return run(() => match.toggleMulligan(el.dataset.uid));
    if (act === "close-viewer") {
      ui.viewer = null;
      render();
      return;
    }
    if (act === "inspect") {
      inspect(el);
      return;
    }
    if (act === "noop") return;
    if (act === "choice") return run(() => match.answer({ key: el.dataset.key }));
    if (act === "cancel-pending") return run(() => match.answer({ cancel: true }));
    if (act === "end") {
      if (notYourTurn(view)) return toast("Not your turn");
      return run(() => match.endTurn());
    }
    if (act === "concede") {
      if (confirm("Concede this match?")) run(() => match.concede());
      return;
    }
    if (act === "grave") {
      if (view.pending) {
        toast("Finish the current choice first");
        return;
      }
      const side = el.dataset.who === "opp" ? view.opp : view.you;
      ui.viewer = { title: side.name + "'s graveyard", ids: side.graveyard.slice().reverse() };
      render();
      return;
    }
    if (view.pending && view.pending.discard && act === "hand") {
      const now = Date.now();
      if (now - lastDiscard < 280) return;
      lastDiscard = now;
      run(() => match.answer({ key: el.dataset.uid }));
      return;
    }
    if (view.pending && view.pending.targets && (act === "hero" || act === "board")) {
      const target = act === "hero"
        ? { type: "hero", player: Number(el.dataset.player) }
        : { type: "minion", uid: el.dataset.uid };
      run(() => match.answer({ target }));
      return;
    }
    if (view.pending && act !== "clear-select") {
      toast(view.pending.discard ? "Click a card in your hand" : "Finish the current choice first");
      return;
    }
    if (act === "hand") {
      if (ui.selected && ui.selected.zone === "hand" && ui.selected.uid === el.dataset.uid) {
        if (notYourTurn(view)) return toast("Not your turn");
        run(() => match.playCard(el.dataset.uid));
        return;
      }
      ui.selected = { zone: "hand", uid: el.dataset.uid };
      render();
      return;
    }
    if (act === "board") {
      const already = ui.selected && ui.selected.zone === "board" && ui.selected.uid === el.dataset.uid;
      if (already) {
        const piece = view.you.board.find((item) => item.uid === el.dataset.uid);
        if (piece && piece.attack.ok) {
          if (notYourTurn(view)) return toast("Not your turn");
          run(() => match.attack(piece.uid));
          return;
        }
      }
      ui.selected = { zone: "board", uid: el.dataset.uid };
      render();
      return;
    }
    if (act === "clear-select") {
      ui.selected = null;
      render();
      return;
    }
    if (act === "play") {
      if (!ui.selected || ui.selected.zone !== "hand") return;
      if (notYourTurn(view)) return toast("Not your turn");
      run(() => match.playCard(ui.selected.uid));
      return;
    }
    if (act === "attack-go") {
      if (!ui.selected || ui.selected.zone !== "board") return;
      if (notYourTurn(view)) return toast("Not your turn");
      run(() => match.attack(ui.selected.uid));
      return;
    }
    if (act === "ability") {
      if (!ui.selected || ui.selected.zone !== "board") return;
      if (notYourTurn(view)) return toast("Not your turn");
      run(() => match.activate(ui.selected.uid, el.dataset.ability));
    }
  }

  function notYourTurn(view) {
    return !!(view && view.phase === "play" && view.yourTurn === false);
  }

  function onRootDblClick(event) {
    const el = event.target.closest("[data-act]");
    if (!el || !match || ui.busy) return;
    const view = match.getView();
    if (view.phase !== "play" || view.pending || notYourTurn(view)) return;
    if (el.dataset.act === "hand") run(() => match.playCard(el.dataset.uid));
    if (el.dataset.act === "board") {
      const piece = view.you.board.find((item) => item.uid === el.dataset.uid);
      if (piece && piece.attack.ok) run(() => match.attack(piece.uid));
    }
  }

  function inspect(el) {
    const card = cardById.get(Number(el.dataset.cardId));
    if (!card) return;
    if (el.dataset.token === "1") {
      ContigoApp.showModal({
        ...card,
        name: card.name + " token",
        ability: "A 2/2 Companion token.",
        flavor: "Process started. New friend incoming.",
      });
      return;
    }
    ContigoApp.showModal(card);
  }

  function showPreview(cardId, clientX) {
    const card = cardById.get(Number(cardId));
    if (!card) return;
    previewImg.src = card.image;
    previewImg.alt = card.name;
    const placeRight = clientX < window.innerWidth * 0.55;
    previewEl.style.left = placeRight ? "auto" : "12px";
    previewEl.style.right = placeRight ? "12px" : "auto";
    previewEl.classList.remove("hidden");
  }

  function hidePreview() {
    previewEl.classList.add("hidden");
  }

  let lanBusy = false;
  let queuedRemote = null;

  function lanToken() {
    try { return sessionStorage.getItem(LAN_TOKEN) || ""; }
    catch (err) { return ""; }
  }

  function setLanToken(token) {
    try {
      if (token) sessionStorage.setItem(LAN_TOKEN, token);
      else sessionStorage.removeItem(LAN_TOKEN);
    } catch (err) { /* private mode can block storage */ }
  }

  function setPlayMode(mode) {
    document.querySelectorAll(".g-mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    document.getElementById("g-hotseat").classList.toggle("hidden", mode !== "hotseat");
    document.getElementById("g-lan").classList.toggle("hidden", mode !== "lan");
    document.getElementById("g-lead").textContent = mode === "lan"
      ? "Two players, two screens, on the same network."
      : "Two players, one screen. Pass it when the turn ends.";
    document.getElementById("g-how-last").textContent = mode === "lan"
      ? "End the turn. Your opponent plays on their own screen. Hands stay hidden."
      : "End the turn and hand the screen to your opponent. Hands stay hidden.";
    if (mode === "lan") refreshLanLobby();
  }

  function sitDown() {
    if (lanBusy) return;
    const token = lanToken();
    const button = document.getElementById("g-lan-sit");
    if (token && button && button.dataset.leave === "1") {
      leaveTable().then(() => refreshLanLobby());
      return;
    }
    const deck = chosenDeck("lan");
    if (!deck) return;
    const name = document.getElementById("g-lan-name").value;
    lanBusy = true;
    fetch("/api/sit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, deck: deck }),
    }).then((response) => response.json().then((body) => ({ response: response, body: body }))).then((got) => {
      lanBusy = false;
      if (!got.body.ok) {
        toast(got.body.error || "Could not sit down");
        refreshLanLobby();
        return;
      }
      setLanToken(got.body.token);
      refreshLanLobby();
      if (got.body.view) openRemote(got.body);
    }, () => {
      lanBusy = false;
      toast("Start the LAN table with start-lan.bat or python host.py, then open its address.");
    });
  }

  function leaveTable() {
    const token = lanToken();
    setLanToken("");
    queuedRemote = null;
    const status = document.getElementById("g-lan-status");
    if (status) status.dataset.waiting = "";
    if (!token) return Promise.resolve();
    return fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token }),
    }).catch(() => {});
  }

  function leaveAndSetup() {
    const remote = match && !match.local;
    if (remote) leaveTable();
    showSetup();
  }

  function openRemote(data) {
    if (!data || !data.view) return;
    match = remoteMatch(data.view, data.revision || 0, data.seat);
    ui = { selected: null, viewer: null, lastPhase: "", lastLog: [], lastActive: null, busy: false };
    showMatch();
  }

  function remoteMatch(view, revision, seat) {
    return {
      local: false,
      seat: seat,
      revision: revision,
      view: view,
      getView() { return this.view; },
      confirmMulligan() { return remoteAct("confirmMulligan"); },
      toggleMulligan(uid) { return remoteAct("toggleMulligan", [uid]); },
      playCard(uid) { return remoteAct("playCard", [uid]); },
      attack(uid) { return remoteAct("attack", [uid]); },
      activate(uid, ability) { return remoteAct("activate", [uid, ability]); },
      endTurn() { return remoteAct("endTurn"); },
      answer(payload) { return remoteAct("answer", [payload]); },
      concede() { return remoteAct("concede"); },
    };
  }

  function remoteAct(name, args) {
    return fetch("/api/act", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: lanToken(), name: name, args: args || [] }),
    }).then((response) => response.json().then((body) => {
      if (body.closed) {
        setLanToken("");
        toast(body.error || "The table closed");
        showSetup();
        return { ok: false, error: body.error || "The table closed" };
      }
      if (body.view && match && !match.local) {
        match.view = body.view;
        if (body.revision != null) match.revision = body.revision;
      }
      if (body.ok === false) return { ok: false, error: body.error || "Could not do that" };
      if (!response.ok) throw new Error(body.error || "The table did not answer");
      return { ok: true };
    }));
  }

  function refreshLanLobby() {
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    const token = lanToken();
    const query = token ? "?token=" + encodeURIComponent(token) : "";
    fetch("/api/table" + query).then((response) => response.json()).then((body) => {
      const status = document.getElementById("g-lan-status");
      const button = document.getElementById("g-lan-sit");
      if (!status || !button || match) return;
      const mine = body.you === 0 || body.you === 1;
      const waiting = body.status === "waiting" && mine;
      button.dataset.leave = mine && body.status !== "empty" ? "1" : "";
      if (body.status === "empty") {
        status.innerHTML = "Nobody is waiting. Sit down to open the table.";
        button.textContent = "Sit down";
      } else if (waiting) {
        const link = (body.share && body.share[0]) ? body.share[0] : location.origin;
        status.innerHTML = "Waiting for the other player. They should open <span class=\"g-share\">" + esc(link) + "</span> and sit down.";
        button.textContent = "Leave table";
      } else if (body.status === "waiting") {
        status.textContent = (body.seats && body.seats[0] ? body.seats[0] : "Someone") + " is waiting. Sit down to be the other player.";
        button.textContent = "Sit down";
      } else if (mine) {
        status.textContent = "Starting the match...";
        button.textContent = "Leave table";
      } else {
        status.textContent = "A match is already on this table.";
        button.textContent = "Sit down";
      }
    }).catch(() => {});
  }

  function lanTick() {
    if (match && match.local) return;
    const token = lanToken();
    if (!token) {
      const lan = document.getElementById("g-lan");
      if (lan && !lan.classList.contains("hidden") && !match) refreshLanLobby();
      return;
    }
    fetch("/api/state?token=" + encodeURIComponent(token)).then((response) => response.json()).then((body) => {
      if (match && match.local) return;
      if (body.closed) {
        setLanToken("");
        toast(body.error || "The other player left the table");
        if (match) showSetup();
        else refreshLanLobby();
        return;
      }
      if (!body.view) {
        if (!match) refreshLanLobby();
        return;
      }
      if (!match) {
        openRemote(body);
        return;
      }
      if (body.revision == null || body.revision <= match.revision) return;
      if (ui.busy) {
        queuedRemote = body;
        return;
      }
      applyRemote(body);
    }).catch(() => {});
  }

  function applyRemote(data) {
    if (!match || match.local || !data || !data.view) return;
    const before = captureStage();
    match.view = data.view;
    match.revision = data.revision;
    const plan = planAnimation(before, data.view);
    if (!plan) {
      render();
      return;
    }
    const token = ++fxToken;
    ui.busy = true;
    clearTimeout(ui.busyTimer);
    ui.busyTimer = setTimeout(() => {
      if (token !== fxToken) return;
      ui.busy = false;
      render();
      drainRemote();
    }, 2000);
    playAnimation(token, plan, before).then(() => {
      clearTimeout(ui.busyTimer);
      if (token === fxToken) ui.busy = false;
      drainRemote();
    }, () => {
      clearTimeout(ui.busyTimer);
      if (token === fxToken) ui.busy = false;
      render();
      drainRemote();
    });
  }

  function drainRemote() {
    if (ui.busy || !queuedRemote || !match || match.local) return;
    const data = queuedRemote;
    queuedRemote = null;
    if (data.revision <= match.revision) return;
    applyRemote(data);
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }
})();
