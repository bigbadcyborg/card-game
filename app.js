const cards = [
  { id: 1, name: "WiFi Potato", type: "Node", cost: 0, pt: "", ability: "Tap: Add 1 Signal.", flavor: "It's not a potato, it's a router with aspirations.", image: "images/wifi-potato.jpg" },
  { id: 2, name: "Server Closet", type: "Node", cost: 0, pt: "", ability: "Tap: Add 1 Signal.", flavor: "It's bigger on the inside. And louder.", image: "images/server-closet.jpg" },
  { id: 3, name: "Battery Bank", type: "Node", cost: 0, pt: "", ability: "Tap: Add 1 Signal. Once per turn, pay 1 Signal to gain 1 life.", flavor: "It never sleeps. Neither do you now.", image: "images/battery-bank.jpg" },
  { id: 4, name: "Hotspot Buddy", type: "Node", cost: 0, pt: "", ability: "Tap: Add 1 Signal. When this enters, gain 1 life.", flavor: "Your personal signal friend.", image: "images/hotspot-buddy.jpg" },
  { id: 5, name: "Extension Cord", type: "Node", cost: 0, pt: "", ability: "Tap: Add 1 Signal or gain 1 life.", flavor: "It reaches further than you think.", image: "images/extension-cord.jpg" },
  { id: 6, name: "Cloud Node", type: "Node", cost: 0, pt: "", ability: "Tap: Add 1 Signal. Your Action spells cost 1 less.", flavor: "Data with a soft landing.", image: "images/cloud-node.jpg" },
  { id: 7, name: "Loyal Companion Bot", type: "Companion", cost: 2, pt: "2/2", ability: "When this enters, draw a card.", flavor: "It follows you. Even into the bathroom.", image: "images/loyal-companion-bot.jpg" },
  { id: 8, name: "Network Ally", type: "Companion", cost: 3, pt: "3/3", ability: "When this enters, you may put a Node from your hand onto the battlefield.", flavor: "It brings the whole network together.", image: "images/network-ally.jpg" },
  { id: 9, name: "Swift Runner (Lag Edition)", type: "Companion", cost: 2, pt: "2/1", ability: "Haste. When this attacks, you may draw a card.", flavor: "It's fast... eventually.", image: "images/swift-runner.jpg" },
  { id: 10, name: "Blue Screen Guardian", type: "Companion", cost: 2, pt: "1/3", ability: "Tap: Gain 1 life.", flavor: "It crashes so you don't have to.", image: "images/blue-screen-guardian.jpg" },
  { id: 11, name: "Support Partner", type: "Companion", cost: 1, pt: "1/1", ability: "When this enters, put a +1/+1 counter on another Companion you control.", flavor: "Teamwork makes the dream work.", image: "images/support-partner.jpg" },
  { id: 12, name: "Border Ally (Firewall)", type: "Companion", cost: 3, pt: "2/2", ability: "When this enters, deal 1 damage to target opponent.", flavor: "Nothing gets past this wall.", image: "images/border-ally.jpg" },
  { id: 13, name: "Helpful Friend (Auto-Correct)", type: "Companion", cost: 2, pt: "1/2", ability: "Tap: Draw a card, then discard a card.", flavor: "It fixed your spelling. You're welcome.", image: "images/helpful-friend.jpg" },
  { id: 14, name: "Protector (Antivirus)", type: "Companion", cost: 3, pt: "2/3", ability: "Your other Companions can't be blocked by Companions with Power 1 or less.", flavor: "Scanning... all clear.", image: "images/protector.jpg" },
  { id: 15, name: "Family Bond (Group Chat)", type: "Companion", cost: 2, pt: "3/2", ability: "When this dies, gain 2 life.", flavor: "The chat continues without you.", image: "images/family-bond.jpg" },
  { id: 16, name: "Inclusion Guide (Onboarding Bot)", type: "Companion", cost: 4, pt: "3/4", ability: "When this enters, search your library for a Node and put it onto the battlefield, then shuffle.", flavor: "Welcome to the network.", image: "images/inclusion-guide.jpg" },
  { id: 17, name: "Quick Ally (Notification)", type: "Companion", cost: 1, pt: "1/1", ability: "Haste. When this deals combat damage, draw a card.", flavor: "Ping! You have a new friend.", image: "images/quick-ally.jpg" },
  { id: 18, name: "Steady Holder (Always-On Display)", type: "Companion", cost: 2, pt: "0/4", ability: "At the beginning of your upkeep, gain 1 life.", flavor: "Always watching. Always caring.", image: "images/steady-holder.jpg" },
  { id: 19, name: "Ally Surge (System Update)", type: "Action", cost: 3, pt: "", ability: "Deal 3 damage to any target. Draw a card if you control a Companion.", flavor: "Update complete.", image: "images/ally-surge.jpg" },
  { id: 20, name: "Instant Support (Ctrl+Z)", type: "Action", cost: 1, pt: "", ability: "Draw 2 cards, then discard 1.", flavor: "Undo that last decision.", image: "images/instant-support.jpg" },
  { id: 21, name: "Gentle Return (Undo)", type: "Action", cost: 2, pt: "", ability: "Return target Companion to its owner's hand.", flavor: "Let's try that again.", image: "images/gentle-return.jpg" },
  { id: 22, name: "Life Share (Battery Share)", type: "Action", cost: 2, pt: "", ability: "Gain 3 life. Target opponent loses 1 life.", flavor: "Share the juice.", image: "images/life-share.jpg" },
  { id: 23, name: "Look Ahead (Tab Preview)", type: "Action", cost: 1, pt: "", ability: "Look at the top 3 cards of your library. Put one into your hand and the rest on the bottom.", flavor: "Spoiler alert.", image: "images/look-ahead.jpg" },
  { id: 24, name: "Bond Denial (404 Error)", type: "Action", cost: 2, pt: "", ability: "Counter target spell.", flavor: "Page not found. Neither is your spell.", image: "images/bond-denial.jpg" },
  { id: 25, name: "Strong Connection (Full Bars)", type: "Action", cost: 4, pt: "", ability: "Deal 4 damage to target opponent. You gain 2 life.", flavor: "Maximum signal. Maximum impact.", image: "images/strong-connection.jpg" },
  { id: 26, name: "Call Companion (Spawn Process)", type: "Action", cost: 3, pt: "", ability: "Create a 2/2 Loyal Companion Bot token.", flavor: "Process started. New friend incoming.", image: "images/call-companion.jpg" },
  { id: 27, name: "Always With You (Background Process)", type: "Bond", cost: 2, pt: "", ability: "Your Companions cost 1 less to cast.", flavor: "Contigo — with you. Even when you don't want it.", image: "images/always-with-you.jpg" },
  { id: 28, name: "Shared Presence (Sync)", type: "Bond", cost: 2, pt: "", ability: "At the beginning of your upkeep, draw a card if you control a Companion.", flavor: "Always in sync.", image: "images/shared-presence.jpg" },
  { id: 29, name: "Protective Bond (Firewall Rule)", type: "Bond", cost: 3, pt: "", ability: "Companions you control get +0/+1 and can't be the target of opponent's spells.", flavor: "Rules are rules.", image: "images/protective-bond.jpg" },
  { id: 30, name: "Ally Network (Mesh Network)", type: "Bond", cost: 3, pt: "", ability: "Whenever you cast an Action, deal 1 damage to target opponent and gain 1 life.", flavor: "Everyone's connected.", image: "images/ally-network.jpg" }
];

