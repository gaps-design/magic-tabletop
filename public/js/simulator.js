(function () {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room") || localStorage.getItem("resenhaon-last-simulator-room") || "mtg-1002";
  let activeRoomId = roomId;
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
  const simulatorAudioServers = {
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" },
      { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
      { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
    ]
  };

  let playerId = savedPlayerId;
  let state = null;
  let loadedDeck = null;
  const localDecks = { p1: null, p2: null };
  const localParsedDecks = { p1: null, p2: null };
  const localPlayerIds = {
    p1: `${savedPlayerId}-p1`,
    p2: `${savedPlayerId}-p2`
  };
  let localTwoPlayerMode = false;
  let lastParsedDeck = null;
  let lastMissingNames = [];
  let lastMissingMain = [];
  let lastMissingSide = [];
  let activeCard = null;
  let privateCards = [];
  let touchTimer = null;
  let timerRemaining = Number(localStorage.getItem("resenhaon-sim-timer-remaining") || 3000);
  let timerInterval = null;
  let battlefieldDrag = null;
  let selectionDrag = null;
  let previewDrag = null;
  let arrowDraft = null;
  let arrowCounter = 0;
  let handResize = null;
  let stackResize = null;
  let privateModalState = null;
  let lastRightClick = { cardId: "", time: 0 };
  let simulatorAudioStream = null;
  let simulatorAudioMuted = false;
  let simulatorAudioStarted = false;
  const simulatorAudioPeers = new Map();
  const selectedCardIds = new Set();
  const selectedSideboardIds = new Set();
  const pendingManaCards = new Set();

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
    end: "End",
    cleanup: "Cleanup"
  };
  const phaseMeta = {
    untap: ["🔄", "Untap"],
    upkeep: ["⏳", "Upkeep"],
    draw: ["🃏", "Draw"],
    main1: ["1️⃣", "Main 1"],
    beginCombat: ["⚔️", "Combat"],
    attackers: ["🗡️", "Attack"],
    blockers: ["🛡️", "Block"],
    damage: ["💥", "Damage"],
    endCombat: ["🏁", "End C."],
    main2: ["2️⃣", "Main 2"],
    end: ["🌙", "End"],
    cleanup: ["🧹", "Cleanup"]
  };
  const manaColors = [
    ["white", "⚪", "Branco"],
    ["blue", "🔵", "Azul"],
    ["black", "⚫", "Preto"],
    ["red", "🔴", "Vermelho"],
    ["green", "🟢", "Verde"],
    ["colorless", "◇", "Incolor"]
  ];

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

  async function searchScryfallCard(name, query = `!"${name}"`) {
    const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards`);
    if (!response.ok) throw new Error("not found");
    const payload = await response.json();
    const card = payload.data?.[0];
    if (!card) throw new Error("not found");
    return card;
  }

  async function findScryfallCard(cleanName) {
    const lookup = cleanName.replace(/\s+\/\/\s+.+$/, "");
    const noDash = lookup.replace(/[-â€“â€”]/g, " ");
    const noAccent = normalizeLookupName(lookup);
    const attempts = [
      () => requestScryfall(lookup, "exact"),
      () => requestScryfall(lookup, "fuzzy"),
      () => searchScryfallCard(noDash, `!"${noDash}"`),
      () => searchScryfallCard(noDash, `name:${noDash}`),
      () => requestScryfall(noAccent, "fuzzy"),
      () => searchScryfallCard(noAccent, `name:${noAccent} lang:any`)
    ];
    let lastError;
    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("not found");
  }

  async function fetchCard(name, index, retry = false) {
    const cleanName = normalizeLookupName(name);
    const key = cleanName.toLowerCase();
    if (scryfallCache.has(key)) return { ...scryfallCache.get(key), id: `${key}-${index}-${Math.random().toString(36).slice(2)}` };

    try {
      const card = await findScryfallCard(cleanName);
      const normalized = {
        name: card.name || cleanName,
        type: card.type_line || "Card",
        cost: card.mana_cost || "",
        imageUrl: card.image_uris?.large || card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.large || card.card_faces?.[0]?.image_uris?.normal || "",
        oracleText: card.oracle_text || card.card_faces?.[0]?.oracle_text || "",
        power: card.power || card.card_faces?.[0]?.power || "",
        toughness: card.toughness || card.card_faces?.[0]?.toughness || "",
        colors: card.colors || [],
        scryfallId: card.id || ""
      };
      scryfallCache.set(key, normalized);
      saveCache();
      return { ...normalized, id: `${card.id || key}-${index}-${Math.random().toString(36).slice(2)}` };
    } catch (error) {
      const fallback = { name: cleanName || name, type: "Placeholder", cost: "", imageUrl: "", oracleText: retry ? "Busca manual ainda disponivel." : "Carta nao encontrada. Use a busca manual ou ajuste o nome.", power: "", toughness: "", colors: [], scryfallId: "", missing: true };
      return { ...fallback, id: `${key}-${index}-${Math.random().toString(36).slice(2)}` };
    }
  }

  function missingReportHtml(main = [], side = []) {
    if (!main.length && !side.length) return "";
    const list = names => names.slice(0, 40).map(name => `<li>${escapeHtml(name)}</li>`).join("");
    return `<div class="missing-report">
      <strong>Cartas nao encontradas</strong>
      ${main.length ? `<p>Main Deck</p><ul>${list(main)}</ul>` : ""}
      ${side.length ? `<p>Sideboard</p><ul>${list(side)}</ul>` : ""}
    </div>`;
  }
  async function hydrateDeck(parsed, options = {}) {
    const statusEl = el(options.statusId || "deckStatus");
    const total = parsed.main.length + parsed.side.length;
    let loaded = 0;
    const setStatus = () => {
      statusEl.textContent = `Carregando cartas... ${loaded}/${total}`;
    };
    setStatus();
    const mainDeck = [];
    const sideboard = [];
    lastMissingNames = [];
    lastMissingMain = [];
    lastMissingSide = [];
    for (const name of parsed.main) {
      mainDeck.push(await fetchCard(name, loaded));
      if (mainDeck[mainDeck.length - 1].missing) {
        lastMissingNames.push(name);
        lastMissingMain.push(name);
      }
      loaded++;
      setStatus();
    }
    for (const name of parsed.side) {
      sideboard.push(await fetchCard(name, loaded));
      if (sideboard[sideboard.length - 1].missing) {
        lastMissingNames.push(name);
        lastMissingSide.push(name);
      }
      loaded++;
      setStatus();
    }
    const unique = new Set([...parsed.main, ...parsed.side].map(name => name.toLowerCase())).size;
    const hydratedDeck = { mainDeck, sideboard };
    if (options.assignGlobal !== false) loadedDeck = hydratedDeck;
    const warning = parsed.main.length !== 60 || parsed.side.length > 15
      ? " Aviso: lista fora do padrao 60/15, carregada em modo teste."
      : "";
    statusEl.innerHTML = `Main deck: ${parsed.main.length} cartas | Sideboard: ${parsed.side.length} cartas | Cartas unicas: ${unique} | Encontradas: ${total - lastMissingNames.length} | Nao encontradas: ${lastMissingNames.length}.${warning}${missingReportHtml(lastMissingMain, lastMissingSide)}`;
    if (options.retryButtonId) el(options.retryButtonId)?.classList.toggle("hidden", !lastMissingNames.length);
    else el("retryMissingBtn").classList.toggle("hidden", !lastMissingNames.length);
    return hydratedDeck;
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
    sendActionFor(playerId, action);
  }

  function sendActionFor(targetPlayerId, action) {
    socket.emit("simulator-action", { roomId: activeRoomId, playerId: targetPlayerId, action });
  }

  function deckIsValidForLocal(deck) {
    return deck && deck.mainDeck?.length === 60 && (deck.sideboard?.length || 0) <= 15;
  }

  function setLocalView(targetPlayerId) {
    playerId = targetPlayerId;
    activeCard = null;
    selectedCardIds.clear();
    selectedSideboardIds.clear();
    el("switchLocalPlayerBtn").classList.toggle("hidden", !localTwoPlayerMode);
    if (localTwoPlayerMode) {
      const label = playerId === localPlayerIds.p1 ? "Ver Jogador 2" : "Ver Jogador 1";
      el("switchLocalPlayerBtn").textContent = `Alternar visão jogador (${label})`;
    }
    render();
  }

  function syncLocalViewWithActivePlayer() {
    if (!localTwoPlayerMode) return;
    const activeId = state?.activePlayerId;
    if (!activeId || activeId === playerId) return;
    if (activeId === localPlayerIds.p1 || activeId === localPlayerIds.p2) {
      setLocalView(activeId);
    }
  }

  function keyboardShortcutsBlocked(event) {
    const target = event.target;
    const tag = String(target?.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag) || target?.isContentEditable) return true;
    if (document.querySelector(".modal-backdrop:not(.hidden):not(#gameModal)")) return true;
    if (!el("gameModal").classList.contains("hidden") && el("gameModal").classList.contains("active")) return true;
    return false;
  }

  function setSimulatorAudioStatus(message, kind = "") {
    const status = el("simAudioStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `sim-audio-status ${kind}`.trim();
  }

  function updateSimulatorAudioButtons() {
    const toggle = el("simAudioToggleBtn");
    if (!toggle) return;
    toggle.textContent = simulatorAudioMuted ? "🎙️ Desmutar" : "🎙️ Mutar";
    toggle.classList.toggle("muted", simulatorAudioMuted);
  }

  function ensureRemoteAudioElement(peerId) {
    let audio = document.getElementById(`sim-audio-${peerId}`);
    if (!audio) {
      audio = document.createElement("audio");
      audio.id = `sim-audio-${peerId}`;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.dataset.simulatorAudioPeer = peerId;
      document.body.appendChild(audio);
    }
    return audio;
  }

  async function ensureSimulatorAudioStream() {
    if (simulatorAudioStream?.getAudioTracks().some(track => track.readyState === "live")) return simulatorAudioStream;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Seu navegador nao suporta audio WebRTC.");
    simulatorAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    simulatorAudioStream.getAudioTracks().forEach(track => {
      track.enabled = !simulatorAudioMuted;
      track.onended = () => {
        setSimulatorAudioStatus("Microfone caiu. Reconecte o audio.", "error");
        el("simAudioReconnectBtn")?.classList.remove("hidden");
      };
    });
    return simulatorAudioStream;
  }

  function closeSimulatorAudioPeer(peerId) {
    const peer = simulatorAudioPeers.get(peerId);
    if (peer) {
      try { peer.close(); } catch (_) {}
      simulatorAudioPeers.delete(peerId);
    }
    document.getElementById(`sim-audio-${peerId}`)?.remove();
  }

  function createSimulatorAudioPeer(peerId) {
    if (simulatorAudioPeers.has(peerId)) return simulatorAudioPeers.get(peerId);
    const peer = new RTCPeerConnection(simulatorAudioServers);
    simulatorAudioPeers.set(peerId, peer);
    if (simulatorAudioStream) {
      simulatorAudioStream.getAudioTracks().forEach(track => peer.addTrack(track, simulatorAudioStream));
    }
    peer.onicecandidate = event => {
      if (event.candidate) {
        socket.emit("simulator-audio-signal", {
          roomId: activeRoomId,
          to: peerId,
          playerId,
          type: "ice",
          payload: event.candidate
        });
      }
    };
    peer.ontrack = event => {
      const [stream] = event.streams;
      if (!stream) return;
      const audio = ensureRemoteAudioElement(peerId);
      if (audio.srcObject !== stream) audio.srcObject = stream;
      audio.play?.().catch(() => {});
      setSimulatorAudioStatus(simulatorAudioMuted ? "Microfone mutado | Oponente conectado" : "Microfone ativo | Oponente conectado", simulatorAudioMuted ? "muted" : "active");
    };
    peer.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(peer.connectionState)) {
        setSimulatorAudioStatus("Oponente sem audio/conectando", "error");
        el("simAudioReconnectBtn")?.classList.remove("hidden");
      } else if (peer.connectionState === "connected") {
        setSimulatorAudioStatus(simulatorAudioMuted ? "Microfone mutado | Oponente conectado" : "Microfone ativo | Oponente conectado", simulatorAudioMuted ? "muted" : "active");
      }
    };
    return peer;
  }

  async function startSimulatorAudio(force = false) {
    if (localTwoPlayerMode) {
      setSimulatorAudioStatus("Audio online indisponivel no teste local 2P", "");
      return;
    }
    if (simulatorAudioStarted && !force) return;
    try {
      await ensureSimulatorAudioStream();
      simulatorAudioStarted = true;
      el("simAudioReconnectBtn")?.classList.add("hidden");
      socket.emit("simulator-audio-join", { roomId: activeRoomId, playerId });
      setSimulatorAudioStatus(simulatorAudioMuted ? "Microfone mutado | Aguardando oponente" : "Microfone ativo | Aguardando oponente", simulatorAudioMuted ? "muted" : "active");
      updateSimulatorAudioButtons();
    } catch (error) {
      simulatorAudioStarted = false;
      setSimulatorAudioStatus(error?.name === "NotAllowedError" ? "Permissao de microfone negada" : "Nao foi possivel ativar o audio", "error");
      el("simAudioReconnectBtn")?.classList.remove("hidden");
    }
  }

  async function reconnectSimulatorAudio() {
    simulatorAudioPeers.forEach((_, peerId) => closeSimulatorAudioPeer(peerId));
    simulatorAudioStarted = false;
    if (simulatorAudioStream) {
      simulatorAudioStream.getTracks().forEach(track => track.stop());
      simulatorAudioStream = null;
    }
    await startSimulatorAudio(true);
  }

  function toggleSimulatorAudioMute() {
    simulatorAudioMuted = !simulatorAudioMuted;
    simulatorAudioStream?.getAudioTracks().forEach(track => {
      track.enabled = !simulatorAudioMuted;
    });
    setSimulatorAudioStatus(simulatorAudioMuted ? "Microfone mutado" : "Microfone ativo", simulatorAudioMuted ? "muted" : "active");
    updateSimulatorAudioButtons();
  }

  async function callSimulatorAudioPeer(peerId) {
    const peer = createSimulatorAudioPeer(peerId);
    const offer = await peer.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await peer.setLocalDescription(offer);
    socket.emit("simulator-audio-signal", { roomId: activeRoomId, to: peerId, playerId, type: "offer", payload: offer });
  }

  function allVisibleCards() {
    const cards = [];
    Object.values(state?.players || {}).forEach(player => {
      ["hand", "library", "mainDeck", "battlefield", "stack", "graveyard", "exile", "revealed", "sideboard"].forEach(zone => {
        (player[zone] || []).forEach(card => cards.push({ ...card, zone, ownerId: player.id }));
      });
    });
    return cards;
  }

  function getCardById(cardId) {
    return allVisibleCards().find(card => card.id === cardId) || activeCard;
  }

  function createGame() {
    const mode = document.querySelector("input[name='localTestMode']:checked")?.value || "single";
    if (mode === "two") {
      if (!deckIsValidForLocal(localDecks.p1) || !deckIsValidForLocal(localDecks.p2)) {
        alert("Carregue dois decks validos: main deck com 60 cartas e sideboard ate 15.");
        return;
      }
      const p1Name = el("playerOneNameInput").value.trim() || "Jogador 1";
      const p2Name = el("playerTwoNameInput").value.trim() || "Jogador 2";
      activeRoomId = `${roomId}-local-${Date.now()}`;
      localTwoPlayerMode = true;
      socket.emit("simulator-join", { roomId: activeRoomId, playerId: localPlayerIds.p1, name: p1Name });
      socket.emit("simulator-join", { roomId: activeRoomId, playerId: localPlayerIds.p2, name: p2Name });
      sendActionFor(localPlayerIds.p1, { type: "loadDeck", deck: localDecks.p1 });
      sendActionFor(localPlayerIds.p2, { type: "loadDeck", deck: localDecks.p2 });
      sendActionFor(localPlayerIds.p1, { type: "phase", value: "untap" });
      setLocalView(localPlayerIds.p1);
      el("gameModal").classList.remove("active");
      el("gameModal").classList.add("hidden");
      return;
    }
    activeRoomId = roomId;
    localTwoPlayerMode = false;
    playerId = savedPlayerId;
    const name = el("playerNameInput").value.trim() || savedName || "Jogador";
    localStorage.setItem("resenhaon-simulator-name", name);
    socket.emit("simulator-join", { roomId: activeRoomId, playerId, name });
    sendAction({ type: "loadDeck", deck: loadedDeck || mockDeck() });
    startSimulatorAudio();
    el("switchLocalPlayerBtn").classList.add("hidden");
    el("gameModal").classList.remove("active");
    el("gameModal").classList.add("hidden");
  }

  async function loadLocalDeck(slot) {
    const inputId = slot === "p1" ? "deckFileInputP1" : "deckFileInputP2";
    const statusId = slot === "p1" ? "deckStatusP1" : "deckStatusP2";
    const file = el(inputId).files?.[0];
    if (!file) {
      el(statusId).textContent = `Selecione o arquivo do deck ${slot === "p1" ? "1" : "2"}.`;
      return;
    }
    try {
      const extensionOk = /\.(txt|cod|dec)$/i.test(file.name);
      if (!extensionOk) throw new Error("Formato invalido. Use .txt, .cod ou .dec.");
      const parsed = parseDecklist(await readDeckFile(file));
      localParsedDecks[slot] = parsed;
      localDecks[slot] = await hydrateDeck(parsed, { statusId, assignGlobal: false });
      if (!deckIsValidForLocal(localDecks[slot])) {
        el(statusId).innerHTML += `<p><strong>Ajuste necessario:</strong> main deck precisa ter 60 cartas e sideboard ate 15.</p>`;
      }
    } catch (error) {
      el(statusId).textContent = error.message || "Erro ao carregar deck.";
    }
  }

  function updateLocalModeUi() {
    const mode = document.querySelector("input[name='localTestMode']:checked")?.value || "single";
    el("singlePlayerSetup").classList.toggle("hidden", mode !== "single");
    el("singleDeckSetup").classList.toggle("hidden", mode !== "single");
    el("deckStatus").classList.toggle("hidden", mode !== "single");
    el("twoPlayerSetup").classList.toggle("hidden", mode !== "two");
  }

  function cardDetailsHtml(card, includeImage = true) {
    if (!card) return `<div class="empty-zone">Nenhuma carta selecionada.</div>`;
    return `
      ${includeImage && card.imageUrl ? `<img src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(card.name)}">` : ""}
      <h3>${escapeHtml(card.name)}</h3>
      <p><strong>${escapeHtml(card.cost || "")}</strong></p>
      <p>${escapeHtml(card.type || "")}</p>
      ${powerToughnessLabel(card) ? `<p><strong>${escapeHtml(powerToughnessLabel(card))}</strong></p>` : ""}
      <p>${escapeHtml(card.oracleText || "")}</p>
      <p>Zona: ${escapeHtml(card.zone || "")}</p>
    `;
  }

  function markerBadges(card) {
    const counters = card.counters || {};
    const colored = counters.colored || {};
    const badges = [];
    if (Number(counters.generic || 0)) badges.push(`<span class="counter-tag">M ${Number(counters.generic)}</span>`);
    Object.entries(colored).forEach(([color, count]) => {
      if (Number(count || 0)) badges.push(`<span class="color-dot ${escapeHtml(color)}">${Number(count)}</span>`);
    });
    (counters.abilities || []).forEach(ability => badges.push(`<span class="counter-tag ability-tag">${escapeHtml(ability)}</span>`));
    return badges.join("");
  }

  function isLandCard(card = {}) {
    return /\b(land|terreno)\b/i.test(`${card.type || ""} ${card.name || ""}`);
  }

  function powerToughnessLabel(card = {}) {
    if (card.power || card.toughness) return `${card.power || "0"}/${card.toughness || "0"}`;
    const match = String(card.type || "").match(/(?:^|\s)(\d+|\*)\/(\d+|\*)(?:\s|$)/);
    return match ? `${match[1]}/${match[2]}` : "";
  }

  function modifiedPowerToughnessLabel(card = {}) {
    const base = powerToughnessLabel(card);
    const match = base.match(/^(-?\d+)\/(-?\d+)$/);
    const p1p1 = Number(card.counters?.p1p1 || 0);
    const plus = Number(card.counters?.power?.plus || 0);
    const minus = Number(card.counters?.power?.minus || 0);
    const delta = p1p1 + plus - minus;
    if (!delta) return "";
    if (match) return `${Number(match[1]) + delta}/${Number(match[2]) + delta}`;
    const sign = delta > 0 ? "+" : "";
    return `${sign}${delta}/${sign}${delta}`;
  }

  function cardHtml(card, zone, owner, index = 0) {
    const image = card.imageUrl ? `style="background-image:url('${escapeHtml(card.imageUrl)}')"` : "";
    const pt = powerToughnessLabel(card);
    const modifiedPt = modifiedPowerToughnessLabel(card);
    const isSelected = selectedCardIds.has(card.id);
    const showCardOverlays = zone !== "hand";
    const land = zone === "battlefield" && isLandCard(card);
    const defaultX = land ? index * 104 : ((index % 9) * 104);
    const defaultY = land ? 96 : (Math.floor(index / 9) * 138);
    const position = zone === "battlefield"
      ? `style="${card.imageUrl ? `background-image:url('${escapeHtml(card.imageUrl)}');` : ""}left:${Number(card.position?.x ?? defaultX)}px;top:${Number(card.position?.y ?? defaultY)}px"`
      : image;
    return `
      <article class="sim-card ${card.imageUrl ? "" : "no-image"} ${land ? "land-card" : ""} ${card.missing ? "missing-card" : ""} ${isSelected ? "multi-selected" : ""} ${card.tapped ? "tapped" : ""} ${card.attacking ? "attacking" : ""} ${card.blocking ? "blocking" : ""}"
        ${position} data-card-id="${escapeHtml(card.id)}" data-zone="${zone}" data-owner="${owner}">
        ${showCardOverlays ? `<div class="card-text">
          ${card.token ? `<span class="token-tag">TOKEN</span>` : ""}
          <h3>${escapeHtml(card.name)}</h3>
          <p>${escapeHtml(card.type)} ${card.cost ? `| ${escapeHtml(card.cost)}` : ""}</p>
        </div>` : ""}
        ${showCardOverlays && markerBadges(card) ? `<div class="marker-strip">${markerBadges(card)}</div>` : ""}
        ${showCardOverlays ? (modifiedPt ? `<span class="pt-badge modified">${escapeHtml(modifiedPt)}<small> / ${escapeHtml(pt || "base")}</small></span>` : (pt ? `<span class="pt-badge">${escapeHtml(pt)}</span>` : "")) : ""}
      </article>`;
  }

  function miniCardHtml(card, zone, owner) {
    const image = card.imageUrl ? `style="background-image:url('${escapeHtml(card.imageUrl)}')"` : "";
    return `<article class="mini-card ${card.imageUrl ? "" : "no-image"}" ${image} data-card-id="${escapeHtml(card.id)}" data-zone="${zone}" data-owner="${owner}"><span>${escapeHtml(card.name)}</span></article>`;
  }

  function renderCards(container, cards, zone, owner) {
    container.classList.toggle("free-layout", zone === "battlefield");
    container.innerHTML = cards?.length
      ? cards.map((card, index) => cardHtml(card, zone, owner, index)).join("")
      : `<div class="empty-zone">Vazio</div>`;
  }

  function renderSmall(container, cards, zone, owner) {
    container.innerHTML = cards?.length
      ? cards.map(card => miniCardHtml(card, zone, owner)).join("")
      : "";
  }

  function renderManaPool(container, pool = {}, owner = "self") {
    container.innerHTML = manaColors.map(([color, symbol]) => {
      const count = Number(pool?.[color] || 0);
      return `<button type="button" class="mana-symbol ${count ? "has-mana" : ""}" data-mana-color="${color}" data-owner="${owner}" ${count ? "" : "disabled"}>${symbol}<b>${count}</b></button>`;
    }).join("");
  }

  function renderHandBack(container, count) {
    container.innerHTML = Array.from({ length: Math.min(12, count || 0) }, () => `<span class="hand-back"></span>`).join("");
  }

  function boundedBattlefieldPosition(field, cardEl, clientX, clientY, offsetX = 0, offsetY = 0) {
    const rect = field.getBoundingClientRect();
    const cardWidth = cardEl?.offsetWidth || 70;
    const cardHeight = cardEl?.offsetHeight || 98;
    const maxX = Math.max(0, field.clientWidth - cardWidth);
    const maxY = Math.max(0, field.clientHeight - cardHeight);
    return {
      x: Math.max(0, Math.min(maxX, clientX - rect.left + field.scrollLeft - offsetX)),
      y: Math.max(0, Math.min(maxY, clientY - rect.top + field.scrollTop - offsetY))
    };
  }

  function rectsIntersect(a, b) {
    return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
  }

  function setCardSize(value) {
    const safeValue = Math.max(60, Math.min(160, Number(value) || 100));
    document.documentElement.style.setProperty("--sim-card-scale", String(safeValue / 100));
    localStorage.setItem("resenhaon-sim-card-size", String(safeValue));
    if (el("cardSizeSlider")) el("cardSizeSlider").value = String(safeValue);
  }

  function setHandExpanded(expanded) {
    const dock = document.querySelector(".hand-dock");
    dock.classList.toggle("hand-expanded", expanded);
    localStorage.setItem("resenhaon-sim-hand-expanded", expanded ? "true" : "false");
    el("expandHandBtn").textContent = expanded ? "Recolher Mao" : "Expandir Mao";
    if (expanded) {
      document.documentElement.style.setProperty("--sim-hand-height", "320px");
    } else {
      const savedHandHeight = localStorage.getItem("resenhaon-sim-hand-height") || "150";
      document.documentElement.style.setProperty("--sim-hand-height", `${Math.max(126, Math.min(280, Number(savedHandHeight) || 150))}px`);
    }
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
        el("opponentSideboardNotice").classList.add("hidden");
        ["opponentBattlefield", "opponentStack", "opponentGraveyard", "opponentExile", "opponentRevealed"].forEach(id => { el(id).innerHTML = ""; });
      }
      return;
    }

    if (isSelf) {
      el("selfName").textContent = player.name;
      el("selfLife").textContent = String(player.life ?? 20);
      renderManaPool(el("selfManaPool"), player.manaPool || {}, "self");
      const selfLibraryCount = player.libraryCount || 0;
      el("libraryCount").textContent = String(selfLibraryCount);
      el("handCount").textContent = `${player.handCount || 0} cartas`;
      el("graveyardCount").textContent = String(player.graveyard?.length || 0);
      el("exileCount").textContent = String(player.exile?.length || 0);
      renderCards(el("battlefieldZone"), player.battlefield || [], "battlefield", "self");
      renderCards(el("selfStack"), player.stack || [], "stack", "self");
      renderCards(el("handZone"), player.hand || [], "hand", "self");
      renderSmall(el("graveyardZone"), player.graveyard || [], "graveyard", "self");
      renderSmall(el("exileZone"), player.exile || [], "exile", "self");
      renderSmall(el("selfRevealed"), player.revealed || [], "revealed", "self");
    } else {
      el("opponentName").textContent = player.name;
      el("opponentLife").textContent = String(player.life ?? 20);
      renderManaPool(el("opponentManaPool"), player.manaPool || {}, "opponent");
      const opponentLibraryCount = player.libraryCount || 0;
      el("opponentLibraryCount").textContent = String(opponentLibraryCount);
      el("opponentHandLabel").textContent = `${player.handCount || 0} cartas na mao`;
      el("opponentGraveyardCount").textContent = String(player.graveyard?.length || 0);
      el("opponentExileCount").textContent = String(player.exile?.length || 0);
      renderHandBack(el("opponentHand"), player.handCount || 0);
      renderCards(el("opponentBattlefield"), player.battlefield || [], "battlefield", "opponent");
      renderCards(el("opponentStack"), player.stack || [], "stack", "opponent");
      renderSmall(el("opponentGraveyard"), player.graveyard || [], "graveyard", "opponent");
      renderSmall(el("opponentExile"), player.exile || [], "exile", "opponent");
      renderSmall(el("opponentRevealed"), player.revealed || [], "revealed", "opponent");
      el("opponentSideboardNotice").classList.toggle("hidden", player.sideboarding !== true);
    }
  }

  function groupedSideboardCards(cards = []) {
    const groups = new Map();
    cards.forEach(card => {
      const key = `${card.name}__${card.scryfallId || card.imageUrl || card.type}`;
      if (!groups.has(key)) groups.set(key, { card, count: 0, ids: [] });
      const group = groups.get(key);
      group.count++;
      group.ids.push(card.id);
    });
    return Array.from(groups.values()).sort((a, b) => a.card.name.localeCompare(b.card.name));
  }

  function sideboardCardRow(group, fromZone) {
    const card = group.card;
    const targetLabel = fromZone === "mainDeck" ? "Mover para side" : "Mover para main";
    const selected = group.ids.some(id => selectedSideboardIds.has(id));
    const image = card.imageUrl
      ? `<img src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(card.name)}">`
      : `<div class="sideboard-thumb">Sem img</div>`;
    return `
      <article class="sideboard-card ${selected ? "selected" : ""}" data-card-id="${escapeHtml(group.ids[0])}" data-card-ids="${escapeHtml(group.ids.join(","))}" data-side-zone="${fromZone}" data-card-count="${group.count}">
        ${image}
        <div>
          <strong>${group.count}x ${escapeHtml(card.name)}</strong>
          <span>${escapeHtml(card.type || "")}</span>
        </div>
        <button type="button" data-sideboard-move="${escapeHtml(group.ids[0])}" data-sideboard-from="${fromZone}">${targetLabel}</button>
      </article>
    `;
  }

  function validateSideboardClient(player) {
    const mainCount = player?.mainDeckCount || 0;
    const sideCount = player?.sideboardCount || 0;
    if (mainCount < 60) return "Main deck precisa ter no minimo 60 cartas.";
    if (sideCount > 15) return "Sideboard pode ter no maximo 15 cartas.";
    return "";
  }

  function renderSideboardModal() {
    const player = selfPlayer();
    if (!player) return;
    const filter = normalizeLookupName(el("sideboardSearchInput").value).toLowerCase();
    const mainCards = (player.mainDeck || []).filter(card => !filter || normalizeLookupName(card.name).toLowerCase().includes(filter));
    const sideCards = (player.sideboard || []).filter(card => !filter || normalizeLookupName(card.name).toLowerCase().includes(filter));
    el("sideboardMainCount").textContent = String(player.mainDeckCount || 0);
    el("sideboardSideCount").textContent = String(player.sideboardCount || 0);
    el("sideboardMainList").innerHTML = groupedSideboardCards(mainCards).map(group => sideboardCardRow(group, "mainDeck")).join("") || `<div class="empty-zone">Nenhuma carta encontrada.</div>`;
    el("sideboardSideList").innerHTML = groupedSideboardCards(sideCards).map(group => sideboardCardRow(group, "sideboard")).join("") || `<div class="empty-zone">Sideboard vazio.</div>`;
    const warning = validateSideboardClient(player);
    el("sideboardWarning").textContent = warning;
    el("sideboardWarning").classList.toggle("hidden", !warning);
  }

  function moveSideboardGroup(cardEl) {
    if (!cardEl) return;
    const fromZone = cardEl.dataset.sideZone;
    const player = selfPlayer();
    const zoneIds = new Set((player?.[fromZone] || []).map(card => card.id));
    const selectedIds = Array.from(selectedSideboardIds).filter(id => zoneIds.has(id));
    if (selectedIds.length) {
      selectedIds.forEach(id => selectedSideboardIds.delete(id));
      sendAction({
        type: "sideboardMove",
        cardIds: selectedIds,
        cardId: selectedIds[0],
        fromZone,
        amount: selectedIds.length
      });
      return;
    }
    const ids = cardEl.dataset.cardIds.split(",").filter(Boolean);
    const count = Number(cardEl.dataset.cardCount || ids.length || 1);
    const amount = count > 1
      ? Math.max(1, Math.min(count, Number(prompt(`Voce tem ${count} copias. Quantas deseja mover?`, "1") || 0)))
      : 1;
    sendAction({
      type: "sideboardMove",
      cardIds: ids.slice(0, amount),
      cardId: ids[0],
      fromZone,
      amount
    });
  }

  function openSideboardModal() {
    el("sideboardModal").classList.remove("hidden");
    renderSideboardModal();
  }

  function closeSideboardModal() {
    el("sideboardModal").classList.add("hidden");
  }

  function applySideboard() {
    const warning = validateSideboardClient(selfPlayer());
    if (warning) {
      el("sideboardWarning").textContent = warning;
      el("sideboardWarning").classList.remove("hidden");
      return;
    }
    sendAction({ type: "applySideboard" });
    closeSideboardModal();
  }

  function tablePoint(clientX, clientY) {
    return { x: clientX, y: clientY };
  }

  function normalizeTablePoint(point) {
    return {
      x: Math.max(0, Math.min(1, point.x / Math.max(1, window.innerWidth))),
      y: Math.max(0, Math.min(1, point.y / Math.max(1, window.innerHeight)))
    };
  }

  function denormalizeTablePoint(point) {
    return {
      x: Number(point.x || 0) * window.innerWidth,
      y: Number(point.y || 0) * window.innerHeight
    };
  }

  function beginArrowFromActiveCard() {
    if (!activeCard?.id) {
      alert("Selecione uma carta antes de criar a seta.");
      return;
    }
    const cardEl = document.querySelector(`.sim-card[data-card-id="${CSS.escape(activeCard.id)}"]`);
    if (!cardEl) return;
    const cardRect = cardEl.getBoundingClientRect();
    const start = tablePoint(cardRect.left + cardRect.width / 2, cardRect.top + cardRect.height / 2);
    const id = `sim-arrow-${++arrowCounter}`;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("id", id);
    line.setAttribute("x1", String(start.x));
    line.setAttribute("y1", String(start.y));
    line.setAttribute("x2", String(start.x + 40));
    line.setAttribute("y2", String(start.y));
    line.dataset.temp = "true";
    el("arrowLayer").appendChild(line);
    arrowDraft = { id, from: normalizeTablePoint(start) };
  }

  function updateArrowDraft(clientX, clientY) {
    const line = document.getElementById(arrowDraft.id);
    if (!line) return;
    const point = tablePoint(clientX, clientY);
    line.setAttribute("x2", String(point.x));
    line.setAttribute("y2", String(point.y));
  }

  function finishArrowDraft(clientX, clientY) {
    updateArrowDraft(clientX, clientY);
    const to = normalizeTablePoint(tablePoint(clientX, clientY));
    sendAction({ type: "addArrow", from: arrowDraft.from, to });
    document.getElementById(arrowDraft.id)?.remove();
    arrowDraft = null;
  }

  function clearArrows() {
    el("arrowLayer").querySelectorAll("line").forEach(line => line.remove());
  }

  function renderArrows() {
    const layer = el("arrowLayer");
    layer.querySelectorAll("line:not([data-temp='true'])").forEach(line => line.remove());
    (state?.arrows || []).forEach(arrow => {
      const from = denormalizeTablePoint(arrow.from || {});
      const to = denormalizeTablePoint(arrow.to || {});
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.dataset.arrowId = arrow.id;
      line.setAttribute("x1", String(from.x));
      line.setAttribute("y1", String(from.y));
      line.setAttribute("x2", String(to.x));
      line.setAttribute("y2", String(to.y));
      layer.appendChild(line);
    });
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
    el("roomTitle").textContent = localTwoPlayerMode ? "Teste local - 2 jogadores" : `Sala ${activeRoomId}`;
    el("playerCount").textContent = String(players.length);
    el("currentPhaseLabel").textContent = phases[currentPhase] || currentPhase;
    document.querySelectorAll(".phase-strip button").forEach(button => button.classList.toggle("active", button.dataset.phase === currentPhase));
    renderPlayer(self, "self");
    renderPlayer(opponent, "opponent");
    renderArrows();
    renderLog();
    refreshPrivateModal();
    el("goSideboardBtn").classList.toggle("hidden", !self?.canSideboard && !self?.sideboarding);
    if (self?.sideboarding) {
      if (el("sideboardModal").classList.contains("hidden")) openSideboardModal();
      else renderSideboardModal();
    } else if (!el("sideboardModal").classList.contains("hidden")) {
      closeSideboardModal();
    }
    if (activeCard?.id) {
      activeCard = getCardById(activeCard.id) || activeCard;
      renderSelectedCard(activeCard);
    }
  }

  function renderMenuItems(items) {
    return items.map((item, index) => {
      if (item.children?.length) {
        return `<div class="menu-row" data-menu-index="${index}"><button type="button">${escapeHtml(item.label)} &gt;</button><div class="submenu">${renderMenuItems(item.children)}</div></div>`;
      }
      return `<button type="button" data-menu-path="${escapeHtml(String(index))}">${escapeHtml(item.label)}</button>`;
    }).join("");
  }

  function bindMenuItems(root, items) {
    root.querySelectorAll(":scope > button[data-menu-path]").forEach(button => {
      button.addEventListener("click", () => {
        const item = items[Number(button.dataset.menuPath)];
        item?.action?.();
        closeCardMenu();
      });
    });
    root.querySelectorAll(":scope > .menu-row").forEach((row, index) => {
      const item = items[Number(row.dataset.menuIndex)];
      bindMenuItems(row.querySelector(":scope > .submenu"), item?.children || []);
    });
  }

  function openLayeredMenu(items, x, y) {
    const menu = el("cardMenu");
    menu.innerHTML = renderMenuItems(items);
    bindMenuItems(menu, items);
    menu.style.left = `${Math.min(window.innerWidth - 240, x)}px`;
    menu.style.top = `${Math.min(window.innerHeight - 330, y)}px`;
    menu.classList.remove("hidden");
  }

  function moveTargets(cardId, options = {}) {
    const targets = [
      { label: "Cemiterio", action: () => sendAction({ type: "moveCard", cardId, toZone: "graveyard" }) },
      { label: "Exilio", action: () => sendAction({ type: "moveCard", cardId, toZone: "exile" }) },
      { label: "Mao", action: () => sendAction({ type: "moveCard", cardId, toZone: "hand" }) },
      { label: "Topo do grimorio", action: () => sendAction({ type: "moveCard", cardId, toZone: "library", position: "top" }) },
      { label: "Fundo do grimorio", action: () => sendAction({ type: "moveCard", cardId, toZone: "library", position: "bottom" }) }
    ];
    if (options.includeOpponent) {
      targets.push({ label: "Campo do oponente", action: () => sendAction({ type: "giveControl", cardId }) });
    }
    return targets;
  }

  function actionForCards(cardIds, singleType, extra = {}) {
    const ids = Array.isArray(cardIds) ? cardIds.filter(Boolean) : [cardIds].filter(Boolean);
    if (ids.length > 1) return () => sendAction({ type: "bulkCards", cardIds: ids, operation: singleType, ...extra });
    return () => sendAction({ type: singleType, cardId: ids[0], ...extra });
  }

  function moveTargetsForCards(cardIds, options = {}) {
    const ids = Array.isArray(cardIds) ? cardIds.filter(Boolean) : [cardIds].filter(Boolean);
    const action = (toZone, position = "top") => ids.length > 1
      ? sendAction({ type: "moveCards", cardIds: ids, toZone, position })
      : sendAction({ type: "moveCard", cardId: ids[0], toZone, position });
    const targets = [
      { label: "Cemiterio", action: () => action("graveyard") },
      { label: "Exilio", action: () => action("exile") },
      { label: "Mao", action: () => action("hand") },
      { label: "Topo do grimorio", action: () => action("library", "top") },
      { label: "Fundo do grimorio", action: () => action("library", "bottom") }
    ];
    if (options.includeOpponent && ids.length === 1) {
      targets.push({ label: "Campo do oponente", action: () => sendAction({ type: "giveControl", cardId: ids[0] }) });
    }
    return targets;
  }

  function markerMenu(cardIds, delta) {
    return [
      { label: "+1/+1", action: actionForCards(cardIds, "counter", { counterType: "p1p1", value: delta }) },
      { label: "+X/+X", action: actionForCards(cardIds, "marker", { markerKind: "power", powerKind: "plus", value: delta }) },
      { label: "-X/-X", action: actionForCards(cardIds, "marker", { markerKind: "power", powerKind: "minus", value: delta }) },
      ...COLORED_MARKERS.map(([color, label]) => ({ label, action: actionForCards(cardIds, "marker", { markerKind: "colored", color, value: delta }) }))
    ];
  }

  function manaMenuItems(cardId) {
    return manaColors.map(([color, , label]) => ({
      label,
      action: () => {
        const card = getCardById(cardId);
        if (card?.tapped || pendingManaCards.has(cardId)) {
          alert("Este terreno ja esta virado. Desvire-o antes de adicionar outra mana.");
          return;
        }
        pendingManaCards.add(cardId);
        sendAction({ type: "tapForMana", cardId, color });
        window.setTimeout(() => pendingManaCards.delete(cardId), 1500);
      }
    }));
  }

  function openCardMenu(cardEl, x, y) {
    const zone = cardEl.dataset.zone;
    const owner = cardEl.dataset.owner;
    const cardId = cardEl.dataset.cardId;
    if (owner !== "self") return;
    const cardIds = selectedCardIds.has(cardId) ? Array.from(selectedCardIds) : [cardId];
    const primaryCard = getCardById(cardId);

    const items = [];
    if (zone === "revealed") {
      items.push({ label: "Mover para pilha", action: () => sendAction({ type: "moveCard", cardId, toZone: "stack" }) });
      items.push({ label: "Enviar para", children: moveTargets(cardId) });
    } else if (zone === "hand") {
      items.push({ label: "Jogar para pilha", action: () => sendAction({ type: "playToStack", cardId }) });
      items.push({ label: "Jogar no campo", action: () => sendAction({ type: "moveCard", cardId, toZone: "battlefield" }) });
      items.push({ label: "Enviar para", children: moveTargets(cardId) });
    } else if (zone === "stack") {
      items.push({ label: "Resolver para campo", action: () => sendAction({ type: "resolveStack", cardId, toZone: "battlefield" }) });
      items.push({ label: "Resolver para cemiterio", action: () => sendAction({ type: "resolveStack", cardId, toZone: "graveyard" }) });
      items.push({ label: "Resolver para exilio", action: () => sendAction({ type: "resolveStack", cardId, toZone: "exile" }) });
      items.push({ label: "Voltar para mao", action: () => sendAction({ type: "resolveStack", cardId, toZone: "hand" }) });
    } else {
      items.push({ label: "Virar / Desvirar", action: actionForCards(cardIds, "toggleTap") });
      if (isLandCard(primaryCard)) {
        items.push({ label: "Adicionar mana", children: manaMenuItems(cardId) });
      }
      items.push({ label: "Enviar para", children: [{ label: "Pilha", action: () => cardIds.length > 1 ? sendAction({ type: "moveCards", cardIds, toZone: "stack" }) : sendAction({ type: "moveCard", cardId, toZone: "stack" }) }, ...moveTargetsForCards(cardIds, { includeOpponent: true })] });
      items.push({ label: "Marcadores", children: [
        { label: "Adicionar marcador", children: markerMenu(cardIds, 1) },
        { label: "Remover marcador", children: markerMenu(cardIds, -1) },
        ...ABILITY_MARKERS.map(ability => ({ label: `Alternar ${ability}`, action: actionForCards(cardIds, "marker", { markerKind: "ability", ability }) }))
      ] });
      items.push({ label: "Poder / resistencia", children: [
        { label: "+1/+1", action: actionForCards(cardIds, "counter", { counterType: "p1p1", value: 1 }) },
        { label: "-1/-1", action: actionForCards(cardIds, "counter", { counterType: "p1p1", value: -1 }) },
        { label: "+X/+X", action: actionForCards(cardIds, "marker", { markerKind: "power", powerKind: "plus", value: 1 }) },
        { label: "-X/-X", action: actionForCards(cardIds, "marker", { markerKind: "power", powerKind: "minus", value: 1 }) }
      ] });
      items.push({ label: "Criar seta", action: beginArrowFromActiveCard });
      items.push({ label: "Desfazer ultima acao da carta", action: () => sendAction({ type: "undo" }) });
      items.push({ label: "Declarar atacante", action: () => sendAction({ type: "combatFlag", cardId, flag: "attacking", enabled: true }) });
      items.push({ label: "Declarar bloqueador", action: () => sendAction({ type: "combatFlag", cardId, flag: "blocking", enabled: true }) });
      if (selectedCardIds.size > 1) {
        const cardIds = Array.from(selectedCardIds);
        items.push({ label: `Acoes em massa (${cardIds.length})`, children: [
          { label: "Cemiterio", action: () => sendAction({ type: "moveCards", cardIds, toZone: "graveyard" }) },
          { label: "Exilio", action: () => sendAction({ type: "moveCards", cardIds, toZone: "exile" }) },
          { label: "Mao", action: () => sendAction({ type: "moveCards", cardIds, toZone: "hand" }) },
          { label: "Campo", action: () => sendAction({ type: "moveCards", cardIds, toZone: "battlefield" }) },
          { label: "Topo do grimorio", action: () => sendAction({ type: "moveCards", cardIds, toZone: "library", position: "top" }) },
          { label: "Fundo do grimorio", action: () => sendAction({ type: "moveCards", cardIds, toZone: "library", position: "bottom" }) },
          { label: "Embaralhar no grimorio", action: () => sendAction({ type: "shuffleCardsIntoLibrary", cardIds }) }
        ] });
      }
    }

    openLayeredMenu(items, x, y);
  }

  function closeCardMenu() {
    el("cardMenu").classList.add("hidden");
  }

  function openActionMenu(items, x, y) {
    openLayeredMenu(items.map(([label, action]) => ({ label, action })), x, y);
  }

  function openLibraryMenu(x, y) {
    const self = selfPlayer();
    const askAmount = (label, fallback = "3") => Math.max(1, Math.min(60, Number(prompt(label, fallback) || 0)));
    openActionMenu([
      ["Ver topo", () => {
        openPrivateModal("Carta do topo", (self?.library || []).slice(0, 1), "library");
        sendAction({ type: "peekTop" });
      }],
      ["Ver X cartas do topo", () => {
        const amount = askAmount("Ver quantas cartas?", "3");
        openPrivateModal("Cartas do topo", (self?.library || []).slice(0, amount), "library");
        sendAction({ type: "viewTopX", value: amount });
      }],
      ["Revelar topo", () => sendAction({ type: "revealTop" })],
      ["Revelar X cartas", () => sendAction({ type: "revealX", value: askAmount("Revelar quantas cartas?", "3") })],
      ["Mover topo para cemiterio", () => sendAction({ type: "topToGraveyard" })],
      ["Mover X para cemiterio", () => sendAction({ type: "mill", value: askAmount("Mover quantas para o cemiterio?", "3") })],
      ["Mover topo para exilio", () => sendAction({ type: "topToExile" })],
      ["Mover X para exilio", () => sendAction({ type: "topXToExile", value: askAmount("Mover quantas para o exilio?", "3") })],
      ["Mover topo para campo", () => sendAction({ type: "topToBattlefield" })],
      ["Mover topo para pilha", () => sendAction({ type: "topToStack" })],
      ["Mover topo para fundo", () => sendAction({ type: "topToBottom" })],
      ["Mover reveladas para fundo aleatorio", () => sendAction({ type: "revealedToBottomRandom" })]
    ], x, y);
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
    privateModalState = { title, sourceZone };
    privateCards = cards || [];
    el("privateModalTitle").textContent = title;
    el("privateModalContent").innerHTML = privateCards.length
      ? privateCards.map(card => privateCardHtml(card, sourceZone)).join("")
      : `<div class="empty-zone">Nada para mostrar.</div>`;
    el("privateModal").classList.remove("hidden");
  }

  function cardsForPrivateSource(sourceZone) {
    const self = selfPlayer();
    const opponent = opponentPlayer();
    const map = {
      library: self?.library || [],
      graveyard: self?.graveyard || [],
      exile: self?.exile || [],
      revealed: self?.revealed || [],
      opponent: [],
      "opponent-graveyard": opponent?.graveyard || [],
      "opponent-exile": opponent?.exile || []
    };
    return map[sourceZone] || [];
  }

  function refreshPrivateModal() {
    if (!privateModalState || el("privateModal").classList.contains("hidden")) return;
    const content = el("privateModalContent");
    const scrollTop = content.scrollTop;
    const cards = cardsForPrivateSource(privateModalState.sourceZone);
    privateCards = cards;
    content.innerHTML = cards.length
      ? cards.map(card => privateCardHtml(card, privateModalState.sourceZone)).join("")
      : `<div class="empty-zone">Nada para mostrar.</div>`;
    content.scrollTop = scrollTop;
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

  async function toggleFullscreen() {
    const app = document.querySelector(".sim-table-app");
    try {
      if (!document.fullscreenElement) await app.requestFullscreen();
      else await document.exitFullscreen();
    } catch (error) {
      alert("Nao foi possivel alterar o modo de tela cheia neste navegador.");
    }
  }

  function syncFullscreenButton() {
    el("fullscreenBtn").textContent = document.fullscreenElement ? "Sair da tela cheia" : "Tela cheia";
    requestAnimationFrame(renderArrows);
  }

  function bindEvents() {
    el("playerNameInput").value = savedName;
    el("playerOneNameInput").value = savedName || "Jogador 1";
    el("playerTwoNameInput").value = "Jogador 2";
    document.querySelectorAll("input[name='localTestMode']").forEach(input => {
      input.addEventListener("change", updateLocalModeUi);
    });
    updateLocalModeUi();
    el("openGameModalBtn").addEventListener("click", () => el("gameModal").classList.remove("hidden"));
    el("cancelGameBtn").addEventListener("click", () => el("gameModal").classList.add("hidden"));
    el("createGameBtn").addEventListener("click", createGame);
    el("simAudioToggleBtn").addEventListener("click", async () => {
      if (!simulatorAudioStarted) await startSimulatorAudio(true);
      else toggleSimulatorAudioMute();
    });
    el("simAudioReconnectBtn").addEventListener("click", reconnectSimulatorAudio);
    el("switchLocalPlayerBtn").addEventListener("click", () => {
      if (!localTwoPlayerMode) return;
      setLocalView(playerId === localPlayerIds.p1 ? localPlayerIds.p2 : localPlayerIds.p1);
    });
    el("concedeBtn").addEventListener("click", () => {
      if (confirm("Tem certeza que deseja conceder a partida?")) sendAction({ type: "concede" });
    });
    el("goSideboardBtn").addEventListener("click", () => sendAction({ type: "beginSideboard" }));
    el("newGameBtn").addEventListener("click", () => {
      if (confirm("Iniciar nova partida e limpar zonas atuais?")) sendAction({ type: "newGame" });
    });
    el("fullscreenBtn").addEventListener("click", toggleFullscreen);
    document.addEventListener("fullscreenchange", syncFullscreenButton);
    window.addEventListener("resize", () => requestAnimationFrame(renderArrows));
    el("layoutSizeSelect").addEventListener("change", event => {
      document.querySelector(".sim-table-app").classList.remove("layout-compact", "layout-medium", "layout-spacious");
      document.querySelector(".sim-table-app").classList.add(`layout-${event.target.value}`);
    });
    setCardSize(localStorage.getItem("resenhaon-sim-card-size") || 100);
    const settings = previewSettings();
    el("previewEnabledInput").checked = settings.enabled;
    el("previewPinnedInput").checked = localStorage.getItem("resenhaon-sim-preview-pinned") === "true";
    el("previewModeSelect").value = settings.mode;
    el("previewSizeSelect").value = settings.size;
    const commandsOpen = localStorage.getItem("resenhaon-sim-commands-open") === "true";
    el("commandRow").classList.toggle("collapsed", !commandsOpen);
    el("toggleCommandsBtn").textContent = commandsOpen ? "Ocultar Comandos" : "Mostrar Comandos";
    const sideCollapsed = localStorage.getItem("resenhaon-sim-side-collapsed") === "true";
    document.querySelector(".sim-table-app").classList.toggle("side-collapsed", sideCollapsed);
    el("toggleSidePanelBtn").textContent = sideCollapsed ? ">" : "<";
    const handExpanded = localStorage.getItem("resenhaon-sim-hand-expanded") === "true";
    const savedHandHeight = localStorage.getItem("resenhaon-sim-hand-height");
    if (savedHandHeight) document.documentElement.style.setProperty("--sim-hand-height", `${Math.max(126, Math.min(280, Number(savedHandHeight) || 150))}px`);
    const savedStackWidth = localStorage.getItem("resenhaon-sim-stack-width");
    if (savedStackWidth) {
      const stackWidth = Number(savedStackWidth) || 110;
      const compactedWidth = stackWidth > 124 ? Math.round(stackWidth * 0.8) : stackWidth;
      document.documentElement.style.setProperty("--sim-stack-width", `${Math.max(104, Math.min(180, compactedWidth))}px`);
    }
    setHandExpanded(handExpanded);
    el("loadDeckBtn").addEventListener("click", () => el("deckFileInput").click());
    el("loadDeckBtnP1").addEventListener("click", () => el("deckFileInputP1").click());
    el("loadDeckBtnP2").addEventListener("click", () => el("deckFileInputP2").click());
    el("confirmDeckBtnP1").addEventListener("click", () => loadLocalDeck("p1"));
    el("confirmDeckBtnP2").addEventListener("click", () => loadLocalDeck("p2"));
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
    el("deckFileInputP1").addEventListener("change", () => loadLocalDeck("p1"));
    el("deckFileInputP2").addEventListener("change", () => loadLocalDeck("p2"));
    el("cardSizeSlider").addEventListener("input", event => setCardSize(event.target.value));
    el("previewEnabledInput").addEventListener("change", event => localStorage.setItem("resenhaon-sim-preview-enabled", event.target.checked ? "true" : "false"));
    el("previewPinnedInput").addEventListener("change", event => localStorage.setItem("resenhaon-sim-preview-pinned", event.target.checked ? "true" : "false"));
    el("previewModeSelect").addEventListener("change", event => localStorage.setItem("resenhaon-sim-preview-mode", event.target.value));
    el("previewSizeSelect").addEventListener("change", event => localStorage.setItem("resenhaon-sim-preview-size", event.target.value));

    el("selfLife").addEventListener("click", event => {
      sendAction({ type: "life", value: event.shiftKey ? 5 : 1 });
    });
    el("selfLife").addEventListener("contextmenu", event => {
      event.preventDefault();
      sendAction({ type: "life", value: event.shiftKey ? -5 : -1 });
    });
    el("toggleCommandsBtn").addEventListener("click", () => {
      const open = el("commandRow").classList.toggle("collapsed") === false;
      localStorage.setItem("resenhaon-sim-commands-open", open ? "true" : "false");
      el("toggleCommandsBtn").textContent = open ? "Ocultar Comandos" : "Mostrar Comandos";
    });
    el("toggleSidePanelBtn").addEventListener("click", () => {
      const collapsed = document.querySelector(".sim-table-app").classList.toggle("side-collapsed");
      localStorage.setItem("resenhaon-sim-side-collapsed", collapsed ? "true" : "false");
      el("toggleSidePanelBtn").textContent = collapsed ? ">" : "<";
    });
    el("expandHandBtn").addEventListener("click", () => {
      setHandExpanded(!document.querySelector(".hand-dock").classList.contains("hand-expanded"));
    });
    el("createArrowBtn").addEventListener("click", beginArrowFromActiveCard);
    el("clearArrowsBtn").addEventListener("click", () => sendAction({ type: "clearArrows" }));
    el("undoActionBtn").addEventListener("click", () => sendAction({ type: "undo" }));
    document.querySelectorAll(".phase-strip button").forEach(button => {
      const [icon, label] = phaseMeta[button.dataset.phase] || ["•", button.textContent];
      button.innerHTML = `<span class="phase-icon">${escapeHtml(icon)}</span><span>${escapeHtml(label)}</span>`;
      button.addEventListener("click", () => sendAction({ type: "phase", value: button.dataset.phase }));
    });
    el("openTokenModalBtn").addEventListener("click", () => el("tokenModal").classList.remove("hidden"));
    el("closeTokenModal").addEventListener("click", () => el("tokenModal").classList.add("hidden"));
    el("rollDiceBtn").addEventListener("click", () => rollDice());
    el("toggleToolsBtn").addEventListener("click", () => el("toolsPanel").classList.toggle("collapsed"));
    el("closePrivateModal").addEventListener("click", () => el("privateModal").classList.add("hidden"));
    el("closeZoomModal").addEventListener("click", () => el("zoomModal").classList.add("hidden"));
    el("arrowLayer").addEventListener("contextmenu", event => {
      const line = event.target.closest("line[data-arrow-id]");
      if (!line) return;
      event.preventDefault();
      sendAction({ type: "removeArrow", arrowId: line.dataset.arrowId });
    });
    el("timerStartBtn").addEventListener("click", startTimer);
    el("timerPauseBtn").addEventListener("click", pauseTimer);
    el("timerResetBtn").addEventListener("click", resetTimer);
    el("sideboardSearchInput").addEventListener("input", renderSideboardModal);
    el("resetSideboardBtn").addEventListener("click", () => sendAction({ type: "resetSideboardChanges" }));
    el("applySideboardBtn").addEventListener("click", applySideboard);
    el("returnFromSideboardBtn").addEventListener("click", applySideboard);
    el("sideboardModal").addEventListener("dblclick", event => {
      const card = event.target.closest(".sideboard-card");
      if (card) moveSideboardGroup(card);
    });
    el("sideboardModal").addEventListener("click", event => {
      const card = event.target.closest(".sideboard-card");
      if (card && (event.ctrlKey || event.metaKey || event.shiftKey) && !event.target.closest("button")) {
        card.dataset.cardIds.split(",").forEach(id => {
          if (selectedSideboardIds.has(id)) selectedSideboardIds.delete(id);
          else selectedSideboardIds.add(id);
        });
        renderSideboardModal();
        return;
      }
      const button = event.target.closest("[data-sideboard-move]");
      if (button) moveSideboardGroup(button.closest(".sideboard-card"));
    });
    el("zoomModal").addEventListener("click", event => {
      if (event.target.id === "zoomModal") el("zoomModal").classList.add("hidden");
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        el("zoomModal").classList.add("hidden");
        el("privateModal").classList.add("hidden");
        el("previewPinnedInput").checked = false;
        localStorage.setItem("resenhaon-sim-preview-pinned", "false");
        hideHoverPreview();
        closeCardMenu();
        return;
      }
      if (keyboardShortcutsBlocked(event)) return;
      const opponent = opponentPlayer();
      const lifeShortcutMap = {
        ArrowUp: () => sendAction({ type: "life", value: 1 }),
        ArrowDown: () => sendAction({ type: "life", value: -1 }),
        ArrowRight: () => opponent && sendActionFor(opponent.id, { type: "life", value: 1 }),
        ArrowLeft: () => opponent && sendActionFor(opponent.id, { type: "life", value: -1 })
      };
      const action = lifeShortcutMap[event.key];
      if (action) {
        event.preventDefault();
        action();
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
          "opponent-graveyard": [opponent?.graveyard || [], "Cemiterio do oponente", "opponent-graveyard"],
          "opponent-exile": [opponent?.exile || [], "Exilio do oponente", "opponent-exile"]
        };
        const [cards, title, sourceZone] = map[button.dataset.viewZone] || [[], "Zona", "library"];
        openPrivateModal(title, cards, sourceZone);
      });
    });

    el("libraryButton").addEventListener("click", event => event.preventDefault());
    el("libraryButton").addEventListener("contextmenu", event => {
      event.preventDefault();
      openLibraryMenu(event.clientX, event.clientY);
    });

    document.body.addEventListener("click", event => {
      const mana = event.target.closest(".mana-symbol[data-owner='self']");
      if (!mana || mana.disabled) return;
      event.preventDefault();
      sendAction({ type: "spendMana", color: mana.dataset.manaColor });
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
    });

    document.body.addEventListener("click", event => {
      const card = event.target.closest(".sim-card,.mini-card");
      if (card && !event.target.closest("#privateModalContent")) {
        activeCard = getCardById(card.dataset.cardId);
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          if (selectedCardIds.has(card.dataset.cardId)) selectedCardIds.delete(card.dataset.cardId);
          else selectedCardIds.add(card.dataset.cardId);
          renderSelectedCard(activeCard);
          render();
          return;
        }
        selectedCardIds.clear();
        renderSelectedCard(activeCard);
        return;
      }
      if (!event.target.closest("#cardMenu")) closeCardMenu();
    });
    document.body.addEventListener("contextmenu", event => {
      if (event.target.closest("#libraryButton")) {
        event.preventDefault();
        openLibraryMenu(event.clientX, event.clientY);
        return;
      }
      const card = event.target.closest(".sim-card,.mini-card");
      if (card) {
        event.preventDefault();
        activeCard = getCardById(card.dataset.cardId);
        if (!selectedCardIds.has(card.dataset.cardId)) {
          selectedCardIds.clear();
          selectedCardIds.add(card.dataset.cardId);
        }
        renderSelectedCard(activeCard);
        const now = Date.now();
        const isRightDouble = lastRightClick.cardId === card.dataset.cardId && now - lastRightClick.time < 420;
        lastRightClick = { cardId: card.dataset.cardId, time: now };
        if (isRightDouble && card.dataset.owner === "self" && card.dataset.zone === "battlefield") {
          sendAction({ type: "toggleTap", cardId: card.dataset.cardId });
          closeCardMenu();
          return;
        }
        openCardMenu(card, event.clientX, event.clientY);
      }
    });
    document.body.addEventListener("mouseover", event => {
      const cardEl = event.target.closest(".sim-card,.mini-card,.sideboard-card");
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
      if (localStorage.getItem("resenhaon-sim-preview-pinned") === "true") return;
      if (event.target.closest(".sim-card,.mini-card,.sideboard-card")) hideHoverPreview();
    });
    document.body.addEventListener("pointerdown", event => {
      if (arrowDraft) return;
      const preview = event.target.closest("#hoverPreview");
      if (preview && localStorage.getItem("resenhaon-sim-preview-pinned") === "true") {
        previewDrag = { x: event.clientX - preview.offsetLeft, y: event.clientY - preview.offsetTop };
        return;
      }
      const selectionField = event.target.closest(".battlefield");
      if (selectionField && event.button === 0 && !event.target.closest(".sim-card")) {
        selectedCardIds.clear();
        const box = document.createElement("div");
        box.className = "selection-box";
        document.querySelector(".virtual-table").appendChild(box);
        selectionDrag = {
          field: selectionField,
          box,
          startX: event.clientX,
          startY: event.clientY
        };
        return;
      }
      const stack = event.target.closest(".stack-zone");
      if (stack) {
        const stackRect = stack.getBoundingClientRect();
        if (event.clientX >= stackRect.right - 12) {
          stackResize = {
            startX: event.clientX,
            startWidth: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sim-stack-width")) || stackRect.width
          };
          return;
        }
      }
      const cardEl = event.target.closest(".battlefield .sim-card[data-owner='self']");
      if (!cardEl) return;
      const field = cardEl.closest(".battlefield");
      const rect = field.getBoundingClientRect();
      const cardRect = cardEl.getBoundingClientRect();
      battlefieldDrag = {
        cardId: cardEl.dataset.cardId,
        field,
        offsetX: event.clientX - cardRect.left,
        offsetY: event.clientY - cardRect.top,
        rect,
        cardWidth: cardRect.width,
        cardHeight: cardRect.height
      };
      cardEl.setPointerCapture?.(event.pointerId);
    });
    document.body.addEventListener("pointermove", event => {
      if (arrowDraft) {
        updateArrowDraft(event.clientX, event.clientY);
        return;
      }
      if (handResize) {
        const nextHeight = Math.max(126, Math.min(280, handResize.startHeight - (event.clientY - handResize.startY)));
        document.documentElement.style.setProperty("--sim-hand-height", `${nextHeight}px`);
        return;
      }
      if (stackResize) {
        const nextWidth = Math.max(104, Math.min(180, stackResize.startWidth + (event.clientX - stackResize.startX)));
        document.documentElement.style.setProperty("--sim-stack-width", `${nextWidth}px`);
        return;
      }
      if (previewDrag) {
        el("hoverPreview").style.left = `${Math.max(8, Math.min(window.innerWidth - 120, event.clientX - previewDrag.x))}px`;
        el("hoverPreview").style.top = `${Math.max(8, Math.min(window.innerHeight - 120, event.clientY - previewDrag.y))}px`;
        return;
      }
      if (selectionDrag) {
        const left = Math.min(selectionDrag.startX, event.clientX);
        const top = Math.min(selectionDrag.startY, event.clientY);
        const width = Math.abs(event.clientX - selectionDrag.startX);
        const height = Math.abs(event.clientY - selectionDrag.startY);
        Object.assign(selectionDrag.box.style, {
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: `${height}px`
        });
        return;
      }
      if (!battlefieldDrag) return;
      const cardEl = document.querySelector(`.battlefield .sim-card[data-card-id="${CSS.escape(battlefieldDrag.cardId)}"]`);
      const { x, y } = boundedBattlefieldPosition(battlefieldDrag.field, cardEl, event.clientX, event.clientY, battlefieldDrag.offsetX, battlefieldDrag.offsetY);
      if (cardEl) {
        cardEl.style.left = `${x}px`;
        cardEl.style.top = `${y}px`;
      }
    });
    document.body.addEventListener("pointerup", event => {
      if (arrowDraft) {
        finishArrowDraft(event.clientX, event.clientY);
        return;
      }
      if (handResize) {
        const value = getComputedStyle(document.documentElement).getPropertyValue("--sim-hand-height").replace("px", "").trim();
        localStorage.setItem("resenhaon-sim-hand-height", value || "150");
        handResize = null;
        return;
      }
      if (stackResize) {
        const value = getComputedStyle(document.documentElement).getPropertyValue("--sim-stack-width").replace("px", "").trim();
        localStorage.setItem("resenhaon-sim-stack-width", value || "110");
        stackResize = null;
        return;
      }
      if (previewDrag) {
        previewDrag = null;
        return;
      }
      if (selectionDrag) {
        const selectionRect = selectionDrag.box.getBoundingClientRect();
        selectionDrag.field.querySelectorAll(".sim-card[data-owner='self']").forEach(cardEl => {
          if (rectsIntersect(selectionRect, cardEl.getBoundingClientRect())) {
            selectedCardIds.add(cardEl.dataset.cardId);
          }
        });
        selectionDrag.box.remove();
        selectionDrag = null;
        render();
        return;
      }
      if (!battlefieldDrag) return;
      const cardEl = document.querySelector(`.battlefield .sim-card[data-card-id="${CSS.escape(battlefieldDrag.cardId)}"]`);
      const { x, y } = boundedBattlefieldPosition(battlefieldDrag.field, cardEl, event.clientX, event.clientY, battlefieldDrag.offsetX, battlefieldDrag.offsetY);
      sendAction({ type: "cardPosition", cardId: battlefieldDrag.cardId, x, y });
      battlefieldDrag = null;
    });
    el("handResizeHandle").addEventListener("pointerdown", event => {
      setHandExpanded(false);
      handResize = {
        startY: event.clientY,
        startHeight: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sim-hand-height")) || 150
      };
    });
    document.body.addEventListener("dblclick", event => {
      const cardEl = event.target.closest(".sim-card,.mini-card");
      if (!cardEl) return;
      if (cardEl.dataset.owner === "self" && cardEl.dataset.zone === "revealed") {
        sendAction({ type: "moveCard", cardId: cardEl.dataset.cardId, toZone: "stack" });
        closeCardMenu();
      }
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
    syncLocalViewWithActivePlayer();
    render();
  });
  socket.on("simulator-audio-peers", async ({ peers = [] } = {}) => {
    if (!simulatorAudioStarted) return;
    for (const peer of peers) {
      if (peer?.socketId) await callSimulatorAudioPeer(peer.socketId);
    }
    if (!peers.length) setSimulatorAudioStatus(simulatorAudioMuted ? "Microfone mutado | Aguardando oponente" : "Microfone ativo | Aguardando oponente", simulatorAudioMuted ? "muted" : "active");
  });
  socket.on("simulator-audio-peer-left", ({ socketId } = {}) => {
    if (socketId) closeSimulatorAudioPeer(socketId);
    setSimulatorAudioStatus(simulatorAudioMuted ? "Microfone mutado | Oponente sem audio" : "Microfone ativo | Oponente sem audio", simulatorAudioMuted ? "muted" : "");
  });
  socket.on("simulator-audio-signal", async ({ from, type, payload } = {}) => {
    if (!from || !type) return;
    try {
      await ensureSimulatorAudioStream();
      simulatorAudioStarted = true;
      updateSimulatorAudioButtons();
      const peer = createSimulatorAudioPeer(from);
      if (type === "offer") {
        await peer.setRemoteDescription(new RTCSessionDescription(payload));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit("simulator-audio-signal", { roomId: activeRoomId, to: from, playerId, type: "answer", payload: answer });
      } else if (type === "answer") {
        await peer.setRemoteDescription(new RTCSessionDescription(payload));
      } else if (type === "ice" && payload) {
        await peer.addIceCandidate(new RTCIceCandidate(payload));
      }
    } catch (error) {
      setSimulatorAudioStatus("Falha na conexao de audio", "error");
      el("simAudioReconnectBtn")?.classList.remove("hidden");
    }
  });

  renderTokenBank();
  updateTimerDisplay();
  bindEvents();
})();
