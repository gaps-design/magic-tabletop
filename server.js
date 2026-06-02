const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static("public"));

const rooms = {};
const chatControl = {};
const clientProfiles = {};
const connectedUsers = {};
const onlineUsers = new Map();
const socketPresence = new Map();

const CHAT_LIMIT = 5;
const CHAT_BLOCK_MS = 3000;
const CARD_SCAN_MESSAGE_LIMIT = 650;
const CARD_SCAN_FIELD_LIMIT = 180;
const CARD_SCAN_ORACLE_LIMIT = 420;
const FLOATING_EMOJIS = new Set([
  "\u{1F525}",
  "\u{1F602}",
  "\u{1F631}",
  "\u{1F44F}",
  "\u{2764}\u{FE0F}",
  "\u{1F92B}",
  "\u{1F64F}",
  "\u{1F44D}",
  "\u{1F44E}",
  "\u{1F622}",
  "\u{1F634}",
  "\u{1F608}",
  "\u{1F928}",
  "\u{1F914}"
]);

function limitText(value, limit) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function sanitizeCardScan(card = {}) {
  const imageUrl = limitText(card.imageUrl, 500);

  return {
    id: limitText(card.id, 80),
    name: limitText(card.name, CARD_SCAN_FIELD_LIMIT),
    manaCost: limitText(card.manaCost, 80),
    typeLine: limitText(card.typeLine, CARD_SCAN_FIELD_LIMIT),
    oracleText: limitText(card.oracleText, CARD_SCAN_ORACLE_LIMIT),
    imageUrl: /^https:\/\/cards\.scryfall\.io\//.test(imageUrl) ? imageUrl : ""
  };
}

const MARKER_LABELS = {
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

const PLAYER_THEMES = new Set(["none", "living-end"]);
const ROOM_SKINS = new Set(["none", "leme-tempestade", "floresta", "pantano", "planice", "raios"]);

const PUBLIC_TABLES = [
  "mtg-1001", "mtg-1002", "mtg-1003", "mtg-1004", "mtg-1005",
  "mtg-1006", "mtg-1007", "mtg-1008", "mtg-1009", "mtg-1010", "mtg-1011"
];

function isResenhaRoom(roomId) {
  return roomId === "mtg-1002";
}

function normalizeUser(user = {}) {
  return {
    uid: user.uid || "",
    name: user.name || user.displayName || "Usuário",
    email: user.email || "",
    photo: user.photo || user.photoURL || "/assets/default-avatar.png"
  };
}

function sanitizeDecklistUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function getPresenceUserId(user = {}) {
  const profile = normalizeUser(user);
  return profile.uid || profile.email || "";
}

function normalizePresenceStatus(status = "idle", role = "idle") {
  if (status === "playing" || status === "player" || role === "player") return "playing";
  if (status === "spectating" || status === "spectator" || status === "queued" || role === "spectator" || role === "queued") {
    return "spectating";
  }

  return "idle";
}

function normalizePresenceRole(role = "idle", status = "idle") {
  if (role === "player" || status === "playing" || status === "player") return "player";
  if (role === "spectator" || role === "queued" || status === "spectating" || status === "spectator" || status === "queued") {
    return "spectator";
  }

  return "idle";
}

function presencePriority(user = {}) {
  if (user.status === "playing") return 3;
  if (user.status === "spectating") return 2;
  return 1;
}

function toLegacyPresenceUser(user = {}) {
  return {
    socketId: user.socketId,
    uid: user.uid || "",
    name: user.name || "Usuário",
    email: user.email || "",
    photo: user.photo || "/assets/default-avatar.png",
    status: user.status || "idle",
    roomId: user.room || null,
    role: user.role || "idle",
    playerNumber: user.playerNumber || null
  };
}

function rebuildUserPresence(userId) {
  if (!userId) return;

  const candidates = Array.from(socketPresence.values())
    .filter(user => user.id === userId);

  delete connectedUsers[userId];

  if (!candidates.length) {
    onlineUsers.delete(userId);
    return;
  }

  candidates.sort((a, b) => {
    const priorityDiff = presencePriority(b) - presencePriority(a);
    if (priorityDiff !== 0) return priorityDiff;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  const selected = candidates[0];
  onlineUsers.set(userId, selected);
  connectedUsers[userId] = toLegacyPresenceUser(selected);
}

function setUserPresence(userId, patch = {}) {
  if (!userId) return;

  const current = onlineUsers.get(userId) || {};
  const updated = {
    ...current,
    ...patch,
    id: userId,
    status: normalizePresenceStatus(patch.status || current.status, patch.role || current.role),
    role: normalizePresenceRole(patch.role || current.role, patch.status || current.status),
    updatedAt: Date.now()
  };

  onlineUsers.set(userId, updated);
  connectedUsers[userId] = toLegacyPresenceUser(updated);
  broadcastPresence();
}

function setSocketPresence(socketId, user = {}, patch = {}) {
  const profile = normalizeUser(user);
  const userId = getPresenceUserId(profile);
  if (!userId) return;

  const current = socketPresence.get(socketId) || {};
  const status = normalizePresenceStatus(patch.status || current.status, patch.role || current.role);
  const role = normalizePresenceRole(patch.role || current.role, patch.status || current.status);

  socketPresence.set(socketId, {
    ...current,
    ...patch,
    id: userId,
    uid: profile.uid || current.uid || "",
    name: profile.name || current.name || "Usuário",
    email: profile.email || current.email || "",
    photo: profile.photo || current.photo || "/assets/default-avatar.png",
    status,
    role,
    room: patch.room ?? patch.roomId ?? current.room ?? null,
    roomId: patch.room ?? patch.roomId ?? current.room ?? null,
    socketId,
    playerNumber: patch.playerNumber ?? current.playerNumber ?? null,
    updatedAt: Date.now()
  });

  rebuildUserPresence(userId);
  broadcastPresence();
}

function updateSocketPresence(socketId, patch = {}) {
  const current = socketPresence.get(socketId);
  if (!current?.id) return;

  socketPresence.set(socketId, {
    ...current,
    ...patch,
    status: normalizePresenceStatus(patch.status || current.status, patch.role || current.role),
    role: normalizePresenceRole(patch.role || current.role, patch.status || current.status),
    room: patch.room ?? patch.roomId ?? current.room ?? null,
    roomId: patch.room ?? patch.roomId ?? current.room ?? null,
    playerNumber: patch.playerNumber ?? current.playerNumber ?? null,
    updatedAt: Date.now()
  });

  rebuildUserPresence(current.id);
  broadcastPresence();
}

function removeSocketPresence(socketId) {
  const current = socketPresence.get(socketId);
  if (!current?.id) return;

  socketPresence.delete(socketId);
  rebuildUserPresence(current.id);
  broadcastPresence();
}

function isLoggedUser(user = {}) {
  return !!(user.uid || user.email);
}

function createDefaultTimer() {
  return {
    duration: 3000,
    remaining: 3000,
    running: false,
    interval: null
  };
}

function createCameraKey() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function normalizePlayerTheme(theme) {
  return PLAYER_THEMES.has(theme) ? theme : "none";
}

function normalizeRoomSkin(skinId) {
  return ROOM_SKINS.has(skinId) ? skinId : "none";
}

function createDefaultPlayerThemes() {
  return { 1: "none", 2: "none" };
}

function publicTimer(timer) {
  return {
    duration: timer.duration,
    remaining: timer.remaining,
    running: timer.running
  };
}

function ensureRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      players: [],
      spectators: [],
      cameraClients: [],
      queue: [],
      lifeHistory: [],
      format: isResenhaRoom(roomId) ? "Mesa da Resenha" : "",
      timer: createDefaultTimer(),
      diceRolls: [],
      micStatus: {},
      matchScore: { 1: 0, 2: 0 },
      faceCams: {},
      markerState: { 1: {}, 2: {} },
      cameraFraming: { 1: { zoom: 1, x: 0, y: 0 }, 2: { zoom: 1, x: 0, y: 0 } },
      playerThemes: createDefaultPlayerThemes(),
      overlays: [],
      currentScannerCard: null
    };
  }

  if (!rooms[roomId].playerThemes) {
    rooms[roomId].playerThemes = createDefaultPlayerThemes();
  }

  if (!rooms[roomId].cameraFraming) {
    rooms[roomId].cameraFraming = { 1: { zoom: 1, x: 0, y: 0 }, 2: { zoom: 1, x: 0, y: 0 } };
  }

  return rooms[roomId];
}