let deck = [];
let currentFilter = "all";

function renderCards(containerId, list, onClick) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  list.forEach(card => {
    if (currentFilter !== "all" && card.type !== currentFilter && containerId === "card-grid") return;
    const el = document.createElement("div");
    el.className = "card";
    const img = document.createElement("img");
    img.className = "card-img";
    img.src = card.image;
    img.alt = card.name;
    img.loading = "lazy";
    el.appendChild(img);
    el.addEventListener("click", () => onClick(card));
    container.appendChild(el);
  });
}

function showModal(card) {
  const modal = document.getElementById("modal");
  const body = document.getElementById("modal-body");
  const inDeck = document.getElementById("deck").classList.contains("active");
  body.replaceChildren();

  const img = document.createElement("img");
  img.className = "modal-card-img";
  img.src = card.image;
  img.alt = card.name;

  const title = document.createElement("h2");
  title.textContent = card.name;

  const type = document.createElement("div");
  type.className = "card-type";
  type.textContent = card.type + (card.pt ? " • " + card.pt : "") + " • Cost " + (Number(card.cost) || 0);

  const ability = document.createElement("p");
  ability.className = "modal-ability";
  ability.textContent = card.ability;

  const flavor = document.createElement("p");
  flavor.className = "modal-flavor";
  flavor.textContent = "“" + card.flavor + "”";

  body.append(img, title, type, ability, flavor);

  if (inDeck) {
    const addBtn = document.createElement("button");
    addBtn.id = "add-to-deck";
    addBtn.className = "btn-add";
    addBtn.type = "button";
    addBtn.textContent = "Add to Deck";
    addBtn.onclick = () => { addToDeck(card); modal.classList.remove("show"); };
    body.appendChild(addBtn);
  }

  modal.classList.add("show");
}

function addToDeck(card) {
  if (deck.length >= 40) return alert("Deck is full (40 cards)");
  deck.push(card);
  updateDeck();
}

function updateDeck() {
  document.getElementById("deck-count").textContent = `${deck.length}/40`;
  const list = document.getElementById("deck-list");
  list.innerHTML = "";
  const counts = {};
  deck.forEach(c => counts[c.name] = (counts[c.name] || 0) + 1);
  Object.entries(counts).forEach(([name, count]) => {
    const item = document.createElement("div");
    item.className = "deck-item";
    item.innerHTML = `<span>${name}</span><span>×${count}</span>`;
    list.appendChild(item);
  });
}

window.ContigoApp = {
  get cards() { return cards; },
  getDeck() { return deck.map((card) => card.id); },
  showModal,
};

function init() {
  renderCards("card-grid", cards, showModal);
  renderCards("deck-available", cards, showModal);

  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.view).classList.add("active");
      if (btn.dataset.view === "deck") renderCards("deck-available", cards, showModal);
    });
  });

  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.type;
      renderCards("card-grid", cards, showModal);
    });
  });

  document.querySelector(".close").addEventListener("click", () => document.getElementById("modal").classList.remove("show"));
  document.getElementById("modal").addEventListener("click", e => { if (e.target.id === "modal") e.target.classList.remove("show"); });

  document.getElementById("clear-deck").addEventListener("click", () => { deck = []; updateDeck(); });
}

if (document.getElementById("card-grid")) init();