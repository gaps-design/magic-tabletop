const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const {
  getHallOfFame,
  updateHallOfFameFromEvent,
  validateEventForRanking
} = require("./src/hallOfFame");
const {
  saveTournament,
  saveTournamentResult,
  loadActiveTournamentSnapshot
} = require("./src/repositories/tournamentsRepository");
const { logAudit } = require("./src/repositories/auditRepository");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const rooms = {};
const chatControl = {};
const clientProfiles = {};
const connectedUsers = {};
const onlineUsers = new Map();
const socketPresence = new Map();
let activeTournament = null;

function persistTournamentAsync(reason = "update", metadata = {}) {
  if (!activeTournament?.id) return;
  saveTournament(activeTournament, reason).catch(error => {
    console.error("[SUPABASE] Tournament persistence failed:", error.message);
  });
  logAudit(metadata.action || reason, {
    ...metadata,
    entityType: metadata.entityType || "tournament",
    entityId: metadata.entityId || activeTournament.id,
    tournamentId: activeTournament.id
  }).catch(error => {
    console.error("[SUPABASE] Audit persistence failed:", error.message);
  });
}

function persistTournamentResultAsync(match, userId = "") {
  if (!activeTournament?.id || !match?.id) return;
  saveTournamentResult(activeTournament, match, userId).catch(error => {
    console.error("[SUPABASE] Tournament result persistence failed:", error.message);
  });
}

async function restoreActiveTournamentFromSupabase() {
  const restored = await loadActiveTournamentSnapshot();
  if (!restored || activeTournament) return;
  activeTournament = restored;
  console.log("[SUPABASE] Active tournament restored from PostgreSQL:", activeTournament.id);
}

const CHAT_LIMIT = 5;
const CHAT_BLOCK_MS = 3000;
const CARD_SCAN_MESSAGE_LIMIT = 650;
const CARD_SCAN_FIELD_LIMIT = 180;
const CARD_SCAN_ORACLE_LIMIT = 420;
const CUSTOM_SKIN_TEXT_LIMIT = 80;
const TABLE_SKINS = new Set(["none", "mono-white", "mono-blue", "mono-black", "mono-red", "mono-green", "custom"]);
const CUSTOM_SKIN_BLOCKED_WORDS = ["porra", "caralho", "puta", "fdp", "viado", "merda"];
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTableSkin(skinId) {
  return TABLE_SKINS.has(skinId) ? skinId : "none";
}

function sanitizeCustomSkinText(value = "") {
  let text = String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, CUSTOM_SKIN_TEXT_LIMIT);

  CUSTOM_SKIN_BLOCKED_WORDS.forEach(word => {
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi");
    text = text.replace(pattern, "****");
  });

  return text;
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

function createDefaultTableSkins() {
  return {
    1: { skinId: "none", customText: "" },
    2: { skinId: "none", customText: "" }
  };
}