function setConnectedUser(socketId, user, status = "idle", roomId = null, role = "idle", playerNumber = null) {
  const profile = normalizeUser(user);

  if (!profile.uid && !profile.email) return;

  setSocketPresence(socketId, profile, {
    status,
    role,
    room: roomId,
    roomId,
    playerNumber
  });
}

function updateConnectedUser(socketId, data = {}) {
  updateSocketPresence(socketId, data);
}

function emitConvesState() {
  broadcastPresence();
}

function buildPresencePayload() {
  const presence = {
    proa: [],
    conves: [],
    calabouco: []
  };

  Array.from(onlineUsers.values()).forEach(user => {
    const publicUser = toLegacyPresenceUser(user);

    if (user.status === "spectating") {
      presence.proa.push(publicUser);
    } else if (user.status === "playing") {
      presence.conves.push(publicUser);
    } else {
      presence.calabouco.push(publicUser);
    }
  });

  return presence;
}

function broadcastPresence(target = io) {
  const presence = buildPresencePayload();
  const legacyUsers = [
    ...presence.proa,
    ...presence.conves,
    ...presence.calabouco
  ];

  target.emit("presence-update", presence);
  target.emit("conves-state", legacyUsers);
}

function buildLobbyState() {
  return PUBLIC_TABLES.map(roomId => {
    const room = rooms[roomId];
    const isResenha = isResenhaRoom(roomId);

    const players = room?.players?.length || 0;
    const spectators = room?.spectators?.length || 0;
    const cameras = room?.cameraClients?.length || 0;
    const queue = room?.queue?.length || 0;

    return {
      roomId,
      format: room?.format || (isResenha ? "Mesa da Resenha" : "Formato livre"),
      players,
      spectators,
      cameras,
      queue,
      isResenha,
      isFull: !isResenha && players >= 2,
      playerList: room?.players || [],
      spectatorList: room?.spectators?.map(id => clientProfiles[id]).filter(Boolean) || []
    };
  });
}

function broadcastLobbyState() {
  io.emit("lobby-state", buildLobbyState());
  emitConvesState();
}

function buildRoomUsers(room) {
  return {
    players: room.players.map(p => ({
      socketId: p.socketId,
      playerNumber: p.playerNumber,
      name: p.name,
      deck: p.deck,
      guild: p.guild,
      decklistUrl: p.decklistUrl || "",
      roomSkin: p.roomSkin || "none",
      photo: p.photo || "/assets/default-avatar.png"
    })),
    spectators: room.spectators.map(id => {
      const profile = clientProfiles[id] || {};
      return {
        socketId: id,
        name: profile.name || "Espectador",
        photo: profile.photo || "/assets/default-avatar.png"
      };
    }),
    cameras: room.cameraClients.map(c => ({
      socketId: c.socketId,
      linkedPlayer: c.linkedPlayer,
      name: c.name || "Câmera",
      photo: c.photo || "/assets/default-avatar.png"
    })),
    queue: (room.queue || []).map(item => ({
      socketId: item.socketId,
      name: item.name || "Jogador",
      photo: item.photo || "/assets/default-avatar.png",
      deck: item.deck || "---",
      guild: item.guild || "---",
      decklistUrl: item.decklistUrl || ""
    }))
  };
}

function sendRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("room-state", {
    players: room.players.map(p => ({
      socketId: p.socketId,
      playerNumber: p.playerNumber,
      name: p.name,
      deck: p.deck,
      guild: p.guild,
      decklistUrl: p.decklistUrl || "",
      roomSkin: p.roomSkin || "none",
      photo: p.photo || "/assets/default-avatar.png",
      life: p.life
    })),
    spectators: room.spectators.length,
    spectatorList: room.spectators.map(id => {
      const profile = clientProfiles[id] || {};
      return {
        socketId: id,
        name: profile.name || "Espectador",
        photo: profile.photo || "/assets/default-avatar.png",
        micAllowed: profile.micAllowed === true,
        micEnabled: profile.micEnabled === true
      };
    }),
    queueList: (room.queue || []).map(item => ({
      socketId: item.socketId,
      name: item.name || "Jogador",
      photo: item.photo || "/assets/default-avatar.png",
      deck: item.deck || "---",
      guild: item.guild || "---",
      decklistUrl: item.decklistUrl || ""
    })),
    cameraClients: room.cameraClients,
    lifeHistory: room.lifeHistory,
    timer: publicTimer(room.timer),
    format: room.format || "Formato livre",
    diceRolls: room.diceRolls,
    micStatus: room.micStatus,
    matchScore: room.matchScore || { 1: 0, 2: 0 },
    faceCams: Object.values(room.faceCams || {}),
    markerState: room.markerState || { 1: {}, 2: {} },
    cameraFraming: room.cameraFraming || { 1: { zoom: 1, x: 0, y: 0 }, 2: { zoom: 1, x: 0, y: 0 } },
    playerThemes: room.playerThemes || createDefaultPlayerThemes(),
    currentScannerCard: room.currentScannerCard || null,
    users: buildRoomUsers(room)
  });
}

function getClientInfo(socketId) {
  const profile = clientProfiles[socketId];
  if (!profile) return null;

  return {
    role: profile.role,
    playerNumber: profile.playerNumber || null,
    linkedPlayer: profile.linkedPlayer || null,
    name: profile.name || "Usuário",
    photo: profile.photo || "/assets/default-avatar.png",
    micAllowed: profile.micAllowed === true,
    micEnabled: profile.micEnabled === true
  };
}

function getPlayerBySocket(room, socketId) {
  return room.players.find(p => p.socketId === socketId);
}

