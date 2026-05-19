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

const CHAT_LIMIT = 5;
const CHAT_BLOCK_MS = 3000;

const PUBLIC_TABLES = [
  "mtg-1001", "mtg-1002", "mtg-1003", "mtg-1004", "mtg-1005",
  "mtg-1006", "mtg-1007", "mtg-1008", "mtg-1009", "mtg-1010", "mtg-1011"
];

function buildLobbyState() {
  return PUBLIC_TABLES.map(roomId => {
    const room = rooms[roomId];

    return {
      roomId,
      format: room?.format || (roomId === "mtg-1002" ? "Mesa da Resenha" : "Formato livre"),
      players: room?.players?.length || 0,
      spectators: room?.spectators?.length || 0,
      cameras: room?.cameraClients?.length || 0,
      isResenha: roomId === "mtg-1002"
    };
  });
}

function broadcastLobbyState() {
  io.emit("lobby-state", buildLobbyState());
}

/* =========================
   TIMER
========================= */

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

/* =========================
   ROOM
========================= */

function ensureRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      players: [],
      spectators: [],
      cameraClients: [],
      lifeHistory: [],
      format: roomId === "mtg-1002" ? "Mesa da Resenha" : "",
      timer: createDefaultTimer()
    };
  }

  return rooms[roomId];
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
    format: room.format
  });
}

/* =========================
   CLIENT INFO
========================= */

function getClientInfo(socketId) {
  const profile = clientProfiles[socketId];

  if (!profile) return null;

  return {
    role: profile.role,
    playerNumber: profile.playerNumber,
    linkedPlayer: profile.linkedPlayer,
    name: profile.name
  };
}

function getPlayerBySocket(room, socketId) {
  return room.players.find(p => p.socketId === socketId);
}

function isPlayerInRoom(room, socketId) {
  return room.players.some(p => p.socketId === socketId);
}

/* =========================
   REMOVE USER
========================= */

function removeSocketFromAllRooms(socketId) {
  let changedLobby = false;

  for (const roomId in rooms) {
    const room = rooms[roomId];

    const wasInside =
      room.players.some(p => p.socketId === socketId) ||
      room.spectators.includes(socketId) ||
      room.cameraClients.some(c => c.socketId === socketId);

    room.players = room.players.filter(p => p.socketId !== socketId);
    room.spectators = room.spectators.filter(id => id !== socketId);
    room.cameraClients = room.cameraClients.filter(c => c.socketId !== socketId);

    if (wasInside) {
      changedLobby = true;

      io.to(roomId).emit("user-disconnected", socketId);

      sendRoomState(roomId);
    }

    if (
      room.players.length === 0 &&
      room.spectators.length === 0 &&
      room.cameraClients.length === 0
    ) {
      if (room.timer?.interval) {
        clearInterval(room.timer.interval);
      }

      delete rooms[roomId];
      changedLobby = true;
    }
  }

  delete chatControl[socketId];
  delete clientProfiles[socketId];

  if (changedLobby) {
    broadcastLobbyState();
  }
}

/* =========================
   SOCKET CONNECTION
========================= */

io.on("connection", (socket) => {
  console.log("Conectado:", socket.id);

  socket.emit("lobby-state", buildLobbyState());

  /* =========================
     JOIN ROOM
  ========================= */

  socket.on("join-room", (data = {}) => {
    const roomId = data.roomId;
    if (!roomId) return;

    removeSocketFromAllRooms(socket.id);

    const user = data.user || {};

    const role = data.role || user.role || "player";
    const name = data.name || user.name || "Usuário";
    const deck = data.deck || user.deck || "---";
    const guild = data.guild || user.guild || "---";
    const linkedPlayer = Number(data.linkedPlayer || user.linkedPlayer || 0);

    const room = ensureRoom(roomId);

    if (data.format && !room.format) {
      room.format = data.format;
    }

    socket.join(roomId);

    /* =========================
       SPECTATOR
    ========================= */

    if (role === "spectator") {
      room.spectators.push(socket.id);

      clientProfiles[socket.id] = {
        role: "spectator",
        name
      };

      socket.emit("assigned-role", {
        role: "spectator"
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
            linkedPlayer: c.linkedPlayer
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

      return;
    }

    /* =========================
       CAMERA
    ========================= */

    if (role === "camera") {
      if (![1, 2].includes(linkedPlayer)) {
        socket.emit("camera-error", "Jogador inválido.");
        return;
      }

      room.cameraClients =
        room.cameraClients.filter(c => Number(c.linkedPlayer) !== linkedPlayer);

      room.cameraClients.push({
        socketId: socket.id,
        linkedPlayer
      });

      clientProfiles[socket.id] = {
        role: "camera",
        linkedPlayer,
        name
      };

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
          }))
        ]
      });

      socket.to(roomId).emit("user-connected", {
        socketId: socket.id,
        role: "camera",
        linkedPlayer
      });

      sendRoomState(roomId);
      broadcastLobbyState();

      return;
    }

    /* =========================
       PLAYER
    ========================= */

    if (room.players.length >= 2) {
      socket.emit("room-full");
      return;
    }

    const usedNumbers = room.players.map(p => p.playerNumber);
    const playerNumber = usedNumbers.includes(1) ? 2 : 1;

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
      name
    };

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
          linkedPlayer: c.linkedPlayer
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
  });

  /* =========================
     WEBRTC
  ========================= */

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

  /* =========================
     CHAT
  ========================= */

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

  /* =========================
     LIFE
  ========================= */

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

  /* =========================
     TIMER
  ========================= */

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
    broadcastLobbyState();
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

  /* =========================
     HISTORY
  ========================= */

  socket.on("clear-life-history", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (!isPlayerInRoom(room, socket.id)) return;

    room.lifeHistory = [];

    sendRoomState(roomId);
    broadcastLobbyState();
  });

  /* =========================
     LEAVE
  ========================= */

  socket.on("leave-room", ({ roomId }) => {
    removeSocketFromAllRooms(socket.id);
    socket.leave(roomId);
    socket.emit("left-room");
  });

  socket.on("disconnect", () => {
    console.log("Desconectado:", socket.id);
    removeSocketFromAllRooms(socket.id);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});