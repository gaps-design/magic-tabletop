(() => {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room") || "";
  const initialView = params.get("view") || "dual";
  const showControls = params.get("controls") === "1";
  const transparent = params.get("transparent") === "1";
  const socket = io();

  const servers = {
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

  const peerConnections = {};
  const peerInfo = {};
  const remoteStreams = {};
  const pendingCandidates = {};
  const makingOffer = {};
  const faceCamPeers = {};
  const faceCamPendingCandidates = {};
  const faceCamSources = {};
  const chatMessages = [];
  const mutedPlayers = { 1: false, 2: false };

  const markerLabels = {
    storm: "Storm",
    poison: "Veneno",
    energy: "Energia",
    "mana-white": "Mana Branca",
    "mana-blue": "Mana Azul",
    "mana-black": "Mana Preta",
    "mana-red": "Mana Vermelha",
    "mana-green": "Mana Verde",
    "mana-colorless": "Mana Incolor"
  };

  function el(id) {
    return document.getElementById(id);
  }

  function setView(view) {
    const safeView = ["dual", "j1", "j2"].includes(view) ? view : "dual";
    document.body.classList.toggle("view-j1", safeView === "j1");
    document.body.classList.toggle("view-j2", safeView === "j2");
  }

  function formatTimer(timer) {
    const remaining = Math.max(0, Number(timer?.remaining ?? 3000));
    const minutes = Math.floor(remaining / 60).toString().padStart(2, "0");
    const seconds = Math.floor(remaining % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function getPlayerNumber(info = {}) {
    const direct = Number(info.playerNumber || 0);
    if ([1, 2].includes(direct)) return direct;
    const linked = Number(info.linkedPlayer || 0);
    return [1, 2].includes(linked) ? linked : 0;
  }

  function getVideoForPlayer(playerNumber) {
    return el(`player${playerNumber}Video`);
  }

  function setVideoForPlayer(playerNumber, stream) {
    const video = getVideoForPlayer(playerNumber);
    if (!video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.muted = !!mutedPlayers[playerNumber];
    video.volume = mutedPlayers[playerNumber] ? 0 : 1;
    video.closest(".player-block")?.classList.add("has-stream");
    video.play?.().catch(() => {});
  }

  function routeStream(socketId, stream) {
    const info = peerInfo[socketId] || {};
    const playerNumber = getPlayerNumber(info);
    if (!playerNumber) return;
    setVideoForPlayer(playerNumber, stream);
  }

  function createPeerConnection(targetId) {
    if (peerConnections[targetId]) return peerConnections[targetId];

    const peer = new RTCPeerConnection(servers);
    peerConnections[targetId] = peer;
    peer.addTransceiver("video", { direction: "recvonly" });
    peer.addTransceiver("audio", { direction: "recvonly" });

    peer.ontrack = (event) => {
      let stream = event.streams[0];
      if (!stream) {
        remoteStreams[targetId] = remoteStreams[targetId] || new MediaStream();
        if (!remoteStreams[targetId].getTracks().some(track => track.id === event.track.id)) {
          remoteStreams[targetId].addTrack(event.track);
        }
        stream = remoteStreams[targetId];
      } else {
        remoteStreams[targetId] = stream;
      }
      routeStream(targetId, stream);
    };

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit("ice-candidate", { target: targetId, candidate: event.candidate });
    };

    peer.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(peer.connectionState)) {
        cleanupPeer(targetId);
      }
    };

    return peer;
  }

  async function createOffer(targetId, info = {}) {
    peerInfo[targetId] = { ...(peerInfo[targetId] || {}), ...info, socketId: targetId };
    const peer = createPeerConnection(targetId);

    if (makingOffer[targetId] || peer.signalingState !== "stable") return;

    makingOffer[targetId] = true;
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socket.emit("offer", { target: targetId, offer });
    } finally {
      makingOffer[targetId] = false;
    }
  }

  async function flushCandidates(sender) {
    const peer = peerConnections[sender];
    if (!peer?.remoteDescription || !pendingCandidates[sender]) return;

    while (pendingCandidates[sender].length) {
      await peer.addIceCandidate(new RTCIceCandidate(pendingCandidates[sender].shift()));
    }
    delete pendingCandidates[sender];
  }

  function cleanupPeer(socketId) {
    peerConnections[socketId]?.close?.();
    delete peerConnections[socketId];
    delete peerInfo[socketId];
    delete remoteStreams[socketId];
    delete pendingCandidates[socketId];
  }

  function faceCamKey(socketId) {
    return `${socketId}:recv`;
  }

  function createFaceCamReceiver(sourceId, info = {}) {
    const key = faceCamKey(sourceId);
    if (faceCamPeers[key]) return faceCamPeers[key];

    const peer = new RTCPeerConnection(servers);
    faceCamPeers[key] = peer;
    faceCamSources[sourceId] = { ...(faceCamSources[sourceId] || {}), ...info, socketId: sourceId };
    peer.addTransceiver("video", { direction: "recvonly" });

    peer.ontrack = (event) => {
      const playerNumber = getPlayerNumber(faceCamSources[sourceId] || info);
      const video = el(`player${playerNumber}FaceCam`);
      if (!video) return;
      video.srcObject = event.streams[0] || new MediaStream([event.track]);
      video.classList.remove("hidden");
      video.play?.().catch(() => {});
    };

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit("facecam-ice-candidate", { target: sourceId, candidate: event.candidate, side: "recv" });
    };

    return peer;
  }

  async function requestFaceCam(source = {}) {
    if (!source.socketId) return;
    faceCamSources[source.socketId] = { ...(faceCamSources[source.socketId] || {}), ...source };
    const peer = createFaceCamReceiver(source.socketId, source);
    if (peer.signalingState !== "stable") return;

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit("facecam-offer", { target: source.socketId, offer });
  }

  async function flushFaceCamCandidates(key) {
    const peer = faceCamPeers[key];
    if (!peer?.remoteDescription || !faceCamPendingCandidates[key]) return;
    while (faceCamPendingCandidates[key].length) {
      await peer.addIceCandidate(new RTCIceCandidate(faceCamPendingCandidates[key].shift()));
    }
    delete faceCamPendingCandidates[key];
  }

  function removeFaceCam(source = {}) {
    const playerNumber = Number(source.playerNumber || faceCamSources[source.socketId]?.playerNumber || 0);
    const key = faceCamKey(source.socketId);
    faceCamPeers[key]?.close?.();
    delete faceCamPeers[key];
    delete faceCamSources[source.socketId];
    const video = el(`player${playerNumber}FaceCam`);
    if (video) {
      video.srcObject = null;
      video.classList.add("hidden");
    }
  }

  function renderRoomState(state = {}) {
    const players = Array.isArray(state.players) ? state.players : [];
    const playerOne = players.find(player => Number(player.playerNumber) === 1);
    const playerTwo = players.find(player => Number(player.playerNumber) === 2);

    renderPlayer(1, playerOne);
    renderPlayer(2, playerTwo);
    el("timerDisplay").innerText = formatTimer(state.timer);
    renderScore(state.matchScore || {});
    renderMarkers(state.markerState || {});

    if (state.currentScannerCard) renderScannerCard(state.currentScannerCard);

    (state.faceCams || []).forEach(source => requestFaceCam(source).catch(console.warn));
    el("emptyState")?.classList.toggle("hidden", players.length > 0);
  }

  function renderPlayer(number, player = {}) {
    el(`player${number}Name`).innerText = player?.name || `Jogador ${number}`;
    el(`player${number}Deck`).innerText = player?.deck || "Deck nao informado";
    el(`player${number}Life`).innerText = Number(player?.life ?? 20);
    el(`topPlayer${number}Name`).innerText = player?.name || `Jogador ${number}`;
    el(`topPlayer${number}Deck`).innerText = player?.deck || "Deck nao informado";
    el(`topPlayer${number}Life`).innerText = Number(player?.life ?? 20);

    const link = el(`player${number}Decklist`);
    if (player?.decklistUrl) {
      link.href = player.decklistUrl;
      link.innerText = `Decklist ${player.name || `J${number}`}`;
      link.classList.remove("disabled");
    } else {
      link.removeAttribute("href");
      link.innerText = "Lista nao informada";
      link.classList.add("disabled");
    }
  }

  function renderScore(score = {}) {
    const s1 = Math.max(0, Math.min(3, Number(score[1] ?? score["1"]) || 0));
    const s2 = Math.max(0, Math.min(3, Number(score[2] ?? score["2"]) || 0));
    el("scoreLine").innerText = `${s1} x ${s2}`;
    el("player1Score").innerText = "■".repeat(s1) + "□".repeat(3 - s1);
    el("player2Score").innerText = "■".repeat(s2) + "□".repeat(3 - s2);
  }

  function renderMarkers(markerState = {}) {
    [1, 2].forEach(playerNumber => {
      const root = el(`player${playerNumber}Markers`);
      root.innerHTML = "";
      const entries = Object.entries(markerState[playerNumber] || markerState[String(playerNumber)] || {});
      const topMarkers = el(`topPlayer${playerNumber}Markers`);
      if (topMarkers) {
        topMarkers.innerText = entries.length
          ? entries.map(([id, marker]) => `${markerLabels[id] || id}: ${Number(marker.value) || 0}`).join("\n")
          : "Marcadores: nenhum";
      }
      entries.forEach(([id, marker]) => {
        const chip = document.createElement("span");
        chip.className = "marker-chip";
        chip.innerText = `${markerLabels[id] || id} ${Number(marker.value) || 0}`;
        root.appendChild(chip);
      });
    });
  }

  function appendChatMessage(data = {}) {
    const list = el("chatList");
    if (!list) return;
    chatMessages.push(data);
    while (chatMessages.length > 5) chatMessages.shift();
    list.innerHTML = "";
    chatMessages.forEach(item => {
      const row = document.createElement("div");
      row.className = "chat-message";
      const name = document.createElement("strong");
      name.innerText = `${item.name || "Usuario"}: `;
      const message = document.createElement("span");
      message.innerText = item.message || "";
      row.append(name, message);
      list.appendChild(row);
    });
  }

  function summarize(text, limit = 280) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    return clean.length > limit ? `${clean.slice(0, limit - 1).trim()}...` : clean;
  }

  function renderScannerCard(payload = {}) {
    const card = payload.card || payload;
    const root = el("scannerCard");
    if (!root || !card?.name) return;

    root.classList.remove("empty");
    root.innerHTML = "";

    if (card.imageUrl) {
      const image = document.createElement("img");
      image.src = card.imageUrl;
      image.alt = card.name;
      root.appendChild(image);
    }

    const details = document.createElement("div");
    const title = document.createElement("h3");
    title.innerText = card.name;
    const meta = document.createElement("p");
    meta.innerText = [card.manaCost, card.typeLine].filter(Boolean).join(" • ");
    const text = document.createElement("p");
    text.innerText = summarize(card.oracleText);
    details.append(title, meta, text);
    root.appendChild(details);
  }

  async function searchManualCard() {
    const query = el("manualCardInput")?.value?.trim();
    if (!query) return;

    const response = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(query)}`);
    if (!response.ok) return;
    const data = await response.json();
    const face = Array.isArray(data.card_faces) ? data.card_faces[0] : null;
    const imageUris = data.image_uris || face?.image_uris || {};
    renderScannerCard({
      card: {
        name: data.name || face?.name || query,
        manaCost: data.mana_cost || face?.mana_cost || "",
        typeLine: data.type_line || face?.type_line || "",
        oracleText: data.oracle_text || face?.oracle_text || "",
        imageUrl: imageUris.normal || imageUris.large || imageUris.small || ""
      }
    });
  }

  function applyAudioMute(playerNumber, muted) {
    mutedPlayers[playerNumber] = muted;
    const video = getVideoForPlayer(playerNumber);
    if (video) video.muted = muted;
  }

  function setupControls() {
    document.body.classList.toggle("controls-on", showControls);
    document.body.classList.toggle("transparent", transparent);
    setView(initialView);

    document.querySelectorAll("[data-view]").forEach(button => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });

    el("enableAudioBtn")?.addEventListener("click", () => {
      [1, 2].forEach(playerNumber => {
        applyAudioMute(playerNumber, false);
        getVideoForPlayer(playerNumber)?.play?.().catch(() => {});
      });
    });
    el("muteJ1Btn")?.addEventListener("click", () => applyAudioMute(1, true));
    el("muteJ2Btn")?.addEventListener("click", () => applyAudioMute(2, true));
    el("muteAllBtn")?.addEventListener("click", () => { applyAudioMute(1, true); applyAudioMute(2, true); });
    el("unmuteAllBtn")?.addEventListener("click", () => { applyAudioMute(1, false); applyAudioMute(2, false); });
    el("toggleChatBtn")?.addEventListener("click", () => {
      el("chatList")?.classList.toggle("hidden");
      el("toggleChatBtn").innerText = el("chatList")?.classList.contains("hidden") ? "Mostrar" : "Ocultar";
    });
    el("manualCardBtn")?.addEventListener("click", () => searchManualCard().catch(console.warn));
    el("clearManualCardBtn")?.addEventListener("click", () => {
      const root = el("scannerCard");
      if (!root) return;
      root.className = "scanner-card-body empty";
      root.innerText = "Nenhuma carta exibida.";
    });
  }

  socket.on("connect", () => {
    if (!roomId) {
      el("emptyState")?.classList.remove("hidden");
      return;
    }
    el("roomLabel").innerText = roomId;
    socket.emit("join-overlay", { roomId, role: "overlay" });
  });

  socket.on("existing-peers", ({ peers = [] } = {}) => {
    peers.forEach(peer => {
      if (!peer?.socketId) return;
      if (!["player", "camera"].includes(peer.role)) return;
      peerInfo[peer.socketId] = { ...(peerInfo[peer.socketId] || {}), ...peer, socketId: peer.socketId };
    });
  });

  socket.on("user-connected", data => {
    if (!data?.socketId || !["player", "camera"].includes(data.role)) return;
    peerInfo[data.socketId] = { ...(peerInfo[data.socketId] || {}), ...data, socketId: data.socketId };
  });

  socket.on("user-disconnected", socketId => {
    cleanupPeer(socketId);
    removeFaceCam({ socketId });
  });

  socket.on("room-state", renderRoomState);
  socket.on("timer-update", timer => { el("timerDisplay").innerText = formatTimer(timer); });
  socket.on("chat-message", appendChatMessage);
  socket.on("card-scan-shown", renderScannerCard);

  socket.on("facecam-list", ({ faceCams = [] } = {}) => {
    faceCams.forEach(source => requestFaceCam(source).catch(console.warn));
  });
  socket.on("facecam-started", source => requestFaceCam(source).catch(console.warn));
  socket.on("facecam-stopped", removeFaceCam);

  socket.on("answer", async ({ answer, sender }) => {
    const peer = peerConnections[sender];
    if (!peer || !answer) return;
    await peer.setRemoteDescription(new RTCSessionDescription(answer));
    await flushCandidates(sender);
  });

  socket.on("offer", async ({ offer, sender, senderInfo }) => {
    if (!sender || !offer) return;
    peerInfo[sender] = { ...(peerInfo[sender] || {}), ...(senderInfo || {}), socketId: sender };
    const peer = createPeerConnection(sender);
    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit("answer", { target: sender, answer });
    await flushCandidates(sender);
  });

  socket.on("ice-candidate", async ({ candidate, sender }) => {
    const peer = peerConnections[sender];
    if (!peer?.remoteDescription) {
      pendingCandidates[sender] = pendingCandidates[sender] || [];
      pendingCandidates[sender].push(candidate);
      return;
    }
    await peer.addIceCandidate(new RTCIceCandidate(candidate));
  });

  socket.on("facecam-answer", async ({ answer, sender, senderInfo }) => {
    if (senderInfo) faceCamSources[sender] = { ...(faceCamSources[sender] || {}), ...senderInfo, socketId: sender };
    const key = faceCamKey(sender);
    const peer = faceCamPeers[key];
    if (!peer || !answer) return;
    await peer.setRemoteDescription(new RTCSessionDescription(answer));
    await flushFaceCamCandidates(key);
  });

  socket.on("facecam-ice-candidate", async ({ candidate, sender }) => {
    const key = faceCamKey(sender);
    const peer = faceCamPeers[key];
    if (!peer?.remoteDescription) {
      faceCamPendingCandidates[key] = faceCamPendingCandidates[key] || [];
      faceCamPendingCandidates[key].push(candidate);
      return;
    }
    await peer.addIceCandidate(new RTCIceCandidate(candidate));
  });

  setupControls();
})();