function isPlayerInRoom(room, socketId) {
  return room.players.some(p => p.socketId === socketId);
}

function buildPeerList(room, excludeSocketId = null) {
  return [
    ...room.players
      .filter(p => p.socketId !== excludeSocketId)
      .map(p => ({
        socketId: p.socketId,
        role: "player",
        playerNumber: p.playerNumber,
        name: p.name,
        photo: p.photo
      })),
    ...room.cameraClients.map(c => ({
      socketId: c.socketId,
      role: "camera",
      linkedPlayer: c.linkedPlayer,
      name: c.name || "Câmera",
      photo: c.photo || "/assets/default-avatar.png"
    })),
    ...room.spectators
      .filter(id => id !== excludeSocketId)
      .map(id => ({
        socketId: id,
        role: "spectator",
        name: clientProfiles[id]?.name || "Espectador",
        photo: clientProfiles[id]?.photo || "/assets/default-avatar.png"
      })),
    ...(room.overlays || [])
      .filter(id => id !== excludeSocketId)
      .map(id => ({
        socketId: id,
        role: "overlay",
        name: "Overlay OBS",
        photo: "/assets/default-avatar.png"
      }))
  ];
}

function resetPublicRoomIfEmpty(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const empty =
    room.players.length === 0 &&
    room.spectators.length === 0 &&
    room.cameraClients.length === 0 &&
    (room.queue || []).length === 0;

  if (!empty) return;

  if (room.timer?.interval) {
    clearInterval(room.timer.interval);
  }

  if (PUBLIC_TABLES.includes(roomId)) {
    rooms[roomId] = {
      players: [],
      spectators: [],
      cameraClients: [],
      queue: [],
      lifeHistory: [],
      format: isResenhaRoom(roomId) ? "Mesa da Resenha" : "",
      timer: createDefaultTimer(),
      diceRolls: [],
      micStatus: {},
      matchScore: { 1: 0, 2: 0 },
      faceCams: {},
      markerState: { 1: {}, 2: {} },
      playerThemes: createDefaultPlayerThemes(),
      overlays: [],
      currentScannerCard: null
    };
  } else {
    delete rooms[roomId];
  }
}

function addSpectator(socket, roomId, user, reason = "") {
  const room = ensureRoom(roomId);
  const profile = normalizeUser(user);

  room.queue = (room.queue || []).filter(item => item.socketId !== socket.id);

  if (!room.spectators.includes(socket.id)) {
    room.spectators.push(socket.id);
  }

  clientProfiles[socket.id] = {
    role: "spectator",
    name: profile.name,
    email: profile.email,
    photo: profile.photo,
    micEnabled: true,
    micAllowed: true
  };

  room.micStatus[socket.id] = true;

  updateConnectedUser(socket.id, {
    status: "spectator",
    role: "spectator",
    roomId,
    playerNumber: null
  });

  socket.emit("assigned-role", {
    role: "spectator",
    reason
  });

  socket.emit("existing-peers", {
    peers: [
      ...room.players.map(p => ({
        socketId: p.socketId,
        role: "player",
        playerNumber: p.playerNumber,
        name: p.name,
        photo: p.photo
      })),
      ...room.cameraClients.map(c => ({
        socketId: c.socketId,
        role: "camera",
        linkedPlayer: c.linkedPlayer,
        name: c.name || "Câmera"
      }))
    ]
  });

  socket.to(roomId).emit("user-connected", {
    socketId: socket.id,
    role: "spectator",
    name: profile.name,
    photo: profile.photo
  });

  socket.to(roomId).emit("room-join-toast", {
    name: profile.name,
    role: "spectator",
    playerNumber: null
  });

  io.to(roomId).emit("system-event", {
    type: "spectator-joined",
    message: `👁️ ${profile.name} entrou como espectador.`,
    time: new Date().toLocaleTimeString("pt-BR")
  });

  sendRoomState(roomId);
  broadcastLobbyState();
}

function addToResenhaQueue(socket, roomId, data = {}, user = {}) {
  const room = ensureRoom(roomId);
  const profile = normalizeUser(user);

  room.spectators = room.spectators.filter(id => id !== socket.id);

  if (!room.queue.some(item => item.socketId === socket.id)) {
    room.queue.push({
      socketId: socket.id,
      name: data.name || profile.name || "Jogador",
      deck: data.deck || "---",
      guild: data.guild || "---",
      decklistUrl: data.decklistUrl || "",
      roomSkin: normalizeRoomSkin(data.roomSkin || "none"),
      photo: profile.photo || "/assets/default-avatar.png"
    });
  }

  clientProfiles[socket.id] = {
    role: "queued",
    name: data.name || profile.name || "Jogador",
    email: profile.email,
    photo: profile.photo || "/assets/default-avatar.png",
    deck: data.deck || "---",
    guild: data.guild || "---",
    decklistUrl: data.decklistUrl || "",
    micEnabled: false
  };

  updateConnectedUser(socket.id, {
    status: "queued",
    role: "queued",
    roomId,
    playerNumber: null
  });

  socket.emit("assigned-role", {
    role: "spectator",
    reason: "resenha-queue"
  });

  socket.emit("existing-peers", {
    peers: buildPeerList(room, socket.id)
  });

  socket.emit("resenha-queue-update", {
    position: room.queue.findIndex(item => item.socketId === socket.id) + 1,
    queue: room.queue
  });

  sendRoomState(roomId);
  broadcastLobbyState();
}

function promoteNextResenhaPlayer(roomId) {
  const room = rooms[roomId];
  if (!room || !isResenhaRoom(roomId)) return;

  while (room.players.length < 2 && room.queue?.length) {
    const next = room.queue.shift();
    const nextSocket = io.sockets.sockets.get(next.socketId);

    if (!nextSocket) continue;

    room.spectators = room.spectators.filter(id => id !== next.socketId);

    const usedNumbers = room.players.map(p => Number(p.playerNumber));
    let playerNumber = 1;
    while (usedNumbers.includes(playerNumber)) playerNumber++;

    const player = {
      socketId: next.socketId,
      playerNumber,
      name: next.name,
      deck: next.deck,
      guild: next.guild,
      decklistUrl: next.decklistUrl || "",
      roomSkin: normalizeRoomSkin(next.roomSkin || "none"),
      photo: next.photo || "/assets/default-avatar.png",
      cameraKey: createCameraKey(),
      life: 20
    };

    room.players.push(player);
    room.micStatus[next.socketId] = true;

    clientProfiles[next.socketId] = {
      ...(clientProfiles[next.socketId] || {}),
      role: "player",
      playerNumber,
      name: next.name,
      photo: next.photo || "/assets/default-avatar.png",
      decklistUrl: next.decklistUrl || "",
      micEnabled: true
    };

    updateConnectedUser(next.socketId, {
      status: "player",
      role: "player",
      roomId,
      playerNumber
    });

    nextSocket.emit("assigned-role", {
      role: "player",
      playerNumber,
      cameraKey: player.cameraKey,
      reason: "resenha-promoted"
    });

    nextSocket.emit("existing-peers", {
      peers: buildPeerList(room, next.socketId)
    });

    nextSocket.to(roomId).emit("user-connected", {
      socketId: next.socketId,
      role: "player",
      playerNumber,
      name: next.name,
      photo: next.photo || "/assets/default-avatar.png"
    });

    nextSocket.to(roomId).emit("room-join-toast", {
      name: next.name,
      role: "player",
      playerNumber
    });
  }
}

