/* Match authority for the LAN table. Hands stay in this page. */
(function () {
  let game = null;
  let generation = 0;
  const wid = Math.random().toString(36).slice(2) + Date.now().toString(36);

  function publish() {
    return { "0": game.getView(0), "1": game.getView(1) };
  }

  function flushPass() {
    for (let i = 0; i < 6; i++) {
      if (game.getView().phase !== "pass") return;
      const result = game.ready();
      if (!result || !result.ok) return;
    }
  }

  function actingSeat() {
    const view = game.getView();
    if (view.phase === "mulligan") return view.mulligan.index;
    if (view.phase === "play") return view.active;
    return -1;
  }

  function apply(job) {
    if (!job || job.op === "ping" || job.op === "busy") {
      return { gen: generation, views: game ? publish() : null };
    }
    if (job.op === "start") {
      try {
        game = ContigoEngine.createGame({
          cards: ContigoApp.cards,
          playerNames: job.names,
          decks: job.decks,
          firstPlayer: "random",
        });
        generation = job.gen;
        flushPass();
        return { job: job.id, gen: job.gen, ok: true, views: publish() };
      } catch (err) {
        game = null;
        generation = job.gen;
        return { job: job.id, gen: job.gen, ok: false, error: err.message || "Could not start", views: null };
      }
    }
    if (job.op === "stop") {
      game = null;
      generation = job.gen;
      return { job: job.id, gen: job.gen, ok: true, views: null };
    }
    if (job.op === "act") {
      if (!game || job.gen !== generation) {
        return { job: job.id, gen: job.gen, ok: false, error: "The table closed", views: null };
      }
      if (job.seat !== actingSeat()) {
        return { job: job.id, gen: job.gen, ok: false, error: "Not your turn", views: publish() };
      }
      const args = job.args || [];
      let result;
      try {
        if (job.name === "confirmMulligan") result = game.confirmMulligan();
        else if (job.name === "toggleMulligan") result = game.toggleMulligan(args[0]);
        else if (job.name === "playCard") result = game.playCard(args[0]);
        else if (job.name === "attack") result = game.attack(args[0]);
        else if (job.name === "activate") result = game.activate(args[0], args[1]);
        else if (job.name === "endTurn") result = game.endTurn();
        else if (job.name === "answer") result = game.answer(args[0] || {});
        else if (job.name === "concede") result = game.concede();
        else result = { ok: false, error: "Unknown action" };
      } catch (err) {
        return { job: job.id, gen: job.gen, ok: false, error: err.message || "Something went wrong", views: publish() };
      }
      if (result && result.ok) flushPass();
      return {
        job: job.id,
        gen: job.gen,
        ok: !!(result && result.ok),
        error: result && result.error,
        views: publish(),
      };
    }
    return { gen: generation, views: game ? publish() : null };
  }

  async function tick(previous) {
    let job = { op: "ping" };
    try {
      const response = await fetch("/api/worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wid: wid, result: previous }),
      });
      job = await response.json();
    } catch (err) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return tick(previous);
    }
    if (job && job.op === "busy") return;
    const next = apply(job);
    return tick(next);
  }

  tick(null);
})();
