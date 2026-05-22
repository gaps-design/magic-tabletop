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

function emitConvesState() {
  io.emit("conves-state", Object.values(connectedUsers));
}

function buildLobbyState() {
  return PUBLIC_TABLES.map(roomId => {
    const room = rooms[roomId];
    const players = room?.players?.length || 0;
    const spectators = room?.spectators?.length || 0;
    const cameras = room?.cameraClients?.length || 0;
    const isResenha = isResenhaRoom(roomId);

    return {
      roomId,
      format: room?.format || (isResenha ? "Mesa da Resenha" : "Formato livre"),
      players,
      spectators,
      cameras,
      isResenha,
      isFull: !isResenha && players >= 2
    };
  });
}

function broadcastLobbyState() {
  io.emit("lobby-state", buildLobbyState());
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
    format: room.format,
    diceRolls: room.diceRolls,
    micStatus: room.micStatus
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
    micEnabled: profile.micEnabled !== false
  };
}

function getPlayerBySocket(room, socketId) {
  return room.players.find(p => p.socketId === socketId);
}

function isPlayerInRoom(room, socketId) {
  return room.players.some(p => p.socketId === socketId);
}

function setConnectedUser(socketId, user, status = "idle", roomId = null, role = "idle", playerNumber = null) {
  if (!user || !user.uid) return;

  connectedUsers[socketId] = {
    socketId,
    uid: user.uid,
    name: user.name || "Usuário",
    email: user.email || "",
    photo: user.photo || "",
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

function addSpectator(socket, roomId, name, reason = "") {
  const room = ensureRoom(roomId);

  if (!room.spectators.includes(socket.id)) {
    room.spectators.push(socket.id);
  }

  clientProfiles[socket.id] = {
    role: "spectator",
    name,
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
        name: p.name
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
    name
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

  socket.on("user-online", (user) => {
    setConnectedUser(socket.id, user, "idle", null, "idle", null);
  });

  socket.on("join-room", (data = {}) => {
    const roomId = data.roomId;
    if (!roomId) return;

    removeSocketFromAllRooms(socket.id);

    const user = data.user || {};
    const role = data.role || user.role || "player";
    const name = data.name || user.name || "Usuário";
    const deck = data.deck || user.deck || "---";
    const guild = data.guild || user.guild || "---";
    const linkedPlayer = Number(data.linkedPlayer || user.linkedPlayer || data.cameraFor || user.cameraFor || 0);
    const incomingFormat = data.format || "";

    if (user?.uid) {
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
      addSpectator(socket, roomId, name, "spectator-choice");
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
        name
      });

      clientProfiles[socket.id] = {
        role: "camera",
        linkedPlayer,
        name,
        micEnabled: true
      };

      updateConnectedUser(socket.id, {
        status: "camera",
        role: "camera",
        roomId,
        playerNumber: linkedPlayer
      });

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
            name: p.name
          })),
          ...room.spectators.map(id => ({
            socketId: id,
            role: "spectator",
            name: clientProfiles[id]?.name || "Espectador"
          }))
        ]
      });

      socket.to(roomId).emit("user-connected", {
        socketId: socket.id,
        role: "camera",
        linkedPlayer,
        name
      });

      sendRoomState(roomId);
      broadcastLobbyState();
      emitConvesState();
      return;
    }

    if (!isResenhaRoom(roomId) && room.players.length >= 2) {
      addSpectator(socket, roomId, name, "room-full");
      return;
    }

    const usedNumbers = room.players.map(p => Number(p.playerNumber));
    let playerNumber = 1;

    while (usedNumbers.includes(playerNumber)) {
      playerNumber++;
    }

    const player = {
      socketId: socket.id,
      playerNumber,
      name,
      deck,
      guild,
      life: 20
    };

    room.players.push(player);

    clientProfiles[socket.id] = {
      role: "player",
      playerNumber,
      name,
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
            name: p.name
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
          name: clientProfiles[id]?.name || "Espectador"
        }))
      ]
    });

    socket.to(roomId).emit("user-connected", {
      socketId: socket.id,
      role: "player",
      playerNumber,
      name
    });

    sendRoomState(roomId);
    broadcastLobbyState();
    emitConvesState();
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

    io.to(roomId).emit("chat-message", {
      name: clientProfiles[socket.id]?.name || "Usuário",
      message: safeMessage,
      type: type === "emoji" ? "emoji" : "text",
      time: new Date().toLocaleTimeString("pt-BR")
    });

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
    emitConvesState();
    broadcastLobbyState();
  });

  socket.on("disconnect", () => {
    console.log("Desconectado:", socket.id);

    delete connectedUsers[socket.id];
    emitConvesState();

    removeSocketFromAllRooms(socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});