function removeLinkedCamerasForPlayer(room, roomId, playerNumber) {
  const removedLinkedCameras = room.cameraClients
    .filter(c => Number(c.linkedPlayer) === Number(playerNumber))
    .map(c => c.socketId);

  room.cameraClients = room.cameraClients.filter(c => Number(c.linkedPlayer) !== Number(playerNumber));

  removedLinkedCameras.forEach(cameraSocketId => {
    const cameraSocket = io.sockets.sockets.get(cameraSocketId);
    if (cameraSocket) {
      cameraSocket.leave(roomId);
      cameraSocket.emit("camera-error", "Jogador saiu do slot ativo da mesa.");
    }

    delete room.micStatus[cameraSocketId];
    delete clientProfiles[cameraSocketId];
    io.to(roomId).emit("user-disconnected", cameraSocketId);
  });
}

function moveActiveResenhaPlayerToQueue(socket, roomId) {
  const room = rooms[roomId];
  if (!room || !isResenhaRoom(roomId)) return false;

  const player = getPlayerBySocket(room, socket.id);
  if (!player) return false;

  room.players = room.players.filter(p => p.socketId !== socket.id);
  if (room.playerThemes) {
    room.playerThemes[player.playerNumber] = "none";
  }
  removeLinkedCamerasForPlayer(room, roomId, player.playerNumber);

  if (!room.queue.some(item => item.socketId === socket.id)) {
    room.queue.push({
      socketId: socket.id,
      name: player.name || "Jogador",
      deck: player.deck || "---",
      guild: player.guild || "---",
      decklistUrl: player.decklistUrl || "",
      roomSkin: normalizeRoomSkin(player.roomSkin || "none"),
      photo: player.photo || "/assets/default-avatar.png"
    });
  }

  delete room.micStatus[socket.id];
  io.to(roomId).emit("user-disconnected", socket.id);

  clientProfiles[socket.id] = {
    ...(clientProfiles[socket.id] || {}),
    role: "queued",
    playerNumber: null,
    name: player.name || "Jogador",
    photo: player.photo || "/assets/default-avatar.png",
    deck: player.deck || "---",
    guild: player.guild || "---",
    decklistUrl: player.decklistUrl || "",
    micEnabled: false
  };

  updateConnectedUser(socket.id, {
    status: "queued",
    role: "queued",
    roomId,
    playerNumber: null
  });

  socket.emit("assigned-role", {
    role: "spectator",
    reason: "resenha-queue"
  });

  promoteNextResenhaPlayer(roomId);
  sendRoomState(roomId);
  broadcastLobbyState();
  return true;
}

function moveResenhaUserToSpectator(socket, roomId) {
  const room = rooms[roomId];
  if (!room || !isResenhaRoom(roomId)) return false;

  const player = getPlayerBySocket(room, socket.id);

  if (player) {
    room.players = room.players.filter(p => p.socketId !== socket.id);
    if (room.playerThemes) {
      room.playerThemes[player.playerNumber] = "none";
    }
    removeLinkedCamerasForPlayer(room, roomId, player.playerNumber);
    delete room.micStatus[socket.id];
    io.to(roomId).emit("user-disconnected", socket.id);
  }

  room.queue = (room.queue || []).filter(item => item.socketId !== socket.id);
  addSpectator(socket, roomId, clientProfiles[socket.id] || {}, "resenha-spectator");
  promoteNextResenhaPlayer(roomId);
  sendRoomState(roomId);
  broadcastLobbyState();
  return true;
}

function removeSocketFromAllRooms(socketId) {
  let changedLobby = false;

  for (const roomId in rooms) {
    const room = rooms[roomId];

    const wasInside =
      room.players.some(p => p.socketId === socketId) ||
      room.spectators.includes(socketId) ||
      room.cameraClients.some(c => c.socketId === socketId) ||
      room.overlays?.includes(socketId) ||
      room.queue?.some(item => item.socketId === socketId);

    if (!wasInside) continue;

    const removedPlayerNumbers = room.players
      .filter(p => p.socketId === socketId)
      .map(p => Number(p.playerNumber));
    const removedFaceCam = room.faceCams?.[socketId];
    const removedLinkedCameras = room.cameraClients
      .filter(c => removedPlayerNumbers.includes(Number(c.linkedPlayer)))
      .map(c => c.socketId);

    room.players = room.players.filter(p => p.socketId !== socketId);
    room.spectators = room.spectators.filter(id => id !== socketId);
    room.overlays = (room.overlays || []).filter(id => id !== socketId);
    room.cameraClients = room.cameraClients.filter(c =>
      c.socketId !== socketId &&
      !removedPlayerNumbers.includes(Number(c.linkedPlayer))
    );
    room.queue = (room.queue || []).filter(item => item.socketId !== socketId);
    room.diceRolls = room.diceRolls.filter(r => r.socketId !== socketId);
    removedPlayerNumbers.forEach(playerNumber => {
      if (room.playerThemes) {
        room.playerThemes[playerNumber] = "none";
      }
    });

    delete room.micStatus[socketId];
    if (room.faceCams?.[socketId]) {
      delete room.faceCams[socketId];
    }

    if (removedFaceCam) {
      io.to(roomId).emit("facecam-stopped", {
        socketId,
        playerNumber: removedFaceCam.playerNumber
      });
    }
    removedLinkedCameras.forEach(cameraSocketId => {
      const cameraSocket = io.sockets.sockets.get(cameraSocketId);
      if (cameraSocket) {
        cameraSocket.leave(roomId);
        cameraSocket.emit("camera-error", "Jogador vinculado saiu da mesa.");
      }

      delete room.micStatus[cameraSocketId];
      delete clientProfiles[cameraSocketId];
      io.to(roomId).emit("user-disconnected", cameraSocketId);
    });

    io.to(roomId).emit("user-disconnected", socketId);

    sendRoomState(roomId);
    changedLobby = true;

    promoteNextResenhaPlayer(roomId);
    sendRoomState(roomId);

    resetPublicRoomIfEmpty(roomId);
  }

  delete chatControl[socketId];
  delete clientProfiles[socketId];

  if (changedLobby) {
    broadcastLobbyState();
  }
}

function moveSocketPresenceToLobby(socketId) {
  updateConnectedUser(socketId, {
    status: "idle",
    role: "idle",
    room: null,
    roomId: null,
    playerNumber: null
  });
}

