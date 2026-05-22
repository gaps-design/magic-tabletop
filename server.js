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

const CHAT_LIMIT = 5;
const CHAT_BLOCK_MS = 3000;

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
      lifeHistory: [],
      format: isResenhaRoom(roomId) ? "Mesa da Resenha" : "",
      timer: createDefaultTimer(),
      diceRolls: [],
      micStatus: {}
    };
  }

  return rooms[roomId];
}

function setConnectedUser(socketId, user, status = "idle", roomId = null, role = "idle", playerNumber = null) {
  const profile = normalizeUser(user);

  if (!profile.uid && !profile.email) return;

  connectedUsers[socketId] = {
    socketId,
    uid: profile.uid,
    name: profile.name,
    email: profile.email,
    photo: profile.photo,
    status,
    roomId,
    role,
    playerNumber
  };

  emitConvesState();
}

function updateConnectedUser(socketId, data = {}) {
  if (!connectedUsers[socketId]) return;

  connectedUsers[socketId] = {
    ...connectedUsers[socketId],
    ...data
  };

  emitConvesState();
}

function emitConvesState() {
  io.emit("conves-state", Object.values(connectedUsers));
}

function buildLobbyState() {
  return PUBLIC_TABLES.map(roomId => {
    const room = rooms[roomId];
    const isResenha = isResenhaRoom(roomId);

    const players = room?.players?.length || 0;
    const spectators = room?.spectators?.length || 0;
    const cameras = room?.cameraClients?.length || 0;

    return {
      roomId,
      format: room?.format || (isResenha ? "Mesa da Resenha" : "Formato livre"),
      players,
      spectators,
      cameras,
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
      name: c.name || "Câmera"
    }))
  };
}

function sendRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("room-state", {
    players: room.players,
    spectators: room.spectators.length,
    cameraClients: room.cameraClients,
    lifeHistory: room.lifeHistory,
    timer: publicTimer(room.timer),
    format: room.format || "Formato livre",
    diceRolls: room.diceRolls,
    micStatus: room.micStatus,
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
    micEnabled: profile.micEnabled !== false
  };
}

function getPlayerBySocket(room, socketId) {
  return room.players.find(p => p.socketId === socketId);
}

function isPlayerInRoom(room, socketId) {
  return room.players.some(p => p.socketId === socketId);
}

function resetPublicRoomIfEmpty(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const empty =
    room.players.length === 0 &&
    room.spectators.length === 0 &&
    room.cameraClients.length === 0;

  if (!empty) return;

  if (room.timer?.interval) {
    clearInterval(room.timer.interval);
  }

  if (PUBLIC_TABLES.includes(roomId)) {
    rooms[roomId] = {
      players: [],
      spectators: [],
      cameraClients: [],
      lifeHistory: [],
      format: isResenhaRoom(roomId) ? "Mesa da Resenha" : "",
      timer: createDefaultTimer(),
      diceRolls: [],
      micStatus: {}
    };
  } else {
    delete rooms[roomId];
  }
}

function addSpectator(socket, roomId, user, reason = "") {
  const room = ensureRoom(roomId);
  const profile = normalizeUser(user);

  if (!room.spectators.includes(socket.id)) {
    room.spectators.push(socket.id);
  }

  clientProfiles[socket.id] = {
    role: "spectator",
    name: profile.name,
    email: profile.email,
    photo: profile.photo,
    micEnabled: true
  };

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

  io.to(roomId).emit("system-event", {
    type: "spectator-joined",
    message: `👁️ ${profile.name} entrou como espectador.`,
    time: new Date().toLocaleTimeString("pt-BR")
  });

  sendRoomState(roomId);
  broadcastLobbyState();
}

function removeSocketFromAllRooms(socketId) {
  let changedLobby = false;

  for (const roomId in rooms) {
    const room = rooms[roomId];

    const wasInside =
      room.players.some(p => p.socketId === socketId) ||
      room.spectators.includes(socketId) ||
      room.cameraClients.some(c => c.socketId === socketId);

    if (!wasInside) continue;

    room.players = room.players.filter(p => p.socketId !== socketId);
    room.spectators = room.spectators.filter(id => id !== socketId);
    room.cameraClients = room.cameraClients.filter(c => c.socketId !== socketId);
    room.diceRolls = room.diceRolls.filter(r => r.socketId !== socketId);

    delete room.micStatus[socketId];

    io.to(roomId).emit("user-disconnected", socketId);

    sendRoomState(roomId);
    changedLobby = true;

    resetPublicRoomIfEmpty(roomId);
  }

  delete chatControl[socketId];
  delete clientProfiles[socketId];

  if (changedLobby) {
    broadcastLobbyState();
  }
}

io.on("connection", (socket) => {
  console.log("Conectado:", socket.id);

  socket.emit("lobby-state", buildLobbyState());
  socket.emit("conves-state", Object.values(connectedUsers));

  socket.on("user-online", (user = {}) => {
    const profile = normalizeUser(user);
    setConnectedUser(socket.id, profile, "idle", null, "idle", null);
    broadcastLobbyState();
  });

  socket.on("user-logout", () => {
    removeSocketFromAllRooms(socket.id);
    delete connectedUsers[socket.id];

    socket.emit("force-home", {
      reason: "logout"
    });

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
    const linkedPlayer = Number(data.linkedPlayer || data.cameraFor || 0);
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
        name: `Câmera Jogador ${linkedPlayer}`
      });

      clientProfiles[socket.id] = {
        role: "camera",
        linkedPlayer,
        name: `Câmera Jogador ${linkedPlayer}`,
        photo: "/assets/default-avatar.png",
        micEnabled: true
      };

      room.micStatus[socket.id] = true;

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
      life: 20
    };

    room.players.push(player);

    clientProfiles[socket.id] = {
      role: "player",
      playerNumber,
      name,
      email: user.email,
      photo: user.photo,
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
      playerNumber
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

    sendRoomState(roomId);
    broadcastLobbyState();
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

    io.to(roomId).emit("mic-status-update", {
      socketId: socket.id,
      micEnabled: !!micEnabled,
      info: getClientInfo(socket.id)
    });

    sendRoomState(roomId);
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
    updateConnectedUser(socket.id, {
      status: "idle",
      role: "idle",
      roomId: null,
      playerNumber: null
    });

    removeSocketFromAllRooms(socket.id);

    if (roomId) {
      socket.leave(roomId);
    }

    socket.emit("left-room");
    broadcastLobbyState();
  });

  socket.on("disconnect", () => {
    console.log("Desconectado:", socket.id);

    delete connectedUsers[socket.id];
    removeSocketFromAllRooms(socket.id);
    broadcastLobbyState();
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});