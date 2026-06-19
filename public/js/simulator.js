(function () {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room") || localStorage.getItem("resenhaon-last-simulator-room") || "mtg-1002";
  const savedPlayerId = localStorage.getItem("resenhaon-simulator-player-id") || `sim-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const savedName = localStorage.getItem("resenhaon-simulator-name") || "";
  const socket = io();
  const scryfallCache = new Map(JSON.parse(localStorage.getItem("resenhaon-sim-scryfall-cache") || "[]"));
  const TOKEN_OPTIONS = [
    ["treasure", "Treasure", "Token Artifact"],
    ["food", "Food", "Token Artifact"],
    ["clue", "Clue", "Token Artifact"],
    ["blood", "Blood", "Token Artifact"],
    ["map", "Map", "Token Artifact"],
    ["soldier", "Soldier", "Token Creature 1/1"],
    ["zombie", "Zombie", "Token Creature 2/2"],
    ["spirit", "Spirit", "Token Creature 1/1"],
    ["goblin", "Goblin", "Token Creature 1/1"],
    ["saproling", "Saproling", "Token Creature 1/1"],
    ["angel", "Angel", "Token Creature 4/4"],
    ["beast", "Beast", "Token Creature 3/3"],
    ["human", "Human", "Token Creature 1/1"],
    ["thopter", "Thopter", "Token Artifact Creature 1/1"]
  ];
  const COLORED_MARKERS = [
    ["blue", "Azul"], ["green", "Verde"], ["red", "Vermelho"],
    ["white", "Branco"], ["black", "Preto"], ["colorless", "Incolor"]
  ];
  const ABILITY_MARKERS = ["Voar", "Atropelar", "Infectar", "Vigilancia", "Impeto", "Toque mortifero", "Vinculo com a vida", "Ameacar", "Escudo", "Atordoar"];

  let playerId = savedPlayerId;
  let state = null;
  let loadedDeck = null;
  let lastParsedDeck = null;
  let lastMissingNames = [];
  let activeCard = null;
  let privateCards = [];
  let touchTimer = null;
  let timerRemaining = Number(localStorage.getItem("resenhaon-sim-timer-remaining") || 3000);
  let timerInterval = null;

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

  function normalizeLookupName(name) {
    return normalizeName(name)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s*\[[^\]]+\]\s*$/g, "")
      .replace(/\s*\([A-Z0-9]{2,6}\)\s*\d*\s*$/i, "")
      .replace(/\s+#?\d+[a-z]?\s*$/i, "")
      .trim();
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
      const name = normalizeLookupName(match ? match[2] : line);
      if (!name) return;
      for (let i = 0; i < count; i++) target.push(name);
    });

    return { main, side };
  }

  function readDeckFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Nao foi possivel ler o arquivo."));
      reader.readAsText(file);
    });
  }

  async function requestScryfall(name, mode) {
    const response = await fetch(`https://api.scryfall.com/cards/named?${mode}=${encodeURIComponent(name)}`);
    if (!response.ok) throw new Error("not found");
    return response.json();
  }

  async function fetchCard(name, index, retry = false) {
    const cleanName = normalizeLookupName(name);
    const key = cleanName.toLowerCase();
    if (scryfallCache.has(key)) return { ...scryfallCache.get(key), id: `${key}-${index}-${Math.random().toString(36).slice(2)}` };

    try {
      let card;
      try {
        card = await requestScryfall(cleanName, "exact");
      } catch {
        card = await requestScryfall(cleanName, "fuzzy");
      }
      const normalized = {
        name: card.name || cleanName,
        type: card.type_line || "Card",
        cost: card.mana_cost || "",
        imageUrl: card.image_uris?.large || card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.large || card.card_faces?.[0]?.image_uris?.normal || "",
        oracleText: card.oracle_text || card.card_faces?.[0]?.oracle_text || "",
        colors: card.colors || [],
        scryfallId: card.id || ""
      };
      scryfallCache.set(key, normalized);
      saveCache();
      return { ...normalized, id: `${card.id || key}-${index}-${Math.random().toString(36).slice(2)}` };
    } catch (error) {
      const fallback = { name: cleanName || name, type: "Carta nao encontrada", cost: "", imageUrl: "", oracleText: retry ? "Busca manual ainda disponivel." : "Use o botao de tentar faltantes ou ajuste o nome manualmente.", colors: [], scryfallId: "" };
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
    lastMissingNames = [];
    for (const name of parsed.main) {
      mainDeck.push(await fetchCard(name, loaded));
      if (mainDeck[mainDeck.length - 1].type === "Carta nao encontrada") lastMissingNames.push(name);
      loaded++;
      setStatus();
    }
    for (const name of parsed.side) {
      sideboard.push(await fetchCard(name, loaded));
      if (sideboard[sideboard.length - 1].type === "Carta nao encontrada") lastMissingNames.push(name);
      loaded++;
      setStatus();
    }
    const unique = new Set([...parsed.main, ...parsed.side].map(name => name.toLowerCase())).size;
    loadedDeck = { mainDeck, sideboard };
    const warning = parsed.main.length !== 60 || parsed.side.length > 15
      ? " Aviso: lista fora do padrao 60/15, carregada em modo teste."
      : "";
    el("deckStatus").textContent = `Main deck: ${parsed.main.length} cartas | Sideboard: ${parsed.side.length} cartas | Cartas unicas: ${unique} | Encontradas: ${total - lastMissingNames.length} | Nao encontradas: ${lastMissingNames.length}.${warning}`;
    el("retryMissingBtn").classList.toggle("hidden", !lastMissingNames.length);
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

  function allVisibleCards() {
    const cards = [];
    Object.values(state?.players || {}).forEach(player => {
      ["hand", "library", "battlefield", "stack", "graveyard", "exile", "revealed", "sideboard"].forEach(zone => {
        (player[zone] || []).forEach(card => cards.push({ ...card, zone, ownerId: player.id }));
      });
    });
    return cards;
  }

  function getCardById(cardId) {
    return allVisibleCards().find(card => card.id === cardId) || activeCard;
  }

  function createGame() {
    const name = el("playerNameInput").value.trim() || savedName || "Jogador";
    localStorage.setItem("resenhaon-simulator-name", name);
    socket.emit("simulator-join", { roomId, playerId, name });
    sendAction({ type: "loadDeck", deck: loadedDeck || mockDeck() });
    el("gameModal").classList.remove("active");
    el("gameModal").classList.add("hidden");
  }

  function cardDetailsHtml(card, includeImage = true) {
    if (!card) return `<div class="empty-zone">Nenhuma carta selecionada.</div>`;
    return `
      ${includeImage && card.imageUrl ? `<img src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(card.name)}">` : ""}
      <h3>${escapeHtml(card.name)}</h3>
      <p><strong>${escapeHtml(card.cost || "")}</strong></p>
      <p>${escapeHtml(card.type || "")}</p>
      <p>${escapeHtml(card.oracleText || "")}</p>
      <p>Zona: ${escapeHtml(card.zone || "")}</p>
    `;
  }

  function markerBadges(card) {
    const counters = card.counters || {};
    const colored = counters.colored || {};
    const power = counters.power || {};
    const badges = [];
    if (Number(counters.p1p1 || 0)) badges.push(`<span class="counter-tag">+1/+1 ${Number(counters.p1p1)}</span>`);
    if (Number(counters.generic || 0)) badges.push(`<span class="counter-tag">M ${Number(counters.generic)}</span>`);
    Object.entries(colored).forEach(([color, count]) => {
      if (Number(count || 0)) badges.push(`<span class="counter-tag ${escapeHtml(color)}">${escapeHtml(color)} ${Number(count)}</span>`);
    });
    if (Number(power.plus || 0)) badges.push(`<span class="counter-tag">+X/+X ${Number(power.plus)}</span>`);
    if (Number(power.minus || 0)) badges.push(`<span class="counter-tag">-X/-X ${Number(power.minus)}</span>`);
    (counters.abilities || []).forEach(ability => badges.push(`<span class="counter-tag ability-tag">${escapeHtml(ability)}</span>`));
    return badges.join("");
  }

  function cardHtml(card, zone, owner) {
    const image = card.imageUrl ? `style="background-image:url('${escapeHtml(card.imageUrl)}')"` : "";
    return `
      <article class="sim-card ${card.imageUrl ? "" : "no-image"} ${card.tapped ? "tapped" : ""} ${card.attacking ? "attacking" : ""} ${card.blocking ? "blocking" : ""}"
        ${image} data-card-id="${escapeHtml(card.id)}" data-zone="${zone}" data-owner="${owner}">
        <div class="card-text">
          ${card.token ? `<span class="token-tag">TOKEN</span>` : ""}
          ${markerBadges(card)}
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

  function setCardSize(value) {
    const safeValue = Math.max(60, Math.min(160, Number(value) || 100));
    document.documentElement.style.setProperty("--sim-card-scale", String(safeValue / 100));
    localStorage.setItem("resenhaon-sim-card-size", String(safeValue));
    if (el("cardSizeSlider")) el("cardSizeSlider").value = String(safeValue);
  }

  function previewSettings() {
    return {
      enabled: localStorage.getItem("resenhaon-sim-preview-enabled") !== "false",
      mode: localStorage.getItem("resenhaon-sim-preview-mode") || "both",
      size: localStorage.getItem("resenhaon-sim-preview-size") || "medium"
    };
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
      el("opponentHandLabel").textContent = `${player.handCount || 0} cartas na mao`;
      renderHandBack(el("opponentHand"), player.handCount || 0);
      renderCards(el("opponentBattlefield"), player.battlefield || [], "battlefield", "opponent");
      renderCards(el("opponentStack"), player.stack || [], "stack", "opponent");
      renderSmall(el("opponentGraveyard"), player.graveyard || [], "graveyard", "opponent");
      renderSmall(el("opponentExile"), player.exile || [], "exile", "opponent");
      renderSmall(el("opponentRevealed"), player.revealed || [], "revealed", "opponent");
    }
  }

  function renderSelectedCard(card) {
    const panel = el("selectedCardPanel");
    if (!card) {
      panel.classList.add("collapsed");
      el("selectedCardContent").innerHTML = "";
      return;
    }
    panel.classList.remove("collapsed");
    el("selectedCardContent").innerHTML = cardDetailsHtml(card, true);
    document.querySelectorAll(".sim-card,.mini-card").forEach(cardEl => {
      cardEl.classList.toggle("selected", cardEl.dataset.cardId === card.id);
    });
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
    el("playerCount").textContent = String(players.length);
    el("currentPhaseLabel").textContent = phases[currentPhase] || currentPhase;
    document.querySelectorAll(".phase-strip button").forEach(button => button.classList.toggle("active", button.dataset.phase === currentPhase));
    renderPlayer(self, "self");
    renderPlayer(opponent, "opponent");
    renderLog();
    if (activeCard?.id) {
      activeCard = getCardById(activeCard.id) || activeCard;
      renderSelectedCard(activeCard);
    }
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
      buttons.push(["Topo do grimorio", { type: "moveCard", cardId, toZone: "library", position: "top" }]);
      buttons.push(["Fundo do grimorio", { type: "moveCard", cardId, toZone: "library", position: "bottom" }]);
      buttons.push(["Adicionar +1/+1", { type: "counter", cardId, counterType: "p1p1", value: 1 }]);
      buttons.push(["Remover +1/+1", { type: "counter", cardId, counterType: "p1p1", value: -1 }]);
      buttons.push(["+X/+X", { type: "marker", cardId, markerKind: "power", powerKind: "plus", value: 1 }]);
      buttons.push(["-X/-X", { type: "marker", cardId, markerKind: "power", powerKind: "minus", value: 1 }]);
      COLORED_MARKERS.forEach(([color, label]) => {
        buttons.push([`+ marcador ${label}`, { type: "marker", cardId, markerKind: "colored", color, value: 1 }]);
        buttons.push([`- marcador ${label}`, { type: "marker", cardId, markerKind: "colored", color, value: -1 }]);
      });
      ABILITY_MARKERS.forEach(ability => buttons.push([`Alternar ${ability}`, { type: "marker", cardId, markerKind: "ability", ability }]));
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

  function privateActionButtons(card, sourceZone) {
    const moves = [
      ["Mao", "hand", "top"],
      ["Cemiterio", "graveyard", "top"],
      ["Exilio", "exile", "top"],
      ["Campo", "battlefield", "top"],
      ["Topo", "library", "top"],
      ["Fundo", "library", "bottom"]
    ];
    return `<div class="private-card-actions">
      ${moves.map(([label, zone, position]) => `<button data-private-card="${escapeHtml(card.id)}" data-private-zone="${zone}" data-private-position="${position}">${label}</button>`).join("")}
      ${["graveyard", "exile"].includes(sourceZone) ? `<button data-private-card="${escapeHtml(card.id)}" data-private-shuffle="1">Embaralhar no grimorio</button>` : ""}
    </div>`;
  }

  function privateCardHtml(card, sourceZone) {
    return `<div class="private-card-wrap">${cardHtml(card, sourceZone, "self")}${privateActionButtons(card, sourceZone)}</div>`;
  }

  function openPrivateModal(title, cards, sourceZone = "library") {
    privateCards = cards || [];
    el("privateModalTitle").textContent = title;
    el("privateModalContent").innerHTML = privateCards.length
      ? privateCards.map(card => privateCardHtml(card, sourceZone)).join("")
      : `<div class="empty-zone">Nada para mostrar.</div>`;
    el("privateModal").classList.remove("hidden");
  }

  function showHoverPreview(card, x, y) {
    if (!card) return;
    const settings = previewSettings();
    if (!settings.enabled) return;
    const preview = el("hoverPreview");
    preview.className = `hover-preview preview-${settings.size}`;
    const includeImage = settings.mode !== "text";
    const includeText = settings.mode !== "image";
    preview.innerHTML = includeText ? cardDetailsHtml(card, includeImage) : (card.imageUrl ? `<img src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(card.name)}">` : cardDetailsHtml(card, false));
    preview.style.left = `${Math.min(window.innerWidth - 330, x + 18)}px`;
    preview.style.top = `${Math.min(window.innerHeight - 470, y + 18)}px`;
    preview.classList.remove("hidden");
  }

  function hideHoverPreview() {
    el("hoverPreview").classList.add("hidden");
  }

  function openZoom(card) {
    if (!card) return;
    el("zoomCardContent").innerHTML = card.imageUrl
      ? `<img src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(card.name)}">${cardDetailsHtml(card, false)}`
      : cardDetailsHtml(card, false);
    el("zoomModal").classList.remove("hidden");
  }

  function bindEvents() {
    el("playerNameInput").value = savedName;
    el("openGameModalBtn").addEventListener("click", () => el("gameModal").classList.remove("hidden"));
    el("cancelGameBtn").addEventListener("click", () => el("gameModal").classList.add("hidden"));
    el("createGameBtn").addEventListener("click", createGame);
    el("concedeBtn").addEventListener("click", () => {
      if (confirm("Tem certeza que deseja conceder a partida?")) sendAction({ type: "concede" });
    });
    el("newGameBtn").addEventListener("click", () => {
      if (confirm("Iniciar nova partida e limpar zonas atuais?")) sendAction({ type: "newGame" });
    });
    el("layoutSizeSelect").addEventListener("change", event => {
      document.querySelector(".sim-table-app").classList.remove("layout-compact", "layout-medium", "layout-spacious");
      document.querySelector(".sim-table-app").classList.add(`layout-${event.target.value}`);
    });
    setCardSize(localStorage.getItem("resenhaon-sim-card-size") || 100);
    const settings = previewSettings();
    el("previewEnabledInput").checked = settings.enabled;
    el("previewModeSelect").value = settings.mode;
    el("previewSizeSelect").value = settings.size;
    el("loadDeckBtn").addEventListener("click", () => el("deckFileInput").click());
    el("confirmDeckBtn").addEventListener("click", () => {
      el("deckStatus").textContent = loadedDeck
        ? `${el("deckStatus").textContent} Deck confirmado.`
        : "Nenhum deck carregado. Ao criar jogo, sera usado deck de teste.";
    });
    el("deckFileInput").addEventListener("change", async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const extensionOk = /\.(txt|cod|dec)$/i.test(file.name);
        if (!extensionOk) throw new Error("Formato invalido. Use .txt, .cod ou .dec.");
        lastParsedDeck = parseDecklist(await readDeckFile(file));
        await hydrateDeck(lastParsedDeck);
      } catch (error) {
        el("deckStatus").textContent = error.message || "Erro ao carregar deck.";
      }
    });
    el("retryMissingBtn").addEventListener("click", async () => {
      if (lastParsedDeck) await hydrateDeck(lastParsedDeck);
    });
    el("cardSizeSlider").addEventListener("input", event => setCardSize(event.target.value));
    el("previewEnabledInput").addEventListener("change", event => localStorage.setItem("resenhaon-sim-preview-enabled", event.target.checked ? "true" : "false"));
    el("previewModeSelect").addEventListener("change", event => localStorage.setItem("resenhaon-sim-preview-mode", event.target.value));
    el("previewSizeSelect").addEventListener("change", event => localStorage.setItem("resenhaon-sim-preview-size", event.target.value));

    document.querySelectorAll("[data-life]").forEach(button => {
      button.addEventListener("click", () => sendAction({ type: "life", value: Number(button.dataset.life || 0) }));
    });
    document.querySelectorAll(".phase-strip button").forEach(button => {
      button.addEventListener("click", () => sendAction({ type: "phase", value: button.dataset.phase }));
    });
    el("openTokenModalBtn").addEventListener("click", () => el("tokenModal").classList.remove("hidden"));
    el("closeTokenModal").addEventListener("click", () => el("tokenModal").classList.add("hidden"));
    el("rollDiceBtn").addEventListener("click", () => rollDice());
    el("toggleToolsBtn").addEventListener("click", () => el("toolsPanel").classList.toggle("collapsed"));
    el("closePrivateModal").addEventListener("click", () => el("privateModal").classList.add("hidden"));
    el("closeZoomModal").addEventListener("click", () => el("zoomModal").classList.add("hidden"));
    el("timerStartBtn").addEventListener("click", startTimer);
    el("timerPauseBtn").addEventListener("click", pauseTimer);
    el("timerResetBtn").addEventListener("click", resetTimer);
    el("zoomModal").addEventListener("click", event => {
      if (event.target.id === "zoomModal") el("zoomModal").classList.add("hidden");
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        el("zoomModal").classList.add("hidden");
        el("privateModal").classList.add("hidden");
        closeCardMenu();
      }
    });

    document.querySelectorAll("[data-command]").forEach(button => {
      button.addEventListener("click", () => {
        const command = button.dataset.command;
        const self = selfPlayer();
        if (command === "drawX") sendAction({ type: "draw", value: Number(prompt("Comprar quantas cartas?", "3") || 0) });
        else if (command === "mill") sendAction({ type: "mill", value: Number(prompt("Colocar quantas cartas no cemiterio?", "3") || 0) });
        else if (command === "openingHand") {
          if (!self?.handCount || confirm("Sua mao nao esta vazia. Embaralhar a mao de volta e comprar 7?")) sendAction({ type: "openingHand" });
        } else if (command === "mulligan") {
          if (confirm("Fazer mulligan? A mao atual volta ao grimorio e voce compra 7.")) sendAction({ type: "mulligan" });
        } else if (command === "viewDeck") {
          openPrivateModal("Seu grimorio", self?.library || [], "library");
          sendAction({ type: "viewDeck" });
        } else if (command === "peekTop") {
          openPrivateModal("Carta do topo", (self?.library || []).slice(0, 1), "library");
          sendAction({ type: "peekTop" });
        } else if (command === "viewTopX") {
          openPrivateModal("Cartas do topo", (self?.library || []).slice(0, Number(prompt("Ver quantas cartas?", "3") || 0)), "library");
          sendAction({ type: "viewTopX" });
        }
        else sendAction({ type: command });
      });
    });

    document.querySelectorAll("[data-view-zone]").forEach(button => {
      button.addEventListener("click", () => {
        const self = selfPlayer();
        const opponent = opponentPlayer();
        const map = {
          graveyard: [self?.graveyard || [], "Cemiterio", "graveyard"],
          exile: [self?.exile || [], "Exilio", "exile"],
          "opponent-graveyard": [opponent?.graveyard || [], "Cemiterio do oponente", "opponent"],
          "opponent-exile": [opponent?.exile || [], "Exilio do oponente", "opponent"]
        };
        const [cards, title, sourceZone] = map[button.dataset.viewZone] || [[], "Zona", "library"];
        openPrivateModal(title, cards, sourceZone);
      });
    });

    el("libraryButton").addEventListener("click", () => {
      openPrivateModal("Seu grimorio", selfPlayer()?.library || [], "library");
      sendAction({ type: "viewDeck" });
    });

    el("privateModalContent").addEventListener("click", event => {
      const actionButton = event.target.closest("button[data-private-card]");
      if (!actionButton) return;
      const cardId = actionButton.dataset.privateCard;
      if (actionButton.dataset.privateShuffle) {
        sendAction({ type: "shuffleIntoLibrary", cardId });
      } else {
        sendAction({
          type: "privateMoveCard",
          cardId,
          toZone: actionButton.dataset.privateZone,
          position: actionButton.dataset.privatePosition || "top"
        });
      }
      el("privateModal").classList.add("hidden");
    });

    document.body.addEventListener("click", event => {
      const card = event.target.closest(".sim-card,.mini-card");
      if (card && !event.target.closest("#privateModalContent")) {
        activeCard = getCardById(card.dataset.cardId);
        renderSelectedCard(activeCard);
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
    document.body.addEventListener("mouseover", event => {
      const cardEl = event.target.closest(".sim-card,.mini-card");
      if (!cardEl) return;
      showHoverPreview(getCardById(cardEl.dataset.cardId), event.clientX, event.clientY);
    });
    document.body.addEventListener("mousemove", event => {
      if (!el("hoverPreview").classList.contains("hidden")) {
        el("hoverPreview").style.left = `${Math.min(window.innerWidth - 330, event.clientX + 18)}px`;
        el("hoverPreview").style.top = `${Math.min(window.innerHeight - 470, event.clientY + 18)}px`;
      }
    });
    document.body.addEventListener("mouseout", event => {
      if (event.target.closest(".sim-card,.mini-card")) hideHoverPreview();
    });
    document.body.addEventListener("dblclick", event => {
      const cardEl = event.target.closest(".sim-card,.mini-card");
      if (cardEl) openZoom(getCardById(cardEl.dataset.cardId));
    });
    document.body.addEventListener("touchstart", event => {
      const cardEl = event.target.closest(".sim-card,.mini-card");
      if (!cardEl) return;
      touchTimer = setTimeout(() => openZoom(getCardById(cardEl.dataset.cardId)), 550);
    }, { passive: true });
    document.body.addEventListener("touchend", () => clearTimeout(touchTimer), { passive: true });
  }

  function renderTokenBank() {
    el("tokenBank").innerHTML = TOKEN_OPTIONS.map(([key, label, type]) => `
      <button data-token-key="${escapeHtml(key)}" type="button">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(type)}</span>
      </button>
    `).join("");
    el("tokenBank").querySelectorAll("[data-token-key]").forEach(button => {
      button.addEventListener("click", async () => {
        const key = button.dataset.tokenKey;
        const option = TOKEN_OPTIONS.find(item => item[0] === key);
        const card = option ? await fetchCard(`${option[1]} Token`, Date.now(), true) : null;
        sendAction({ type: "token", value: key, card: card?.type !== "Carta nao encontrada" ? { ...card, token: true } : null });
        el("tokenModal").classList.add("hidden");
      });
    });
  }

  function updateTimerDisplay() {
    const minutes = Math.floor(timerRemaining / 60).toString().padStart(2, "0");
    const seconds = Math.floor(timerRemaining % 60).toString().padStart(2, "0");
    el("simTimerDisplay").textContent = `${minutes}:${seconds}`;
    localStorage.setItem("resenhaon-sim-timer-remaining", String(timerRemaining));
  }

  function startTimer() {
    if (timerInterval) return;
    timerInterval = setInterval(() => {
      timerRemaining = Math.max(0, timerRemaining - 1);
      updateTimerDisplay();
      if (timerRemaining <= 0) pauseTimer();
    }, 1000);
  }

  function pauseTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function resetTimer() {
    pauseTimer();
    timerRemaining = 3000;
    updateTimerDisplay();
  }

  function rollDice() {
    const type = el("diceSelect").value;
    const result = type === "coin"
      ? (Math.random() > 0.5 ? "Cara" : "Coroa")
      : String(Math.floor(Math.random() * Number(type.slice(1))) + 1);
    el("diceResult").textContent = `Resultado: ${type} = ${result}`;
    sendAction({ type: "dice", label: type, result });
  }

  socket.on("connect", () => {});
  socket.on("simulator-state", payload => {
    state = payload;
    render();
  });

  renderTokenBank();
  updateTimerDisplay();
  bindEvents();
})();
