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
const chatCooldown = {};
const CHAT_COOLDOWN_MS = 5000;

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
    timer: publicTimer(room.timer)
  });
}

function getClientInfo(socketId) {
  for (const roomId in rooms) {
    const room = rooms[roomId];

    const player = room.players.find(p => p.socketId === socketId);
    if (player) {
      return {
        roomId,
        role: "player",
        playerNumber: player.playerNumber
      };
    }

    const camera = room.cameraClients.find(c => c.socketId === socketId);
    if (camera) {
      return {
        roomId,
        role: "camera",
        linkedPlayer: camera.linkedPlayer
      };
    }

    if (room.spectators.includes(socketId)) {
      return {
        roomId,
        role: "spectator"
      };
    }
  }

  return null;
}

function getPlayerBySocket(room, socketId) {
  return room.players.find(p => p.socketId === socketId);
}

function isPlayerInRoom(room, socketId) {
  return room.players.some(p => p.socketId === socketId);
}

function removeSocketFromAllRooms(socketId) {
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
      io.to(roomId).emit("user-disconnected", socketId);
      sendRoomState(roomId);
    }

    if (
      room.players.length === 0 &&
      room.spectators.length === 0 &&
      room.cameraClients.length === 0
    ) {
      if (room.timer?.interval) clearInterval(room.timer.interval);
      delete rooms[roomId];
    }
  }

  delete chatCooldown[socketId];
}

io.on("connection", (socket) => {
  console.log("Conectado:", socket.id);

  socket.on("join-room", (data = {}) => {
    const roomId = data.roomId;
    if (!roomId) return;

    removeSocketFromAllRooms(socket.id);

    const user = data.user || {};
    const role = data.role || user.role || "player";
    const name = data.name || user.name || "Jogador";
    const deck = data.deck || user.deck || "Deck não informado";
    const guild = data.guild || user.guild || "---";
    const linkedPlayer = Number(data.linkedPlayer || user.linkedPlayer || 0);

    const room = ensureRoom(roomId);
    socket.join(roomId);

    if (role === "spectator") {
      room.spectators.push(socket.id);

      socket.emit("assigned-role", {
        role: "spectator"
      });

      socket.emit("existing-peers", {
        peers: [
          ...room.players.map(p => ({
            socketId: p.socketId,
            role: "player",
            playerNumber: p.playerNumber
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
        role: "spectator"
      });

      sendRoomState(roomId);
      return;
    }

    if (role === "camera") {
      if (![1, 2].includes(linkedPlayer)) {
        socket.emit("camera-error", "Jogador inválido para câmera.");
        socket.leave(roomId);
        return;
      }

      room.cameraClients = room.cameraClients.filter(
        c => Number(c.linkedPlayer) !== linkedPlayer
      );

      const cameraData = {
        socketId: socket.id,
        linkedPlayer
      };

      room.cameraClients.push(cameraData);

      socket.emit("assigned-role", {
        role: "camera",
        linkedPlayer
      });

      socket.emit("existing-peers", {
        peers: [
          ...room.players.map(p => ({
            socketId: p.socketId,
            role: "player",
            playerNumber: p.playerNumber
          })),
          ...room.spectators.map(id => ({
            socketId: id,
            role: "spectator"
          }))
        ]
      });

      socket.to(roomId).emit("user-connected", {
        socketId: socket.id,
        role: "camera",
        linkedPlayer
      });

      sendRoomState(roomId);
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("room-full");
      socket.leave(roomId);
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
            playerNumber: p.playerNumber
          })),
        ...room.cameraClients.map(c => ({
          socketId: c.socketId,
          role: "camera",
          linkedPlayer: c.linkedPlayer
        })),
        ...room.spectators.map(id => ({
          socketId: id,
          role: "spectator"
        }))
      ]
    });

    socket.to(roomId).emit("user-connected", {
      socketId: socket.id,
      role: "player",
      playerNumber
    });

    sendRoomState(roomId);
  });

  socket.on("offer", ({ target, offer }) => {
    if (!target || !offer) return;

    const senderInfo = getClientInfo(socket.id);

    io.to(target).emit("offer", {
      offer,
      sender: socket.id,
      senderInfo
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

    io.to(roomId).emit("timer-update", publicTimer(room.timer));
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

  socket.on("chat-message", ({ roomId, name, message, type }) => {
    const room = rooms[roomId];
    if (!room) return;

    const inside =
      room.players.some(p => p.socketId === socket.id) ||
      room.spectators.includes(socket.id);

    if (!inside) return;

    const now = Date.now();
    const last = chatCooldown[socket.id] || 0;

    if (now - last < CHAT_COOLDOWN_MS) {
      socket.emit("chat-cooldown", {
        remaining: Math.ceil((CHAT_COOLDOWN_MS - (now - last)) / 1000)
      });
      return;
    }

    chatCooldown[socket.id] = now;

    const safeMessage = String(message || "").trim().slice(0, 120);
    if (!safeMessage) return;

    io.to(roomId).emit("chat-message", {
      name: String(name || "Usuário").slice(0, 30),
      message: safeMessage,
      type: type === "emoji" ? "emoji" : "text",
      time: new Date().toLocaleTimeString("pt-BR")
    });
  });

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