io.on("connection", (socket) => {
  console.log("Conectado:", socket.id);

  socket.emit("lobby-state", buildLobbyState());
  broadcastPresence(socket);

  socket.on("user-online", (user = {}) => {
    const profile = normalizeUser(user);
    setConnectedUser(socket.id, profile, "idle", null, "idle", null);
    broadcastLobbyState();
  });

  socket.on("user-logout", () => {
    removeSocketFromAllRooms(socket.id);
    removeSocketPresence(socket.id);

    broadcastLobbyState();
  });

  socket.on("join-room", (data = {}) => {
    const roomId = data.roomId;
    if (!roomId) return;

    const role = data.role || "player";
    const isCamera = role === "camera";
    const user = normalizeUser(data.user || {});

    if (!isCamera && !isLoggedUser(user)) {
      socket.emit("auth-required", {
        message: "Você precisa entrar com Google para acessar a sala."
      });
      return;
    }

    removeSocketFromAllRooms(socket.id);

    const name = data.name || user.name || "Usuário";
    const deck = data.deck || "---";
    const guild = data.guild || "---";
    const decklistUrl = sanitizeDecklistUrl(data.decklistUrl);
    const linkedPlayer = Number(data.linkedPlayer || data.cameraFor || 0);
    const cameraKey = String(data.cameraKey || "");
    const incomingFormat = data.format || "";

    if (!isCamera) {
      setConnectedUser(socket.id, user, role, roomId, role, null);
    }

    const room = ensureRoom(roomId);

    if (isResenhaRoom(roomId)) {
      room.format = "Mesa da Resenha";
    } else if (!room.format && incomingFormat && room.players.length === 0) {
      room.format = incomingFormat;
    }

    socket.join(roomId);

    if (role === "spectator") {
      addSpectator(socket, roomId, user, "spectator-choice");
      return;
    }

    if (role === "camera") {
      if (![1, 2].includes(linkedPlayer)) {
        socket.emit("camera-error", "Jogador inválido.");
        return;
      }

      const linkedPlayerData = room.players.find(p => Number(p.playerNumber) === linkedPlayer);
      if (!linkedPlayerData || linkedPlayerData.cameraKey !== cameraKey) {
        socket.emit("camera-error", "Link de câmera inválido ou expirado.");
        return;
      }

      const oldCameras = room.cameraClients.filter(c => Number(c.linkedPlayer) === linkedPlayer);

      oldCameras.forEach(oldCamera => {
        const oldSocket = io.sockets.sockets.get(oldCamera.socketId);

        if (oldSocket) {
          oldSocket.leave(roomId);
          oldSocket.emit("camera-replaced");
        }

        delete clientProfiles[oldCamera.socketId];
        delete room.micStatus[oldCamera.socketId];

        io.to(roomId).emit("user-disconnected", oldCamera.socketId);
      });

      room.cameraClients = room.cameraClients.filter(c => Number(c.linkedPlayer) !== linkedPlayer);

      room.cameraClients.push({
        socketId: socket.id,
        linkedPlayer,
        name: `Câmera Jogador ${linkedPlayer}`,
        photo: "/assets/default-avatar.png"
      });

      clientProfiles[socket.id] = {
        role: "camera",
        linkedPlayer,
        name: `Câmera Jogador ${linkedPlayer}`,
        photo: "/assets/default-avatar.png",
        micEnabled: false
      };

      room.micStatus[socket.id] = false;

      socket.emit("assigned-role", {
        role: "camera",
        linkedPlayer
      });

      socket.emit("existing-peers", {
        peers: [
          ...room.players.map(p => ({
            socketId: p.socketId,
            role: "player",
            playerNumber: p.playerNumber,
            name: p.name,
            photo: p.photo
          })),
          ...room.spectators.map(id => ({
            socketId: id,
            role: "spectator",
            name: clientProfiles[id]?.name || "Espectador",
            photo: clientProfiles[id]?.photo || "/assets/default-avatar.png"
          }))
        ]
      });

      socket.to(roomId).emit("user-connected", {
        socketId: socket.id,
        role: "camera",
        linkedPlayer,
        name: `Câmera Jogador ${linkedPlayer}`
      });

      sendRoomState(roomId);
      broadcastLobbyState();
      return;
    }

    if (isResenhaRoom(roomId) && room.players.length >= 2) {
      addToResenhaQueue(socket, roomId, { name, deck, guild, decklistUrl }, user);
      return;
    }

    if (!isResenhaRoom(roomId) && room.players.length >= 2) {
      addSpectator(socket, roomId, user, "room-full");
      return;
    }

    const usedNumbers = room.players.map(p => Number(p.playerNumber));
    let playerNumber = 1;

    while (usedNumbers.includes(playerNumber)) {
      playerNumber++;
    }

    const player = {
      socketId: socket.id,
      uid: user.uid,
      playerNumber,
      name,
      email: user.email,
      photo: user.photo,
      deck,
      guild,
      decklistUrl,
      roomSkin: normalizeRoomSkin(data.roomSkin || "none"),
      cameraKey: createCameraKey(),
      life: 20
    };

    room.players.push(player);

    clientProfiles[socket.id] = {
      role: "player",
      playerNumber,
      name,
      email: user.email,
      photo: user.photo,
      decklistUrl,
      micEnabled: true
    };

    updateConnectedUser(socket.id, {
      status: "player",
      role: "player",
      roomId,
      playerNumber
    });

    room.micStatus[socket.id] = true;

    socket.emit("assigned-role", {
      role: "player",
      playerNumber,
      cameraKey: player.cameraKey
    });

    socket.emit("existing-peers", {
      peers: [
        ...room.players
          .filter(p => p.socketId !== socket.id)
          .map(p => ({
            socketId: p.socketId,
            role: "player",
            playerNumber: p.playerNumber,
            name: p.name,
            photo: p.photo
          })),
        ...room.cameraClients.map(c => ({
          socketId: c.socketId,
          role: "camera",
          linkedPlayer: c.linkedPlayer,
          name: c.name || "Câmera"
        })),
        ...room.spectators.map(id => ({
          socketId: id,
          role: "spectator",
          name: clientProfiles[id]?.name || "Espectador",
          photo: clientProfiles[id]?.photo || "/assets/default-avatar.png"
        }))
      ]
    });

    socket.to(roomId).emit("user-connected", {
      socketId: socket.id,
      role: "player",
      playerNumber,
      name,
      photo: user.photo
    });

    socket.to(roomId).emit("room-join-toast", {
      name,
      role: "player",
      playerNumber
    });

    sendRoomState(roomId);
    broadcastLobbyState();
  });


  socket.on("join-overlay", ({ roomId } = {}) => {
    if (!roomId || typeof roomId !== "string" || roomId.length > 80) return;

    removeSocketFromAllRooms(socket.id);

    const room = rooms[roomId] || ensureRoom(roomId);
    room.overlays = room.overlays || [];

    if (!room.overlays.includes(socket.id)) {
      room.overlays.push(socket.id);
    }

    socket.join(roomId);

    clientProfiles[socket.id] = {
      role: "overlay",
      name: "Overlay OBS",
      photo: "/assets/default-avatar.png",
      micEnabled: false
    };

    socket.emit("assigned-role", {
      role: "overlay"
    });

    socket.emit("existing-peers", {
      peers: [
        ...room.players.map(p => ({
          socketId: p.socketId,
          role: "player",
          playerNumber: p.playerNumber,
          name: p.name,
          photo: p.photo
        })),
        ...room.cameraClients.map(c => ({
          socketId: c.socketId,
          role: "camera",
          linkedPlayer: c.linkedPlayer,
          name: c.name || "Camera"
        }))
      ]
    });

    socket.emit("facecam-list", {
      faceCams: Object.values(room.faceCams || {})
    });

    if (room.currentScannerCard) {
      socket.emit("card-scan-shown", room.currentScannerCard);
    }

    socket.to(roomId).emit("user-connected", {
      socketId: socket.id,
      role: "overlay",
      name: "Overlay OBS"
    });

    sendRoomState(roomId);
  });

  socket.on("roll-dice", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return;

    const alreadyRolled = room.diceRolls.some(r => r.socketId === socket.id);
    if (alreadyRolled) return;

    const dice1 = Math.floor(Math.random() * 6) + 1;
    const dice2 = Math.floor(Math.random() * 6) + 1;
    const total = dice1 + dice2;

    const roll = {
      socketId: socket.id,
      playerNumber: player.playerNumber,
      playerName: player.name,
      dice1,
      dice2,
      total,
      time: new Date().toLocaleTimeString("pt-BR")
    };

    room.diceRolls.push(roll);
    io.to(roomId).emit("dice-rolled", roll);

    const activePlayers = Math.min(room.players.length, 2);

    if (room.diceRolls.length >= activePlayers) {
      const sorted = [...room.diceRolls].sort((a, b) => b.total - a.total);
      const top = sorted[0];
      const second = sorted[1];

      if (second && top.total === second.total) {
        io.to(roomId).emit("dice-draw", {
          message: "Empate nos dados! Lancem novamente."
        });

        room.diceRolls = [];
        sendRoomState(roomId);
        return;
      }

      io.to(roomId).emit("dice-winner", {
        playerNumber: top.playerNumber,
        playerName: top.playerName,
        total: top.total,
        message: `Jogador ${top.playerNumber} escolhe se quer começar.`
      });
    }

    sendRoomState(roomId);
  });

  socket.on("reset-dice", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!isPlayerInRoom(room, socket.id)) return;

    room.diceRolls = [];
    io.to(roomId).emit("dice-reset");
    sendRoomState(roomId);
  });

  socket.on("update-mic-status", ({ roomId, micEnabled }) => {
    const room = rooms[roomId];
    if (!room) return;

    const profile = clientProfiles[socket.id];
    if (!profile) return;

    profile.micEnabled = !!micEnabled;
    room.micStatus[socket.id] = !!micEnabled;
    if (profile.role === "spectator") {
      console.log("[AUDIO][SPECTATOR] mic status updated", {
        roomId,
        spectatorSocketId: socket.id,
        micEnabled: !!micEnabled
      });
    }

    io.to(roomId).emit("mic-status-update", {
      socketId: socket.id,
      micEnabled: !!micEnabled,
      info: getClientInfo(socket.id)
    });

    sendRoomState(roomId);
  });

  socket.on("player-theme-update", ({ roomId, playerNumber, theme }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return;
    if (Number(player.playerNumber) !== Number(playerNumber)) return;

    const normalizedTheme = normalizePlayerTheme(theme);
    room.playerThemes = room.playerThemes || createDefaultPlayerThemes();
    room.playerThemes[player.playerNumber] = normalizedTheme;

    io.to(roomId).emit("player-themes-update", {
      playerThemes: room.playerThemes
    });

    sendRoomState(roomId);
  });

  socket.on("player-room-skin-change", ({ roomId, playerSlot, skinId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return;
    if (Number(player.playerNumber) !== Number(playerSlot)) return;

    const normalizedSkin = normalizeRoomSkin(skinId);
    player.roomSkin = normalizedSkin;

    io.to(roomId).emit("player-room-skin-update", {
      roomId,
      playerSlot: player.playerNumber,
      skinId: normalizedSkin
    });

    sendRoomState(roomId);
  });

  socket.on("camera-framing-update", ({ roomId, playerNumber, settings }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return;
    if (Number(player.playerNumber) !== Number(playerNumber)) return;

    const normalizedPlayerNumber = Number(playerNumber);
    const normalizedSettings = {
      zoom: Math.min(2.5, Math.max(1, Number(settings?.zoom) || 1)),
      x: Math.min(200, Math.max(-200, Number(settings?.x) || 0)),
      y: Math.min(200, Math.max(-200, Number(settings?.y) || 0))
    };

    room.cameraFraming = room.cameraFraming || { 1: { zoom: 1, x: 0, y: 0 }, 2: { zoom: 1, x: 0, y: 0 } };
    room.cameraFraming[normalizedPlayerNumber] = normalizedSettings;

    socket.to(roomId).emit("camera-framing-update", {
      playerNumber: normalizedPlayerNumber,
      settings: normalizedSettings
    });

    console.log("[CAMERA-FRAMING] updated", {
      roomId,
      playerNumber: normalizedPlayerNumber,
      settings: normalizedSettings
    });
  });

  socket.on("resenha-yield-seat", ({ roomId }) => {
    moveActiveResenhaPlayerToQueue(socket, roomId);
  });

  socket.on("resenha-become-spectator", ({ roomId }) => {
    moveResenhaUserToSpectator(socket, roomId);
  });

  socket.on("resenha-become-player", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !isResenhaRoom(roomId)) return;
    if (room.players.some(p => p.socketId === socket.id)) return;

    const profile = clientProfiles[socket.id] || {};
    room.spectators = room.spectators.filter(id => id !== socket.id);

    addToResenhaQueue(
      socket,
      roomId,
      {
        name: profile.name || "Jogador",
        deck: profile.deck || "---",
        guild: profile.guild || "---"
      },
      profile
    );

    promoteNextResenhaPlayer(roomId);
    sendRoomState(roomId);
    broadcastLobbyState();
  });

  socket.on("spectator-mic-request", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.spectators.includes(socket.id)) return;

    const profile = clientProfiles[socket.id] || {};
    profile.micAllowed = true;
    console.log("[AUDIO][SPECTATOR] legacy mic request accepted automatically", {
      roomId,
      spectatorSocketId: socket.id,
      name: profile.name || "Espectador"
    });

    socket.emit("spectator-mic-status", {
      status: "allowed"
    });
  });

  socket.on("spectator-mic-response", ({ roomId, spectatorSocketId, allow }) => {
    const room = rooms[roomId];
    if (!room || !isPlayerInRoom(room, socket.id)) return;
    if (!room.spectators.includes(spectatorSocketId)) return;

    const profile = clientProfiles[spectatorSocketId];
    if (!profile) return;

    profile.micAllowed = true;
    profile.micEnabled = false;
    room.micStatus[spectatorSocketId] = false;
    console.log("[AUDIO][SPECTATOR] legacy mic response", {
      roomId,
      spectatorSocketId,
      allow: !!allow
    });

    io.to(spectatorSocketId).emit("spectator-mic-status", {
      status: allow ? "allowed" : "denied"
    });

    sendRoomState(roomId);
  });

  socket.on("spectator-mic-permission", ({ roomId, spectatorSocketId, allow }) => {
    const room = rooms[roomId];
    if (!room || !isPlayerInRoom(room, socket.id)) return;
    if (!room.spectators.includes(spectatorSocketId)) return;

    const profile = clientProfiles[spectatorSocketId];
    if (!profile) return;

    profile.micAllowed = true;
    profile.micEnabled = false;
    room.micStatus[spectatorSocketId] = false;
    console.log("[AUDIO][SPECTATOR] legacy mic permission command", {
      roomId,
      spectatorSocketId,
      allow: !!allow
    });

    io.to(spectatorSocketId).emit("spectator-mic-status", {
      status: allow ? "allowed" : "muted"
    });

    io.to(roomId).emit("mic-status-update", {
      socketId: spectatorSocketId,
      micEnabled: false,
      info: getClientInfo(spectatorSocketId)
    });

    sendRoomState(roomId);
  });

  socket.on("spectator-mic-mute", ({ roomId, spectatorSocketId }) => {
    const room = rooms[roomId];
    if (!room || !isPlayerInRoom(room, socket.id)) return;
    if (!room.spectators.includes(spectatorSocketId)) return;

    const profile = clientProfiles[spectatorSocketId];
    if (!profile) return;

    profile.micAllowed = true;
    profile.micEnabled = false;
    room.micStatus[spectatorSocketId] = false;
    console.log("[AUDIO][SPECTATOR] non-blocking spectator mute command", {
      roomId,
      spectatorSocketId,
      mutedBy: socket.id
    });

    io.to(spectatorSocketId).emit("spectator-mic-status", {
      status: "muted"
    });

    io.to(roomId).emit("mic-status-update", {
      socketId: spectatorSocketId,
      micEnabled: false,
      info: getClientInfo(spectatorSocketId)
    });

    sendRoomState(roomId);
  });

  socket.on("marker-update", ({ roomId, playerNumber, markerId, marker, action, amount }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!isPlayerInRoom(room, socket.id)) return;
    if (![1, 2].includes(Number(playerNumber))) return;
    if (!MARKER_LABELS[markerId]) return;

    const player = getPlayerBySocket(room, socket.id);
    if (!player || Number(player.playerNumber) !== Number(playerNumber)) return;

    if (!room.markerState) {
      room.markerState = { 1: {}, 2: {} };
    }

    const playerKey = String(Number(playerNumber));
    room.markerState[playerKey] = room.markerState[playerKey] || {};

    if (action === "remove") {
      delete room.markerState[playerKey][markerId];
    } else if (marker && typeof marker === "object") {
      room.markerState[playerKey][markerId] = {
        value: Math.max(0, Number(marker.value) || 0)
      };
    }

    const playerName = player?.name || `Jogador ${playerNumber}`;
    const markerName = MARKER_LABELS[markerId];
    let eventText = "";

    if (action === "add") {
      eventText = `${playerName} ativou ${markerName}`;
    } else if (action === "remove") {
      eventText = `${playerName} removeu marcador ${markerName}`;
    } else if (Number(amount) > 0) {
      eventText = `${playerName} adicionou ${markerName} +${Number(amount)}`;
    } else if (Number(amount) < 0) {
      eventText = `${playerName} removeu ${markerName} ${Number(amount)}`;
    }

    if (eventText) {
      io.to(roomId).emit("system-event", {
        type: "marker-event",
        message: eventText,
        time: new Date().toLocaleTimeString("pt-BR")
      });
    }

    sendRoomState(roomId);
  });

  socket.on("match-score-update", ({ roomId, playerNumber, score }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!isPlayerInRoom(room, socket.id)) return;

    const player = getPlayerBySocket(room, socket.id);
    const normalizedPlayerNumber = Number(playerNumber);
    const normalizedScore = Math.max(0, Math.min(3, Number(score) || 0));

    if (!player || Number(player.playerNumber) !== normalizedPlayerNumber) return;
    if (![1, 2].includes(normalizedPlayerNumber)) return;

    room.matchScore = room.matchScore || { 1: 0, 2: 0 };
    room.matchScore[String(normalizedPlayerNumber)] = normalizedScore;

    sendRoomState(roomId);
  });

  socket.on("facecam-started", ({ roomId, playerNumber }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return;

    const normalizedPlayerNumber = Number(playerNumber || player.playerNumber);
    if (Number(player.playerNumber) !== normalizedPlayerNumber) return;

    room.faceCams = room.faceCams || {};
    room.faceCams[socket.id] = {
      socketId: socket.id,
      playerNumber: normalizedPlayerNumber,
      name: player.name || `Jogador ${normalizedPlayerNumber}`,
      photo: player.photo || "/assets/default-avatar.png",
      mediaType: "facecam"
    };

    socket.to(roomId).emit("facecam-started", room.faceCams[socket.id]);
    socket.emit("facecam-list", {
      faceCams: Object.values(room.faceCams)
    });
    sendRoomState(roomId);
  });

  socket.on("facecam-stopped", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room?.faceCams?.[socket.id]) return;

    const stopped = room.faceCams[socket.id];
    delete room.faceCams[socket.id];

    io.to(roomId).emit("facecam-stopped", {
      socketId: socket.id,
      playerNumber: stopped.playerNumber
    });
    sendRoomState(roomId);
  });

  socket.on("facecam-offer", ({ target, offer }) => {
    if (!target || !offer) return;

    io.to(target).emit("facecam-offer", {
      offer,
      sender: socket.id,
      senderInfo: getClientInfo(socket.id)
    });
  });

  socket.on("facecam-answer", ({ target, answer }) => {
    if (!target || !answer) return;

    io.to(target).emit("facecam-answer", {
      answer,
      sender: socket.id,
      senderInfo: getClientInfo(socket.id)
    });
  });

  socket.on("facecam-ice-candidate", ({ target, candidate, side }) => {
    if (!target || !candidate) return;

    io.to(target).emit("facecam-ice-candidate", {
      candidate,
      sender: socket.id,
      side
    });
  });

  socket.on("offer", ({ target, offer }) => {
    if (!target || !offer) return;

    io.to(target).emit("offer", {
      offer,
      sender: socket.id,
      senderInfo: getClientInfo(socket.id)
    });
  });

  socket.on("answer", ({ target, answer }) => {
    if (!target || !answer) return;

    io.to(target).emit("answer", {
      answer,
      sender: socket.id
    });
  });

  socket.on("ice-candidate", ({ target, candidate }) => {
    if (!target || !candidate) return;

    io.to(target).emit("ice-candidate", {
      candidate,
      sender: socket.id
    });
  });

  socket.on("chat-message", ({ roomId, message, type }) => {
    const room = rooms[roomId];
    if (!room) return;

    const inside =
      room.players.some(p => p.socketId === socket.id) ||
      room.spectators.includes(socket.id);

    if (!inside) return;

    const now = Date.now();

    if (!chatControl[socket.id]) {
      chatControl[socket.id] = {
        count: 0,
        blockedUntil: 0
      };
    }

    const control = chatControl[socket.id];

    if (control.blockedUntil && now < control.blockedUntil) {
      socket.emit("chat-cooldown", {
        remaining: Math.ceil((control.blockedUntil - now) / 1000)
      });
      return;
    }

    const safeMessage = String(message || "").trim().slice(0, 120);
    if (!safeMessage) return;

    control.count++;

    if (type === "emoji") {
      if (!FLOATING_EMOJIS.has(safeMessage)) return;

      io.to(roomId).emit("floating-emoji", {
        name: clientProfiles[socket.id]?.name || "Usuário",
        message: safeMessage,
        time: new Date().toLocaleTimeString("pt-BR")
      });
    } else {
      io.to(roomId).emit("chat-message", {
        name: clientProfiles[socket.id]?.name || "Usuário",
        message: safeMessage,
        type: "text",
        time: new Date().toLocaleTimeString("pt-BR")
      });
    }

    if (control.count >= CHAT_LIMIT) {
      control.count = 0;
      control.blockedUntil = now + CHAT_BLOCK_MS;
    }
  });

  socket.on("card-scan-confirmed", ({ roomId, card }) => {
    const room = rooms[roomId];
    if (!room) return;

    const inside =
      room.players.some(p => p.socketId === socket.id) ||
      room.spectators.includes(socket.id);

    if (!inside) return;

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    const now = Date.now();

    if (!chatControl[socket.id]) {
      chatControl[socket.id] = {
        count: 0,
        blockedUntil: 0
      };
    }

    const control = chatControl[socket.id];

    if (control.blockedUntil && now < control.blockedUntil) {
      socket.emit("chat-cooldown", {
        remaining: Math.ceil((control.blockedUntil - now) / 1000)
      });
      return;
    }

    const safeCard = sanitizeCardScan(card);
    if (!safeCard.name) return;

    const playerName = limitText(clientProfiles[socket.id]?.name || player.name || "Jogador", 80);
    const oracleSummary = limitText(safeCard.oracleText, 360);
    const message = limitText(
      `${playerName} escaneou: ${safeCard.name} — ${safeCard.typeLine || "Carta"}. ${oracleSummary}`,
      CARD_SCAN_MESSAGE_LIMIT
    );

    room.currentScannerCard = {
      playerName,
      card: safeCard,
      time: new Date().toLocaleTimeString("pt-BR")
    };

    io.to(roomId).emit("card-scan-shown", room.currentScannerCard);

    io.to(roomId).emit("chat-message", {
      name: "Oráculo ON",
      message,
      type: "card-scan",
      time: new Date().toLocaleTimeString("pt-BR")
    });

    io.to(roomId).emit("system-event", {
      message: `${playerName} escaneou a carta ${safeCard.name}`,
      time: new Date().toLocaleTimeString("pt-BR")
    });

    control.count++;

    if (control.count >= CHAT_LIMIT) {
      control.count = 0;
      control.blockedUntil = now + CHAT_BLOCK_MS;
    }
  });

  socket.on("change-life", ({ roomId, playerNumber, amount }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return;

    if (player.playerNumber !== Number(playerNumber)) return;

    const change = Number(amount);
    if (isNaN(change)) return;

    const oldLife = player.life;
    player.life += change;

    room.lifeHistory.unshift({
      playerNumber: player.playerNumber,
      playerName: player.name,
      oldLife,
      newLife: player.life,
      change,
      time: new Date().toLocaleTimeString("pt-BR")
    });

    sendRoomState(roomId);
    broadcastLobbyState();
  });

  socket.on("set-life", ({ roomId, playerNumber, value }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return;

    if (player.playerNumber !== Number(playerNumber)) return;

    const newLife = Number(value);
    if (isNaN(newLife)) return;

    const oldLife = player.life;
    player.life = newLife;

    room.lifeHistory.unshift({
      playerNumber: player.playerNumber,
      playerName: player.name,
      oldLife,
      newLife,
      change: "manual",
      time: new Date().toLocaleTimeString("pt-BR")
    });

    sendRoomState(roomId);
    broadcastLobbyState();
  });

  socket.on("reset-life", ({ roomId, playerNumber }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return;

    if (player.playerNumber !== Number(playerNumber)) return;

    const oldLife = player.life;
    player.life = 20;

    room.lifeHistory.unshift({
      playerNumber: player.playerNumber,
      playerName: player.name,
      oldLife,
      newLife: 20,
      change: "reset",
      time: new Date().toLocaleTimeString("pt-BR")
    });

    sendRoomState(roomId);
    broadcastLobbyState();
  });

  socket.on("set-timer", ({ roomId, minutes }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!isPlayerInRoom(room, socket.id)) return;

    const seconds = Number(minutes) * 60;
    if (isNaN(seconds) || seconds <= 0) return;

    room.timer.duration = seconds;
    room.timer.remaining = seconds;
    room.timer.running = false;

    if (room.timer.interval) {
      clearInterval(room.timer.interval);
      room.timer.interval = null;
    }

    io.to(roomId).emit("timer-update", publicTimer(room.timer));
    sendRoomState(roomId);
  });

  socket.on("start-timer", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!isPlayerInRoom(room, socket.id)) return;
    if (room.timer.running) return;

    room.timer.running = true;

    room.timer.interval = setInterval(() => {
      if (room.timer.remaining > 0) {
        room.timer.remaining--;
      } else {
        room.timer.running = false;
        clearInterval(room.timer.interval);
        room.timer.interval = null;
      }

      io.to(roomId).emit("timer-update", publicTimer(room.timer));
    }, 1000);
  });

  socket.on("pause-timer", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!isPlayerInRoom(room, socket.id)) return;

    room.timer.running = false;

    if (room.timer.interval) {
      clearInterval(room.timer.interval);
      room.timer.interval = null;
    }

    io.to(roomId).emit("timer-update", publicTimer(room.timer));
  });

  socket.on("reset-timer", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!isPlayerInRoom(room, socket.id)) return;

    room.timer.remaining = room.timer.duration;
    room.timer.running = false;

    if (room.timer.interval) {
      clearInterval(room.timer.interval);
      room.timer.interval = null;
    }

    io.to(roomId).emit("timer-update", publicTimer(room.timer));
  });

  socket.on("clear-life-history", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!isPlayerInRoom(room, socket.id)) return;

    room.lifeHistory = [];
    sendRoomState(roomId);
  });

  socket.on("leave-room", ({ roomId }) => {
    removeSocketFromAllRooms(socket.id);
    moveSocketPresenceToLobby(socket.id);

    if (roomId) {
      socket.leave(roomId);
    }

    socket.emit("left-room");
    broadcastLobbyState();
  });

  socket.on("disconnect", () => {
    console.log("Desconectado:", socket.id);

    removeSocketFromAllRooms(socket.id);
    removeSocketPresence(socket.id);
    broadcastLobbyState();
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
