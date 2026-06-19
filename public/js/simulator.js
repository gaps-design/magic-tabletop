(function () {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room") || localStorage.getItem("resenhaon-last-simulator-room") || "mtg-1002";
  const savedPlayerId = localStorage.getItem("resenhaon-simulator-player-id") || `sim-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const savedName = localStorage.getItem("resenhaon-simulator-name") || "";
  const socket = io();
  const scryfallCache = new Map(JSON.parse(localStorage.getItem("resenhaon-sim-scryfall-cache") || "[]"));

  let playerId = savedPlayerId;
  let state = null;
  let loadedDeck = null;
  let activeCard = null;
  let privateCards = [];

  localStorage.setItem("resenhaon-simulator-player-id", playerId);
  localStorage.setItem("resenhaon-last-simulator-room", roomId);

  const el = id => document.getElementById(id);
  const phases = {
    untap: "Untap",
    upkeep: "Upkeep",
    draw: "Draw",
    main1: "Main 1",
    beginCombat: "Begin Combat",
    attackers: "Attackers",
    blockers: "Blockers",
    damage: "Damage",
    endCombat: "End Combat",
    main2: "Main 2",
    end: "End Step",
    cleanup: "Cleanup"
  };

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function normalizeName(name) {
    return String(name || "").replace(/\s+/g, " ").trim();
  }

  function saveCache() {
    localStorage.setItem("resenhaon-sim-scryfall-cache", JSON.stringify(Array.from(scryfallCache.entries()).slice(-300)));
  }

  function parseDecklist(text) {
    const main = [];
    const side = [];
    let sideMode = false;

    String(text || "").split(/\r?\n/).forEach(rawLine => {
      let line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("#")) return;
      if (/^sideboard\s*:?\s*$/i.test(line)) {
        sideMode = true;
        return;
      }

      let target = sideMode ? side : main;
      const sbMatch = line.match(/^SB:\s*(\d+)?\s*(.+)$/i);
      if (sbMatch) {
        target = side;
        line = `${sbMatch[1] || 1} ${sbMatch[2]}`;
      }

      line = line.replace(/\s*\[[^\]]+\]\s*$/g, "").replace(/\s*\([^)]+\)\s*\d*$/g, "").trim();
      const match = line.match(/^(\d+)x?\s+(.+)$/i);
      const count = match ? Math.max(1, Math.min(99, Number(match[1]))) : 1;
      const name = normalizeName(match ? match[2] : line);
      if (!name) return;
      for (let i = 0; i < count; i++) target.push(name);
    });

    return { main, side };
  }

  async function fetchCard(name, index) {
    const key = name.toLowerCase();
    if (scryfallCache.has(key)) return { ...scryfallCache.get(key), id: `${key}-${index}-${Math.random().toString(36).slice(2)}` };

    try {
      const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`);
      if (!response.ok) throw new Error("not found");
      const card = await response.json();
      const normalized = {
        name: card.name || name,
        type: card.type_line || "Card",
        cost: card.mana_cost || "",
        imageUrl: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || card.image_uris?.small || "",
        oracleText: card.oracle_text || card.card_faces?.[0]?.oracle_text || "",
        colors: card.colors || [],
        scryfallId: card.id || ""
      };
      scryfallCache.set(key, normalized);
      saveCache();
      return { ...normalized, id: `${card.id || key}-${index}-${Math.random().toString(36).slice(2)}` };
    } catch (error) {
      const fallback = { name, type: "Carta nao encontrada", cost: "", imageUrl: "", oracleText: "", colors: [], scryfallId: "" };
      scryfallCache.set(key, fallback);
      saveCache();
      return { ...fallback, id: `${key}-${index}-${Math.random().toString(36).slice(2)}` };
    }
  }

  async function hydrateDeck(parsed) {
    const total = parsed.main.length + parsed.side.length;
    let loaded = 0;
    const setStatus = () => {
      el("deckStatus").textContent = `Carregando cartas... ${loaded}/${total}`;
    };
    setStatus();
    const mainDeck = [];
    const sideboard = [];
    for (const name of parsed.main) {
      mainDeck.push(await fetchCard(name, loaded));
      loaded++;
      setStatus();
    }
    for (const name of parsed.side) {
      sideboard.push(await fetchCard(name, loaded));
      loaded++;
      setStatus();
    }
    const unique = new Set([...parsed.main, ...parsed.side].map(name => name.toLowerCase())).size;
    loadedDeck = { mainDeck, sideboard };
    const warning = parsed.main.length !== 60 || parsed.side.length > 15
      ? " Aviso: lista fora do padrao 60/15, carregada em modo teste."
      : "";
    el("deckStatus").textContent = `Main deck: ${parsed.main.length} cartas | Sideboard: ${parsed.side.length} cartas | Cartas unicas: ${unique}.${warning}`;
  }

  function mockDeck() {
    const names = ["Lightning Bolt", "Counterspell", "Island", "Llanowar Elves", "Sol Ring", "Command Tower", "Arcane Signet"];
    return {
      mainDeck: Array.from({ length: 60 }, (_, index) => ({
        id: `mock-${index}-${Date.now()}`,
        name: names[index % names.length],
        type: index % 3 === 0 ? "Land" : "Spell",
        cost: index % 3 === 0 ? "" : "1",
        imageUrl: "",
        oracleText: "",
        colors: [],
        scryfallId: ""
      })),
      sideboard: []
    };
  }

  function selfPlayer() {
    return state?.players?.[playerId] || null;
  }

  function opponentPlayer() {
    return Object.values(state?.players || {}).find(player => player.id !== playerId) || null;
  }

  function sendAction(action) {
    socket.emit("simulator-action", { roomId, playerId, action });
  }

  function createGame() {
    const name = el("playerNameInput").value.trim() || savedName || "Jogador";
    localStorage.setItem("resenhaon-simulator-name", name);
    socket.emit("simulator-join", { roomId, playerId, name });
    sendAction({ type: "loadDeck", deck: loadedDeck || mockDeck() });
    el("gameModal").classList.remove("active");
    el("gameModal").classList.add("hidden");
  }

  function cardHtml(card, zone, owner) {
    const image = card.imageUrl ? `style="background-image:url('${escapeHtml(card.imageUrl)}')"` : "";
    return `
      <article class="sim-card ${card.imageUrl ? "" : "no-image"} ${card.tapped ? "tapped" : ""} ${card.attacking ? "attacking" : ""} ${card.blocking ? "blocking" : ""}"
        ${image} data-card-id="${escapeHtml(card.id)}" data-zone="${zone}" data-owner="${owner}">
        <div class="card-text">
          ${card.token ? `<span class="token-tag">TOKEN</span>` : ""}
          ${Number(card.counters?.p1p1 || 0) ? `<span class="counter-tag">+1/+1 ${Number(card.counters.p1p1)}</span>` : ""}
          ${Number(card.counters?.generic || 0) ? `<span class="counter-tag">M ${Number(card.counters.generic)}</span>` : ""}
          <h3>${escapeHtml(card.name)}</h3>
          <p>${escapeHtml(card.type)} ${card.cost ? `| ${escapeHtml(card.cost)}` : ""}</p>
        </div>
      </article>`;
  }

  function miniCardHtml(card, zone, owner) {
    const image = card.imageUrl ? `style="background-image:url('${escapeHtml(card.imageUrl)}')"` : "";
    return `<article class="mini-card ${card.imageUrl ? "" : "no-image"}" ${image} data-card-id="${escapeHtml(card.id)}" data-zone="${zone}" data-owner="${owner}"><span>${escapeHtml(card.name)}</span></article>`;
  }

  function renderCards(container, cards, zone, owner) {
    container.innerHTML = cards?.length
      ? cards.map(card => cardHtml(card, zone, owner)).join("")
      : `<div class="empty-zone">Vazio</div>`;
  }

  function renderSmall(container, cards, zone, owner) {
    container.innerHTML = cards?.length
      ? cards.map(card => miniCardHtml(card, zone, owner)).join("")
      : "";
  }

  function renderHandBack(container, count) {
    container.innerHTML = Array.from({ length: Math.min(12, count || 0) }, () => `<span class="hand-back"></span>`).join("");
  }

  function renderPlayer(player, side) {
    const isSelf = side === "self";
    if (!player) {
      if (!isSelf) {
        el("opponentName").textContent = "Aguardando oponente";
        el("opponentLife").textContent = "20";
        renderHandBack(el("opponentHand"), 0);
        ["opponentBattlefield", "opponentStack", "opponentGraveyard", "opponentExile", "opponentRevealed"].forEach(id => { el(id).innerHTML = ""; });
      }
      return;
    }

    if (isSelf) {
      el("selfName").textContent = player.name;
      el("selfLife").textContent = String(player.life ?? 20);
      el("libraryCount").textContent = String(player.libraryCount || 0);
      el("handCount").textContent = `${player.handCount || 0} cartas`;
      el("selfPhaseLabel").textContent = phases[player.currentPhase] || player.currentPhase || "Untap";
      renderCards(el("battlefieldZone"), player.battlefield || [], "battlefield", "self");
      renderCards(el("selfStack"), player.stack || [], "stack", "self");
      renderCards(el("handZone"), player.hand || [], "hand", "self");
      renderSmall(el("graveyardZone"), player.graveyard || [], "graveyard", "self");
      renderSmall(el("exileZone"), player.exile || [], "exile", "self");
      renderSmall(el("selfRevealed"), player.revealed || [], "revealed", "self");
    } else {
      el("opponentName").textContent = player.name;
      el("opponentLife").textContent = String(player.life ?? 20);
      el("opponentLibraryCount").textContent = String(player.libraryCount || 0);
      renderHandBack(el("opponentHand"), player.handCount || 0);
      renderCards(el("opponentBattlefield"), player.battlefield || [], "battlefield", "opponent");
      renderCards(el("opponentStack"), player.stack || [], "stack", "opponent");
      renderSmall(el("opponentGraveyard"), player.graveyard || [], "graveyard", "opponent");
      renderSmall(el("opponentExile"), player.exile || [], "exile", "opponent");
      renderSmall(el("opponentRevealed"), player.revealed || [], "revealed", "opponent");
    }
  }

  function renderLog() {
    const log = state?.log || [];
    el("actionLog").innerHTML = log.length
      ? log.slice(0, 50).map(item => `<div class="log-item">${escapeHtml(item.message)}</div>`).join("")
      : `<div class="empty-zone">Sem acoes ainda.</div>`;
  }

  function render() {
    const self = selfPlayer();
    const opponent = opponentPlayer();
    const players = Object.values(state?.players || {});
    const currentPhase = state?.currentPhase || "untap";
    el("roomTitle").textContent = `Sala ${roomId}`;
    el("sideRoomId").textContent = roomId;
    el("playerCount").textContent = String(players.length);
    el("currentPhaseLabel").textContent = phases[currentPhase] || currentPhase;
    document.querySelectorAll(".phase-strip button").forEach(button => button.classList.toggle("active", button.dataset.phase === currentPhase));
    renderPlayer(self, "self");
    renderPlayer(opponent, "opponent");
    renderLog();
  }

  function openCardMenu(cardEl, x, y) {
    const zone = cardEl.dataset.zone;
    const owner = cardEl.dataset.owner;
    const cardId = cardEl.dataset.cardId;
    const menu = el("cardMenu");
    if (owner !== "self") return;

    const buttons = [];
    if (zone === "hand") {
      buttons.push(["Jogar para pilha", { type: "playToStack", cardId }]);
      buttons.push(["Descartar", { type: "moveCard", cardId, toZone: "graveyard" }]);
      buttons.push(["Exilar", { type: "moveCard", cardId, toZone: "exile" }]);
      buttons.push(["Topo do grimorio", { type: "moveCard", cardId, toZone: "library", position: "top" }]);
      buttons.push(["Fundo do grimorio", { type: "moveCard", cardId, toZone: "library", position: "bottom" }]);
    } else if (zone === "stack") {
      buttons.push(["Resolver para campo", { type: "resolveStack", cardId, toZone: "battlefield" }]);
      buttons.push(["Resolver para cemiterio", { type: "resolveStack", cardId, toZone: "graveyard" }]);
      buttons.push(["Resolver para exilio", { type: "resolveStack", cardId, toZone: "exile" }]);
      buttons.push(["Voltar para mao", { type: "resolveStack", cardId, toZone: "hand" }]);
    } else {
      buttons.push(["Virar/desvirar", { type: "toggleTap", cardId }]);
      buttons.push(["Enviar para pilha", { type: "moveCard", cardId, toZone: "stack" }]);
      buttons.push(["Cemiterio", { type: "moveCard", cardId, toZone: "graveyard" }]);
      buttons.push(["Exilar", { type: "moveCard", cardId, toZone: "exile" }]);
      buttons.push(["Voltar para mao", { type: "moveCard", cardId, toZone: "hand" }]);
      buttons.push(["Adicionar +1/+1", { type: "counter", cardId, counterType: "p1p1", value: 1 }]);
      buttons.push(["Remover +1/+1", { type: "counter", cardId, counterType: "p1p1", value: -1 }]);
      buttons.push(["Declarar atacante", { type: "combatFlag", cardId, flag: "attacking", enabled: true }]);
      buttons.push(["Remover atacante", { type: "combatFlag", cardId, flag: "attacking", enabled: false }]);
      buttons.push(["Declarar bloqueador", { type: "combatFlag", cardId, flag: "blocking", enabled: true }]);
      buttons.push(["Remover bloqueador", { type: "combatFlag", cardId, flag: "blocking", enabled: false }]);
    }

    menu.innerHTML = buttons.map(([label], index) => `<button data-menu-index="${index}">${escapeHtml(label)}</button>`).join("");
    menu.querySelectorAll("button").forEach((button, index) => button.addEventListener("click", () => {
      sendAction(buttons[index][1]);
      closeCardMenu();
    }));
    menu.style.left = `${Math.min(window.innerWidth - 220, x)}px`;
    menu.style.top = `${Math.min(window.innerHeight - 260, y)}px`;
    menu.classList.remove("hidden");
  }

  function closeCardMenu() {
    el("cardMenu").classList.add("hidden");
  }

  function openPrivateModal(title, cards) {
    privateCards = cards || [];
    el("privateModalTitle").textContent = title;
    el("privateModalContent").innerHTML = privateCards.length
      ? privateCards.map(card => cardHtml(card, "private", "private")).join("")
      : `<div class="empty-zone">Nada para mostrar.</div>`;
    el("privateModal").classList.remove("hidden");
  }

  function bindEvents() {
    el("playerNameInput").value = savedName;
    el("openGameModalBtn").addEventListener("click", () => el("gameModal").classList.remove("hidden"));
    el("cancelGameBtn").addEventListener("click", () => el("gameModal").classList.add("hidden"));
    el("createGameBtn").addEventListener("click", createGame);
    el("loadDeckBtn").addEventListener("click", () => el("deckFileInput").click());
    el("deckFileInput").addEventListener("change", async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      const parsed = parseDecklist(await file.text());
      await hydrateDeck(parsed);
    });

    document.querySelectorAll("[data-life]").forEach(button => {
      button.addEventListener("click", () => sendAction({ type: "life", value: Number(button.dataset.life || 0) }));
    });
    document.querySelectorAll(".phase-strip button").forEach(button => {
      button.addEventListener("click", () => sendAction({ type: "phase", value: button.dataset.phase }));
    });
    el("createTokenBtn").addEventListener("click", () => sendAction({ type: "token", value: el("tokenSelect").value }));
    el("rollD20Btn").addEventListener("click", () => alert(`d20: ${Math.floor(Math.random() * 20) + 1}`));
    el("toggleCommandsBtn").addEventListener("click", () => el("commandsPanel").classList.toggle("collapsed"));
    el("closePrivateModal").addEventListener("click", () => el("privateModal").classList.add("hidden"));

    document.querySelectorAll("[data-command]").forEach(button => {
      button.addEventListener("click", () => {
        const command = button.dataset.command;
        const self = selfPlayer();
        if (command === "drawX") sendAction({ type: "draw", value: Number(prompt("Comprar quantas cartas?", "3") || 0) });
        else if (command === "mill") sendAction({ type: "mill", value: Number(prompt("Colocar quantas cartas no cemiterio?", "3") || 0) });
        else if (command === "viewDeck") openPrivateModal("Seu deck", self?.library || []);
        else if (command === "peekTop") openPrivateModal("Carta do topo", (self?.library || []).slice(0, 1));
        else if (command === "viewTopX") openPrivateModal("Cartas do topo", (self?.library || []).slice(0, Number(prompt("Ver quantas cartas?", "3") || 0)));
        else sendAction({ type: command });
      });
    });

    document.body.addEventListener("click", event => {
      const card = event.target.closest(".sim-card,.mini-card");
      if (card && !event.target.closest("#privateModalContent")) {
        openCardMenu(card, event.clientX, event.clientY);
        return;
      }
      if (!event.target.closest("#cardMenu")) closeCardMenu();
    });
    document.body.addEventListener("contextmenu", event => {
      const card = event.target.closest(".sim-card,.mini-card");
      if (card) {
        event.preventDefault();
        openCardMenu(card, event.clientX, event.clientY);
      }
    });
  }

  socket.on("connect", () => {});
  socket.on("simulator-state", payload => {
    state = payload;
    render();
  });

  bindEvents();
})();