function publicTableSkinState(room) {
  const state = room?.tableSkins || createDefaultTableSkins();

  return {
    1: {
      skinId: normalizeTableSkin(state[1]?.skinId || state["1"]?.skinId || "none"),
      customText: sanitizeCustomSkinText(state[1]?.customText || state["1"]?.customText || "")
    },
    2: {
      skinId: normalizeTableSkin(state[2]?.skinId || state["2"]?.skinId || "none"),
      customText: sanitizeCustomSkinText(state[2]?.customText || state["2"]?.customText || "")
    }
  };
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
      tableSkins: createDefaultTableSkins(),
      overlays: [],
      currentScannerCard: null
    };
  }

  if (!rooms[roomId].playerThemes) {
    rooms[roomId].playerThemes = createDefaultPlayerThemes();
  }

  if (!rooms[roomId].tableSkins) {
    rooms[roomId].tableSkins = createDefaultTableSkins();
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
    tableSkins: publicTableSkinState(room),
    currentScannerCard: room.currentScannerCard || null,
    users: buildRoomUsers(room)
  });
  io.to(roomId).emit("table-skin-state", publicTableSkinState(room));
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
      tableSkins: createDefaultTableSkins(),
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
      })),
      ...room.spectators
        .filter(id => id !== socket.id)
        .map(id => ({
          socketId: id,
          role: "spectator",
          name: clientProfiles[id]?.name || "Espectador",
          photo: clientProfiles[id]?.photo || "/assets/default-avatar.png"
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

/* =========================
   TORNEIOS MVP
========================= */

function createId(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getRequestUser(req) {
  const user = normalizeUser(req.body?.user || {});
  const id = user.uid || user.email || "";
  return id ? { ...user, id } : null;
}

function requireTournamentUser(req, res) {
  const user = getRequestUser(req);
  if (!user) {
    res.status(401).json({ error: "Entre com Google para usar torneios." });
    return null;
  }

  return user;
}

function isTournamentOwner(tournament, user) {
  return !!(tournament && user && tournament.ownerId === user.id);
}

function findTournamentPlayer(tournament, userId) {
  return tournament.players.find(player => player.userId === userId || player.id === userId);
}

function isRoundTableTournament(tournament) {
  return tournament?.type === "round_table";
}

function publicTournament(tournament) {
  if (!tournament) return null;
  const standings = getTournamentStandings(tournament);
  const hallOfFameStatus = tournament.hallOfFameStatus || validateEventForRanking(tournament);
  return {
    id: tournament.id,
    type: tournament.type || "swiss",
    name: tournament.name,
    ownerId: tournament.ownerId,
    maxPlayers: tournament.maxPlayers,
    roundsTotal: tournament.roundsTotal,
    currentRound: tournament.currentRound,
    format: tournament.format,
    status: tournament.status,
    inviteCode: tournament.inviteCode,
    createdAt: tournament.createdAt,
    updatedAt: tournament.updatedAt,
    players: tournament.players,
    rounds: tournament.rounds,
    matches: tournament.matches,
    queue: tournament.queue || [],
    currentChampionId: tournament.currentChampionId || null,
    currentMatchId: tournament.currentMatchId || null,
    roundTableHistory: tournament.roundTableHistory || [],
    roundTable: getRoundTableSummary(tournament),
    standings,
    champion: tournament.status === "finished" ? standings[0] || null : null,
    isRankedRequested: tournament.isRankedRequested !== false,
    hallOfFameStatus
  };
}

function resetTournamentPlayerStats(player) {
    player.points = 0;
    player.matchPoints = 0;
    player.wins = 0;
    player.matchWins = 0;
    player.draws = 0;
    player.matchDraws = 0;
    player.losses = 0;
    player.matchLosses = 0;
    player.byes = 0;
    player.gameWins = 0;
    player.gameLosses = 0;
    player.gameDraws = 0;
    player.gameDifferential = 0;
    player.gameWinPercentage = 0;
    player.opponentMatchWinPercentage = 0;
    player.opponentMatchWinRate = 0;
    player.matchesPlayed = 0;
    player.opponentIds = [];
    player.currentStreak = 0;
    player.bestStreak = 0;
}

function ensureTournamentPlayerStats(player) {
  if (typeof player.matchPoints !== "number") player.matchPoints = Number(player.points || 0);
  if (typeof player.matchWins !== "number") player.matchWins = Number(player.wins || 0);
  if (typeof player.matchDraws !== "number") player.matchDraws = Number(player.draws || 0);
  if (typeof player.matchLosses !== "number") player.matchLosses = Number(player.losses || 0);
  if (typeof player.gameWins !== "number") player.gameWins = 0;
  if (typeof player.gameLosses !== "number") player.gameLosses = 0;
  if (typeof player.gameDraws !== "number") player.gameDraws = 0;
  if (typeof player.gameDifferential !== "number") player.gameDifferential = player.gameWins - player.gameLosses;
  if (typeof player.gameWinPercentage !== "number") player.gameWinPercentage = 0;
  if (typeof player.opponentMatchWinPercentage !== "number") player.opponentMatchWinPercentage = 0;
  if (typeof player.opponentMatchWinRate !== "number") player.opponentMatchWinRate = player.opponentMatchWinPercentage;
  if (typeof player.matchesPlayed !== "number") player.matchesPlayed = 0;
  if (!Array.isArray(player.opponentIds)) player.opponentIds = [];
  if (typeof player.currentStreak !== "number") player.currentStreak = 0;
  if (typeof player.bestStreak !== "number") player.bestStreak = 0;
  player.points = player.matchPoints;
  player.wins = player.matchWins;
  player.draws = player.matchDraws;
  player.losses = player.matchLosses;
  return player;
}

function getGameWinPercentage(player) {
  const totalGames = (Number(player.gameWins) || 0) + (Number(player.gameLosses) || 0) + (Number(player.gameDraws) || 0);
  if (!totalGames) return 0;
  return ((Number(player.gameWins) || 0) + ((Number(player.gameDraws) || 0) * 0.5)) / totalGames;
}

function getMatchWinPercentage(player) {
  const played = Number(player.matchesPlayed) || 0;
  if (!played) return 0;
  return (Number(player.matchPoints || player.points || 0) || 0) / (played * 3);
}

function compareTournamentPlayers(a, b) {
  ensureTournamentPlayerStats(a);
  ensureTournamentPlayerStats(b);
  if (isRoundTableTournament(activeTournament)) {
    return b.matchPoints - a.matchPoints ||
      b.matchWins - a.matchWins ||
      b.bestStreak - a.bestStreak ||
      b.currentStreak - a.currentStreak ||
      a.name.localeCompare(b.name);
  }
  return b.matchPoints - a.matchPoints ||
    b.opponentMatchWinPercentage - a.opponentMatchWinPercentage ||
    b.gameDifferential - a.gameDifferential ||
    b.gameWinPercentage - a.gameWinPercentage ||
    b.matchWins - a.matchWins ||
    a.name.localeCompare(b.name);
}

function getTournamentStandings(tournament) {
  return [...(tournament?.players || [])]
    .map(player => ensureTournamentPlayerStats(player))
    .sort((a, b) => {
      if (isRoundTableTournament(tournament)) {
        return b.matchPoints - a.matchPoints ||
          b.matchWins - a.matchWins ||
          b.bestStreak - a.bestStreak ||
          b.currentStreak - a.currentStreak ||
          a.name.localeCompare(b.name);
      }
      if (a.dropped !== b.dropped) return a.dropped ? 1 : -1;
      return compareTournamentPlayers(a, b);
    });
}

function getMatchScoreFromResult(match, tournament) {
  if (Number.isFinite(Number(match.player1GameWins)) && Number.isFinite(Number(match.player2GameWins))) {
    return {
      player1GameWins: Number(match.player1GameWins),
      player2GameWins: Number(match.player2GameWins)
    };
  }

  if (match.result === "bye") {
    return { player1GameWins: tournament.format === "BO1" ? 1 : 2, player2GameWins: 0 };
  }

  if (match.result === "draw") return { player1GameWins: 1, player2GameWins: 1 };
  if (match.result === "player1_win") return { player1GameWins: tournament.format === "BO1" ? 1 : 2, player2GameWins: 0 };
  if (match.result === "player2_win") return { player1GameWins: 0, player2GameWins: tournament.format === "BO1" ? 1 : 2 };

  return { player1GameWins: 0, player2GameWins: 0 };
}

function buildTournamentResultLabel(tournament, match, player1GameWins, player2GameWins) {
  const p1 = findTournamentPlayer(tournament, match.player1Id);
  const p2 = findTournamentPlayer(tournament, match.player2Id);
  if (match.result === "bye" || match.isBye || !p2) {
    return `${p1?.name || "Jogador"} ${player1GameWins}x${player2GameWins} BYE`;
  }

  return `${p1?.name || "Jogador 1"} ${player1GameWins}x${player2GameWins} ${p2?.name || "Jogador 2"}`;
}

function recalculateTournamentStandings(tournament) {
  tournament.players.forEach(player => {
    resetTournamentPlayerStats(player);
  });

  tournament.matches.forEach(match => {
    if (!match.result) return;

    const p1 = findTournamentPlayer(tournament, match.player1Id);
    const p2 = findTournamentPlayer(tournament, match.player2Id);
    const { player1GameWins, player2GameWins } = getMatchScoreFromResult(match, tournament);

    match.player1GameWins = player1GameWins;
    match.player2GameWins = player2GameWins;
    match.isDraw = match.result === "draw" || (player1GameWins === player2GameWins && match.result !== "bye");
    match.resultLabel = match.resultLabel || buildTournamentResultLabel(tournament, match, player1GameWins, player2GameWins);

    if (match.result === "bye" && p1) {
      p1.matchPoints += 3;
      p1.matchWins += 1;
      p1.points = p1.matchPoints;
      p1.wins = p1.matchWins;
      p1.byes += 1;
      p1.gameWins += player1GameWins;
      p1.gameLosses += player2GameWins;
      p1.matchesPlayed += 1;
      return;
    }

    if (match.result === "draw") {
      if (p1) {
        p1.matchPoints += 1;
        p1.matchDraws += 1;
        p1.points = p1.matchPoints;
        p1.draws = p1.matchDraws;
        p1.gameWins += player1GameWins;
        p1.gameLosses += player2GameWins;
        p1.gameDraws += player1GameWins === player2GameWins ? 1 : 0;
        p1.matchesPlayed += 1;
        if (p2) p1.opponentIds.push(p2.id);
      }
      if (p2) {
        p2.matchPoints += 1;
        p2.matchDraws += 1;
        p2.points = p2.matchPoints;
        p2.draws = p2.matchDraws;
        p2.gameWins += player2GameWins;
        p2.gameLosses += player1GameWins;
        p2.gameDraws += player1GameWins === player2GameWins ? 1 : 0;
        p2.matchesPlayed += 1;
        if (p1) p2.opponentIds.push(p1.id);
      }
      return;
    }

    if (match.result === "player1_win") {
      if (p1) {
        p1.matchPoints += 3;
        p1.matchWins += 1;
        p1.points = p1.matchPoints;
        p1.wins = p1.matchWins;
        p1.gameWins += player1GameWins;
        p1.gameLosses += player2GameWins;
        p1.matchesPlayed += 1;
        if (p2) p1.opponentIds.push(p2.id);
      }
      if (p2) {
        p2.matchLosses += 1;
        p2.losses = p2.matchLosses;
        p2.gameWins += player2GameWins;
        p2.gameLosses += player1GameWins;
        p2.matchesPlayed += 1;
        if (p1) p2.opponentIds.push(p1.id);
      }
      return;
    }

    if (match.result === "player2_win") {
      if (p2) {
        p2.matchPoints += 3;
        p2.matchWins += 1;
        p2.points = p2.matchPoints;
        p2.wins = p2.matchWins;
        p2.gameWins += player2GameWins;
        p2.gameLosses += player1GameWins;
        p2.matchesPlayed += 1;
        if (p1) p2.opponentIds.push(p1.id);
      }
      if (p1) {
        p1.matchLosses += 1;
        p1.losses = p1.matchLosses;
        p1.gameWins += player1GameWins;
        p1.gameLosses += player2GameWins;
        p1.matchesPlayed += 1;
        if (p2) p1.opponentIds.push(p2.id);
      }
    }
  });

  tournament.players.forEach(player => {
    player.gameDifferential = player.gameWins - player.gameLosses;
    player.gameWinPercentage = getGameWinPercentage(player);
  });

  tournament.players.forEach(player => {
    const opponentRates = [...new Set(player.opponentIds || [])]
      .map(opponentId => findTournamentPlayer(tournament, opponentId))
      .filter(Boolean)
      .map(opponent => getMatchWinPercentage(opponent));

    player.opponentMatchWinPercentage = opponentRates.length
      ? opponentRates.reduce((sum, rate) => sum + rate, 0) / opponentRates.length
      : 0;
    player.opponentMatchWinRate = player.opponentMatchWinPercentage;
    player.points = player.matchPoints;
    player.wins = player.matchWins;
    player.draws = player.matchDraws;
    player.losses = player.matchLosses;
  });

  tournament.rounds.forEach(round => {
    const roundMatches = tournament.matches.filter(match => match.roundId === round.id);
    round.status = roundMatches.length && roundMatches.every(match => !!match.result) ? "completed" : round.status;
  });
}

function getPairKey(playerA, playerB) {
  return [playerA, playerB].sort().join("::");
}

function hasPlayed(tournament, playerA, playerB) {
  const key = getPairKey(playerA, playerB);
  return tournament.matches.some(match =>
    match.player1Id && match.player2Id && getPairKey(match.player1Id, match.player2Id) === key
  );
}

function getSortedTournamentPlayers(tournament) {
  return tournament.players
    .filter(player => !player.dropped)
    .sort(compareTournamentPlayers);
}

function createTournamentPlayer(user, tournamentId = "", joinedAt = Date.now()) {
  return {
    id: user.id,
    tournamentId,
    userId: user.id,
    name: user.name,
    email: user.email,
    avatar: user.photo,
    points: 0,
    matchPoints: 0,
    wins: 0,
    matchWins: 0,
    draws: 0,
    matchDraws: 0,
    losses: 0,
    matchLosses: 0,
    byes: 0,
    gameWins: 0,
    gameLosses: 0,
    gameDraws: 0,
    gameDifferential: 0,
    gameWinPercentage: 0,
    opponentMatchWinPercentage: 0,
    opponentMatchWinRate: 0,
    matchesPlayed: 0,
    opponentIds: [],
    currentStreak: 0,
    bestStreak: 0,
    dropped: false,
    joinedAt
  };
}

function getActiveRoundTableMatch(tournament) {
  if (!isRoundTableTournament(tournament)) return null;
  return tournament.matches.find(match => match.id === tournament.currentMatchId && !match.result) ||
    tournament.matches.find(match => !match.result && match.status !== "completed") ||
    null;
}

function removeFromRoundTableQueue(tournament, playerId) {
  if (!Array.isArray(tournament.queue)) tournament.queue = [];
  tournament.queue = tournament.queue.filter(id => id !== playerId);
}

function enqueueRoundTablePlayer(tournament, playerId) {
  const player = findTournamentPlayer(tournament, playerId);
  if (!player || player.dropped || player.id === tournament.currentChampionId) return;
  removeFromRoundTableQueue(tournament, player.id);
  tournament.queue.push(player.id);
}

function getRoundTableQueuePlayers(tournament) {
  return (tournament.queue || [])
    .map(id => findTournamentPlayer(tournament, id))
    .filter(player => player && !player.dropped);
}

function getRoundTableSummary(tournament) {
  if (!isRoundTableTournament(tournament)) return null;
  const standings = getTournamentStandings(tournament);
  const currentChampion = findTournamentPlayer(tournament, tournament.currentChampionId);
  const bestStreakPlayer = standings.reduce((best, player) => {
    if (!best || (player.bestStreak || 0) > (best.bestStreak || 0)) return player;
    return best;
  }, null);

  return {
    currentChampion,
    currentMatch: getActiveRoundTableMatch(tournament),
    queue: getRoundTableQueuePlayers(tournament),
    totalMatches: tournament.matches.filter(match => match.result && match.result !== "drop").length,
    bestStreakPlayer
  };
}

function createRoundTableMatch(tournament) {
  if (!isRoundTableTournament(tournament) || tournament.status === "finished") return null;
  if (getActiveRoundTableMatch(tournament)) return getActiveRoundTableMatch(tournament);

  const activePlayers = tournament.players.filter(player => !player.dropped);
  if (activePlayers.length < 2) {
    tournament.status = "registration_open";
    tournament.currentMatchId = null;
    tournament.updatedAt = Date.now();
    return null;
  }

  let champion = findTournamentPlayer(tournament, tournament.currentChampionId);
  if (!champion || champion.dropped) {
    champion = activePlayers[0];
    tournament.currentChampionId = champion.id;
    removeFromRoundTableQueue(tournament, champion.id);
  }

  tournament.queue = (tournament.queue || []).filter(id => {
    const player = findTournamentPlayer(tournament, id);
    return player && !player.dropped && player.id !== champion.id;
  });

  const queuedChallenger = getRoundTableQueuePlayers(tournament)[0] ||
    activePlayers.find(player => player.id !== champion.id);
  if (!queuedChallenger) return null;

  removeFromRoundTableQueue(tournament, queuedChallenger.id);
  const matchNumber = tournament.matches.length + 1;
  const roomId = `king-${tournament.inviteCode}-m${matchNumber}`;
  const match = {
    id: createId("match"),
    tournamentId: tournament.id,
    roundId: "round-table",
    roundNumber: matchNumber,
    tableNumber: 1,
    player1Id: champion.id,
    player2Id: queuedChallenger.id,
    roomId,
    roomUrl: `/sala.html?room=${encodeURIComponent(roomId)}&tournament=${encodeURIComponent(tournament.id)}&mode=round-table&table=1`,
    status: "pending",
    result: null,
    player1GameWins: null,
    player2GameWins: null,
    isDraw: false,
    resultLabel: "",
    winnerId: null,
    reportedBy: null,
    reportedAt: null,
    externalPlay: false,
    externalUrl: "",
    isBye: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  tournament.status = "in_progress";
  tournament.currentMatchId = match.id;
  tournament.matches.push(match);
  tournament.updatedAt = Date.now();
  return match;
}

function applyRoundTableResult(tournament, match, score, userId) {
  const p1 = findTournamentPlayer(tournament, match.player1Id);
  const p2 = findTournamentPlayer(tournament, match.player2Id);
  if (!p1 || !p2) throw new Error("Jogadores da mesa não encontrados.");

  match.player1GameWins = score.player1GameWins;
  match.player2GameWins = score.player2GameWins;
  match.result = score.result;
  match.isDraw = score.isDraw;
  match.winnerId = score.winnerId;
  match.resultLabel = buildTournamentResultLabel(tournament, match, score.player1GameWins, score.player2GameWins);
  match.status = "completed";
  match.reportedBy = userId;
  match.reportedAt = Date.now();
  match.updatedAt = Date.now();

  p1.matchesPlayed += 1;
  p2.matchesPlayed += 1;
  p1.opponentIds.push(p2.id);
  p2.opponentIds.push(p1.id);
  p1.gameWins += score.player1GameWins;
  p1.gameLosses += score.player2GameWins;
  p2.gameWins += score.player2GameWins;
  p2.gameLosses += score.player1GameWins;

  if (score.result === "draw") {
    p1.matchPoints += 1;
    p2.matchPoints += 1;
    p1.matchDraws += 1;
    p2.matchDraws += 1;
    p1.draws = p1.matchDraws;
    p2.draws = p2.matchDraws;
    p1.currentStreak = 0;
    p2.currentStreak = 0;
    tournament.currentChampionId = p1.id;
    enqueueRoundTablePlayer(tournament, p2.id);
  } else if (score.result === "player1_win") {
    p1.matchPoints += 3;
    p1.matchWins += 1;
    p1.wins = p1.matchWins;
    p1.currentStreak += 1;
    p1.bestStreak = Math.max(p1.bestStreak, p1.currentStreak);
    p2.matchLosses += 1;
    p2.losses = p2.matchLosses;
    p2.currentStreak = 0;
    tournament.currentChampionId = p1.id;
    enqueueRoundTablePlayer(tournament, p2.id);
  } else if (score.result === "player2_win") {
    p2.matchPoints += 3;
    p2.matchWins += 1;
    p2.wins = p2.matchWins;
    p2.currentStreak += 1;
    p2.bestStreak = Math.max(p2.bestStreak, p2.currentStreak);
    p1.matchLosses += 1;
    p1.losses = p1.matchLosses;
    p1.currentStreak = 0;
    tournament.currentChampionId = p2.id;
    enqueueRoundTablePlayer(tournament, p1.id);
  }

  [p1, p2].forEach(player => {
    player.points = player.matchPoints;
    player.gameDifferential = player.gameWins - player.gameLosses;
    player.gameWinPercentage = getGameWinPercentage(player);
    player.opponentMatchWinPercentage = 0;
    player.opponentMatchWinRate = 0;
  });

  tournament.currentMatchId = null;
  tournament.roundTableHistory = tournament.roundTableHistory || [];
  tournament.roundTableHistory.unshift({
    matchId: match.id,
    label: match.resultLabel,
    result: match.result,
    reportedAt: match.reportedAt
  });
  tournament.updatedAt = Date.now();
  createRoundTableMatch(tournament);
}

function normalizeTournamentScore(tournament, match, body = {}) {
  const maxWins = tournament.format === "BO1" ? 1 : 2;
  let player1GameWins = Number(body.player1GameWins);
  let player2GameWins = Number(body.player2GameWins);

  if ((!Number.isFinite(player1GameWins) || !Number.isFinite(player2GameWins)) && typeof body.score === "string") {
    const scoreMatch = body.score.match(/(\d+)\s*x\s*(\d+)/i);
    if (scoreMatch) {
      player1GameWins = Number(scoreMatch[1]);
      player2GameWins = Number(scoreMatch[2]);
    }
  }

  if (!Number.isFinite(player1GameWins) || !Number.isFinite(player2GameWins)) {
    if (body.result === "draw") {
      player1GameWins = tournament.format === "BO1" ? 0 : 1;
      player2GameWins = tournament.format === "BO1" ? 0 : 1;
    } else if (body.result === "player1_win") {
      player1GameWins = maxWins;
      player2GameWins = 0;
    } else if (body.result === "player2_win") {
      player1GameWins = 0;
      player2GameWins = maxWins;
    }
  }

  player1GameWins = Math.max(0, Math.min(maxWins, Math.floor(player1GameWins)));
  player2GameWins = Math.max(0, Math.min(maxWins, Math.floor(player2GameWins)));

  const validScores = tournament.format === "BO1"
    ? ["1-0", "0-1", "0-0"]
    : ["2-0", "2-1", "1-1", "0-2", "1-2"];
  const key = `${player1GameWins}-${player2GameWins}`;
  if (!validScores.includes(key)) {
    throw new Error("Resultado inválido.");
  }

  let result = "draw";
  let winnerId = null;
  if (player1GameWins > player2GameWins) {
    result = "player1_win";
    winnerId = match.player1Id;
  } else if (player2GameWins > player1GameWins) {
    result = "player2_win";
    winnerId = match.player2Id;
  }

  return {
    player1GameWins,
    player2GameWins,
    result,
    winnerId,
    isDraw: result === "draw"
  };
}

function createTournamentRound(tournament) {
  const previousRound = tournament.rounds.find(round => round.roundNumber === tournament.currentRound);
  if (previousRound) {
    const openMatches = tournament.matches.filter(match => match.roundId === previousRound.id && !match.result);
    if (openMatches.length) {
      throw new Error("A rodada atual ainda tem partidas sem resultado.");
    }
  }

  if (tournament.currentRound >= tournament.roundsTotal) {
    throw new Error("Todas as rodadas já foram lançadas.");
  }

  const roundNumber = tournament.currentRound + 1;
  const round = {
    id: createId("round"),
    tournamentId: tournament.id,
    roundNumber,
    status: "active",
    createdAt: Date.now()
  };

  const players = getSortedTournamentPlayers(tournament);
  const unpaired = [...players];
  const pairings = [];

  if (roundNumber === 1) {
    unpaired.sort(() => Math.random() - 0.5);
  }

  if (unpaired.length % 2 === 1) {
    const byePlayer = [...unpaired].reverse().find(player => player.byes === 0) || unpaired[unpaired.length - 1];
    unpaired.splice(unpaired.findIndex(player => player.id === byePlayer.id), 1);
    pairings.push([byePlayer, null]);
  }

  while (unpaired.length) {
    const playerA = unpaired.shift();
    let opponentIndex = unpaired.findIndex(player => !hasPlayed(tournament, playerA.id, player.id));
    if (opponentIndex < 0) opponentIndex = 0;
    const playerB = unpaired.splice(opponentIndex, 1)[0];
    pairings.push([playerA, playerB]);
  }

  const matches = pairings.map(([playerA, playerB], index) => {
    const tableNumber = index + 1;
    const roomId = `trn-${tournament.inviteCode}-r${roundNumber}-m${tableNumber}`;
    return {
      id: createId("match"),
      tournamentId: tournament.id,
      roundId: round.id,
      roundNumber,
      tableNumber,
      player1Id: playerA?.id || "",
      player2Id: playerB?.id || "",
      roomId,
      roomUrl: `/sala.html?room=${encodeURIComponent(roomId)}&tournament=${encodeURIComponent(tournament.id)}&round=${roundNumber}&table=${tableNumber}`,
      status: playerB ? "pending" : "completed",
      result: playerB ? null : "bye",
      player1GameWins: playerB ? null : tournament.format === "BO1" ? 1 : 2,
      player2GameWins: playerB ? null : 0,
      isDraw: false,
      resultLabel: playerB ? "" : `${playerA?.name || "Jogador"} ${tournament.format === "BO1" ? 1 : 2}x0 BYE`,
      winnerId: playerB ? null : playerA.id,
      reportedBy: playerB ? null : "system",
      reportedAt: playerB ? null : Date.now(),
      externalPlay: false,
      externalUrl: "",
      isBye: !playerB,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  });

  tournament.currentRound = roundNumber;
  tournament.status = "in_progress";
  tournament.rounds.push(round);
  tournament.matches.push(...matches);
  tournament.updatedAt = Date.now();
  recalculateTournamentStandings(tournament);
}

function validateTournamentUrl(value = "") {
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

function findTournamentMatch(tournament, matchId) {
  return tournament.matches.find(match => match.id === matchId);
}

app.use("/api/tournaments", express.json({ limit: "1mb" }));

app.get("/torneios", (req, res) => {
  res.redirect("/torneios.html");
});

app.get("/hall-da-fama", (req, res) => {
  res.redirect("/hall-da-fama.html");
});

app.get("/api/tournaments/active", (req, res) => {
  res.json({ tournament: publicTournament(activeTournament) });
});

app.get("/api/hall-of-fame", (req, res) => {
  res.json(getHallOfFame());
});

app.get("/api/hall-of-fame/summary", (req, res) => {
  res.json({ summary: getHallOfFame().summary });
});

app.get("/api/tournaments/room/:roomId", (req, res) => {
  const roomId = req.params.roomId;
  const match = activeTournament?.matches?.find(item => item.roomId === roomId);
  if (!activeTournament || !match) {
    res.status(404).json({ error: "Partida de torneio não encontrada." });
    return;
  }

  res.json({
    tournament: {
      id: activeTournament.id,
      name: activeTournament.name,
      type: activeTournament.type || "swiss",
      format: activeTournament.format
    },
    match,
    player1: findTournamentPlayer(activeTournament, match.player1Id),
    player2: findTournamentPlayer(activeTournament, match.player2Id)
  });
});

app.post("/api/tournaments", (req, res) => {
  const user = requireTournamentUser(req, res);
  if (!user) return;
  if (activeTournament && activeTournament.status !== "finished") {
    res.status(409).json({ error: "Já existe um torneio ativo." });
    return;
  }

  const name = limitText(req.body.name, 80);
  const type = req.body.type === "round_table" ? "round_table" : "swiss";
  const maxPlayers = Math.min(64, Math.max(2, Number(req.body.maxPlayers || 8)));
  const roundsTotal = type === "round_table" ? 0 : Math.min(8, Math.max(1, Number(req.body.roundsTotal || 3)));
  const format = type === "round_table" ? "BO1" : req.body.format === "BO1" ? "BO1" : "BO3";

  if (!name) {
    res.status(400).json({ error: "Informe o nome do torneio." });
    return;
  }

  const now = Date.now();
  const ownerPlayer = createTournamentPlayer(user, "", now);

  activeTournament = {
    id: createId("tournament"),
    type,
    name,
    ownerId: user.id,
    maxPlayers,
    roundsTotal,
    currentRound: 0,
    format,
    status: "registration_open",
    isRankedRequested: req.body.isRankedRequested !== false,
    hallOfFameStatus: { isRanked: false, reason: "Evento ainda nao finalizado." },
    inviteCode: Math.random().toString(36).slice(2, 8),
    createdAt: now,
    updatedAt: now,
    players: [ownerPlayer],
    rounds: [],
    matches: [],
    queue: [],
    currentChampionId: type === "round_table" ? ownerPlayer.id : null,
    currentMatchId: null,
    roundTableHistory: []
  };
  ownerPlayer.tournamentId = activeTournament.id;
  persistTournamentAsync("tournament_created", {
    action: "tournament_created",
    user,
    actorId: user.id,
    actorName: user.name,
    metadata: { type }
  });

  res.status(201).json({ tournament: publicTournament(activeTournament) });
});

app.post("/api/tournaments/:id/join", (req, res) => {
  const user = requireTournamentUser(req, res);
  if (!user) return;
  const tournament = activeTournament;
  if (!tournament || tournament.id !== req.params.id) {
    res.status(404).json({ error: "Torneio não encontrado." });
    return;
  }
  if (tournament.status !== "registration_open" && (!isRoundTableTournament(tournament) || tournament.status === "finished")) {
    res.status(400).json({ error: "Inscrições encerradas." });
    return;
  }
  if (findTournamentPlayer(tournament, user.id)) {
    res.status(409).json({ error: "Você já está inscrito neste torneio." });
    return;
  }
  if (tournament.players.filter(player => !player.dropped).length >= tournament.maxPlayers) {
    res.status(400).json({ error: "Torneio cheio." });
    return;
  }

  const player = createTournamentPlayer(user, tournament.id);
  tournament.players.push(player);
  if (isRoundTableTournament(tournament)) {
    enqueueRoundTablePlayer(tournament, player.id);
    createRoundTableMatch(tournament);
  }
  tournament.updatedAt = Date.now();
  persistTournamentAsync("tournament_player_joined", {
    action: "tournament_player_joined",
    user,
    actorId: user.id,
    actorName: user.name,
    entityType: "tournament_player",
    entityId: player.id
  });
  res.json({ tournament: publicTournament(tournament) });
});

app.post("/api/tournaments/:id/drop", (req, res) => {
  const user = requireTournamentUser(req, res);
  if (!user) return;
  const tournament = activeTournament;
  if (!tournament || tournament.id !== req.params.id || !isRoundTableTournament(tournament)) {
    res.status(404).json({ error: "Mesa Redonda nao encontrada." });
    return;
  }
  if (tournament.status === "finished") {
    res.status(400).json({ error: "Campeonato ja finalizado." });
    return;
  }

  const requestedPlayerId = req.body.playerId || user.id;
  const player = findTournamentPlayer(tournament, requestedPlayerId);
  if (!player) {
    res.status(404).json({ error: "Jogador nao encontrado." });
    return;
  }
  if (!isTournamentOwner(tournament, user) && player.userId !== user.id) {
    res.status(403).json({ error: "Voce so pode dropar a si mesmo." });
    return;
  }

  player.dropped = true;
  player.currentStreak = 0;
  removeFromRoundTableQueue(tournament, player.id);

  const activeMatch = getActiveRoundTableMatch(tournament);
  if (activeMatch && (activeMatch.player1Id === player.id || activeMatch.player2Id === player.id)) {
    const otherPlayerId = activeMatch.player1Id === player.id ? activeMatch.player2Id : activeMatch.player1Id;
    activeMatch.status = "completed";
    activeMatch.result = "drop";
    activeMatch.resultLabel = `${player.name} dropou`;
    activeMatch.reportedBy = user.id;
    activeMatch.reportedAt = Date.now();
    activeMatch.updatedAt = Date.now();
    tournament.currentMatchId = null;
    tournament.currentChampionId = findTournamentPlayer(tournament, otherPlayerId)?.dropped ? null : otherPlayerId;
  }

  if (tournament.currentChampionId === player.id) {
    tournament.currentChampionId = getRoundTableQueuePlayers(tournament)[0]?.id ||
      tournament.players.find(item => !item.dropped)?.id ||
      null;
    removeFromRoundTableQueue(tournament, tournament.currentChampionId);
  }

  createRoundTableMatch(tournament);
  tournament.updatedAt = Date.now();
  persistTournamentAsync("tournament_player_dropped", {
    action: "tournament_player_dropped",
    user,
    actorId: user.id,
    actorName: user.name,
    entityType: "tournament_player",
    entityId: player.id
  });
  res.json({ tournament: publicTournament(tournament) });
});

app.post("/api/tournaments/:id/remove-player", (req, res) => {
  const user = requireTournamentUser(req, res);
  if (!user) return;
  const tournament = activeTournament;
  if (!tournament || tournament.id !== req.params.id) {
    res.status(404).json({ error: "Torneio não encontrado." });
    return;
  }
  if (!isTournamentOwner(tournament, user)) {
    res.status(403).json({ error: "Apenas o criador pode remover jogadores." });
    return;
  }
  if (tournament.status !== "registration_open") {
    res.status(400).json({ error: "Só é possível remover antes do início." });
    return;
  }

  tournament.players = tournament.players.filter(player => player.id !== req.body.playerId || player.userId === tournament.ownerId);
  tournament.updatedAt = Date.now();
  persistTournamentAsync("tournament_player_removed", {
    action: "tournament_player_removed",
    user,
    actorId: user.id,
    actorName: user.name,
    entityType: "tournament_player",
    entityId: req.body.playerId
  });
  res.json({ tournament: publicTournament(tournament) });
});

app.post("/api/tournaments/:id/close-registration", (req, res) => {
  const user = requireTournamentUser(req, res);
  if (!user) return;
  const tournament = activeTournament;
  if (!tournament || tournament.id !== req.params.id) {
    res.status(404).json({ error: "Torneio não encontrado." });
    return;
  }
  if (!isTournamentOwner(tournament, user)) {
    res.status(403).json({ error: "Apenas o criador pode encerrar inscrições." });
    return;
  }

  if (isRoundTableTournament(tournament)) {
    res.status(400).json({ error: "Mesa Redonda nao usa encerramento de inscricoes." });
    return;
  }

  tournament.status = "registration_closed";
  tournament.updatedAt = Date.now();
  persistTournamentAsync("tournament_registration_closed", {
    action: "tournament_registration_closed",
    user,
    actorId: user.id,
    actorName: user.name
  });
  res.json({ tournament: publicTournament(tournament) });
});

app.post("/api/tournaments/:id/launch-round", (req, res) => {
  const user = requireTournamentUser(req, res);
  if (!user) return;
  const tournament = activeTournament;
  if (!tournament || tournament.id !== req.params.id) {
    res.status(404).json({ error: "Torneio não encontrado." });
    return;
  }
  if (!isTournamentOwner(tournament, user)) {
    res.status(403).json({ error: "Apenas o criador pode lançar rodadas." });
    return;
  }
  if (isRoundTableTournament(tournament)) {
    res.status(400).json({ error: "Mesa Redonda gera partidas automaticamente." });
    return;
  }
  if (tournament.players.filter(player => !player.dropped).length < 2) {
    res.status(400).json({ error: "É preciso pelo menos 2 jogadores." });
    return;
  }

  try {
    createTournamentRound(tournament);
    persistTournamentAsync("tournament_round_launched", {
      action: "tournament_round_launched",
      user,
      actorId: user.id,
      actorName: user.name,
      metadata: { currentRound: tournament.currentRound }
    });
    res.json({ tournament: publicTournament(tournament) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/tournaments/:id/matches/:matchId/external", (req, res) => {
  const user = requireTournamentUser(req, res);
  if (!user) return;
  const tournament = activeTournament;
  const match = tournament?.id === req.params.id ? findTournamentMatch(tournament, req.params.matchId) : null;
  if (!tournament || !match) {
    res.status(404).json({ error: "Partida não encontrada." });
    return;
  }

  const isPlayerInMatch = match.player1Id === user.id || match.player2Id === user.id;
  if (!isTournamentOwner(tournament, user) && !isPlayerInMatch) {
    res.status(403).json({ error: "Você não pode alterar esta partida." });
    return;
  }

  match.externalPlay = true;
  match.externalUrl = validateTournamentUrl(req.body.externalUrl || "");
  match.status = "playing_external";
  match.updatedAt = Date.now();
  tournament.updatedAt = Date.now();
  persistTournamentAsync("tournament_match_external", {
    action: "tournament_match_external",
    user,
    actorId: user.id,
    actorName: user.name,
    entityType: "match",
    entityId: match.id,
    matchId: match.id
  });
  res.json({ tournament: publicTournament(tournament) });
});

app.post("/api/tournaments/:id/matches/:matchId/result", (req, res) => {
  const user = requireTournamentUser(req, res);
  if (!user) return;
  const tournament = activeTournament;
  const match = tournament?.id === req.params.id ? findTournamentMatch(tournament, req.params.matchId) : null;
  if (!tournament || !match) {
    res.status(404).json({ error: "Partida não encontrada." });
    return;
  }
  if (false && !["player1_win", "player2_win", "draw"].includes(req.body.result)) {
    res.status(400).json({ error: "Resultado inválido." });
    return;
  }

  const isPlayerInMatch = match.player1Id === user.id || match.player2Id === user.id;
  if (!isTournamentOwner(tournament, user) && !isPlayerInMatch) {
    res.status(403).json({ error: "Você só pode lançar resultado da sua partida." });
    return;
  }

  let score;
  try {
    score = normalizeTournamentScore(tournament, match, req.body);
  } catch (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (isRoundTableTournament(tournament)) {
    try {
      applyRoundTableResult(tournament, match, score, user.id);
      persistTournamentResultAsync(match, user.id);
      persistTournamentAsync("tournament_match_result", {
        action: "tournament_match_result",
        user,
        actorId: user.id,
        actorName: user.name,
        entityType: "match",
        entityId: match.id,
        matchId: match.id,
        metadata: { result: match.result, resultLabel: match.resultLabel }
      });
      res.json({ tournament: publicTournament(tournament) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
    return;
  }

  match.player1GameWins = score.player1GameWins;
  match.player2GameWins = score.player2GameWins;
  match.result = score.result;
  match.isDraw = score.isDraw;
  match.winnerId = score.winnerId;
  match.resultLabel = buildTournamentResultLabel(tournament, match, score.player1GameWins, score.player2GameWins);
  match.status = "completed";
  match.reportedBy = user.id;
  match.reportedAt = Date.now();
  match.updatedAt = Date.now();
  tournament.updatedAt = Date.now();
  recalculateTournamentStandings(tournament);
  persistTournamentResultAsync(match, user.id);
  persistTournamentAsync("tournament_match_result", {
    action: "tournament_match_result",
    user,
    actorId: user.id,
    actorName: user.name,
    entityType: "match",
    entityId: match.id,
    matchId: match.id,
    metadata: { result: match.result, resultLabel: match.resultLabel }
  });
  res.json({ tournament: publicTournament(tournament) });
});

app.post("/api/tournaments/:id/finish", (req, res) => {
  const user = requireTournamentUser(req, res);
  if (!user) return;
  const tournament = activeTournament;
  if (!tournament || tournament.id !== req.params.id) {
    res.status(404).json({ error: "Torneio não encontrado." });
    return;
  }
  if (!isTournamentOwner(tournament, user)) {
    res.status(403).json({ error: "Apenas o criador pode encerrar o torneio." });
    return;
  }

  tournament.status = "finished";
  tournament.currentMatchId = null;
  tournament.updatedAt = Date.now();
  if (!isRoundTableTournament(tournament)) {
    recalculateTournamentStandings(tournament);
  }
  tournament.hallOfFameStatus = updateHallOfFameFromEvent(tournament);
  persistTournamentAsync("tournament_finished", {
    action: "tournament_finished",
    user,
    actorId: user.id,
    actorName: user.name,
    metadata: { hallOfFameStatus: tournament.hallOfFameStatus }
  });
  res.json({ tournament: publicTournament(tournament) });
});

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

  socket.on("table-skin-change", ({ roomId, playerNumber, skinId, customText }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return;

    const normalizedPlayerNumber = Number(playerNumber);
    if (Number(player.playerNumber) !== normalizedPlayerNumber) return;

    room.tableSkins = room.tableSkins || createDefaultTableSkins();
    room.tableSkins[normalizedPlayerNumber] = {
      skinId: normalizeTableSkin(skinId),
      customText: sanitizeCustomSkinText(customText)
    };

    io.to(roomId).emit("table-skin-update", {
      roomId,
      playerNumber: normalizedPlayerNumber,
      ...room.tableSkins[normalizedPlayerNumber]
    });

    sendRoomState(roomId);
  });

  socket.on("table-skin-text-change", ({ roomId, playerNumber, customText }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return;

    const normalizedPlayerNumber = Number(playerNumber);
    if (Number(player.playerNumber) !== normalizedPlayerNumber) return;

    room.tableSkins = room.tableSkins || createDefaultTableSkins();
    const current = room.tableSkins[normalizedPlayerNumber] || { skinId: "none", customText: "" };
    room.tableSkins[normalizedPlayerNumber] = {
      skinId: normalizeTableSkin(current.skinId),
      customText: sanitizeCustomSkinText(customText)
    };

    io.to(roomId).emit("table-skin-text-update", {
      roomId,
      playerNumber: normalizedPlayerNumber,
      customText: room.tableSkins[normalizedPlayerNumber].customText
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
    console.log("[AUDIO][SPECTATOR] legacy mic response ignored; spectators self-manage microphone", {
      roomId,
      spectatorSocketId,
      allow: !!allow
    });

    io.to(spectatorSocketId).emit("spectator-mic-status", {
      status: "enabled"
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
    console.log("[AUDIO][SPECTATOR] legacy mic permission command ignored; spectators self-manage microphone", {
      roomId,
      spectatorSocketId,
      allow: !!allow
    });

    io.to(spectatorSocketId).emit("spectator-mic-status", {
      status: "enabled"
    });

    io.to(roomId).emit("mic-status-update", {
      socketId: spectatorSocketId,
      micEnabled: !!profile.micEnabled,
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
    console.log("[AUDIO][SPECTATOR] spectator mute command ignored; spectators self-manage microphone", {
      roomId,
      spectatorSocketId,
      mutedBy: socket.id
    });

    io.to(spectatorSocketId).emit("spectator-mic-status", {
      status: "enabled"
    });

    io.to(roomId).emit("mic-status-update", {
      socketId: spectatorSocketId,
      micEnabled: !!profile.micEnabled,
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

  socket.on("reset-player-state", ({ roomId, playerNumber }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = getPlayerBySocket(room, socket.id);
    if (!player) return;

    const normalizedPlayerNumber = Number(playerNumber);
    if (player.playerNumber !== normalizedPlayerNumber) return;

    const oldLife = player.life;
    player.life = 20;
    room.lifeHistory = [];
    room.markerState = room.markerState || { 1: {}, 2: {} };
    room.markerState[String(normalizedPlayerNumber)] = {};

    io.to(roomId).emit("system-event", {
      type: "player-state-reset",
      message: `${player.name || `Jogador ${normalizedPlayerNumber}`} reiniciou vida, histórico, notas e marcadores da partida.`,
      time: new Date().toLocaleTimeString("pt-BR")
    });

    io.to(socket.id).emit("player-state-reset", {
      playerNumber: normalizedPlayerNumber,
      oldLife,
      newLife: 20
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

restoreActiveTournamentFromSupabase().catch(error => {
  console.error("[SUPABASE] Active tournament restore failed:", error.message);
}).finally(() => {
  server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
});
