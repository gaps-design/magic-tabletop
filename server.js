const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

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

function sendRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("room-state", {
    players: room.players,
    spectators: room.spectators.length,
    cameraClients: room.cameraClients || [],
    lifeHistory: room.lifeHistory || [],
    timer: publicTimer(room.timer)
  });
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

function removeSocketFromRoom(roomId, socketId) {
  const room = rooms[roomId];
  if (!room) return false;

  const wasPlayer = room.players.some(p => p.socketId === socketId);
  const wasSpectator = room.spectators.includes(socketId);
  const wasCamera = room.cameraClients.some(c => c.socketId === socketId);

  room.players = room.players.filter(p => p.socketId !== socketId);
  room.spectators = room.spectators.filter(id => id !== socketId);
  room.cameraClients = room.cameraClients.filter(c => c.socketId !== socketId);

  return wasPlayer || wasSpectator || wasCamera;
}

function cleanEmptyRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  if (
    room.players.length === 0 &&
    room.spectators.length === 0 &&
    room.cameraClients.length === 0
  ) {
    if (room.timer?.interval) {
      clearInterval(room.timer.interval);
    }

    delete rooms[roomId];
  }
}

io.on("connection", (socket) => {
  console.log("Usuário conectado:", socket.id);

  socket.on("join-room", (data) => {
    const roomId = data.roomId;
    const role = data.role || data.user?.role;
    const name = data.name || data.user?.name || "Jogador";
    const deck = data.deck || data.user?.deck || "Deck não informado";
    const guild = data.guild || data.user?.guild || "---";
    const linkedPlayer = Number(data.linkedPlayer || data.user?.linkedPlayer);

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

      sendRoomState(roomId);
      console.log(`Espectador entrou na sala ${roomId}`);
      return;
    }

    if (role === "camera") {
      room.cameraClients.push({
        socketId: socket.id,
        linkedPlayer: linkedPlayer || null
      });

      socket.emit("assigned-role", {
        role: "camera",
        linkedPlayer: linkedPlayer || null
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
        linkedPlayer: linkedPlayer || null
      });

      sendRoomState(roomId);
      console.log(`Câmera auxiliar entrou na sala ${roomId}`);
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("room-full");
      return;
    }

    const playerNumber = room.players.length + 1;

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

    console.log(`Jogador ${playerNumber} entrou na sala ${roomId}`);
  });

  socket.on("offer", ({ target, offer }) => {
    io.to(target).emit("offer", {
      offer,
      sender: socket.id
    });
  });

  socket.on("answer", ({ target, answer }) => {
    io.to(target).emit("answer", {
      answer,
      sender: socket.id
    });
  });

  socket.on("ice-candidate", ({ target, candidate }) => {
    io.to(target).emit("ice-candidate", {
      candidate,
      sender: socket.id
    });
  });

  socket.on("change-life", ({ roomId, playerNumber, amount }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find(p => p.playerNumber === playerNumber);
    if (!player) return;
    if (player.socketId !== socket.id) return;

    const oldLife = player.life;
    player.life += Number(amount);

    room.lifeHistory.unshift({
      playerNumber,
      playerName: player.name,
      oldLife,
      newLife: player.life,
      change: Number(amount),
      time: new Date().toLocaleTimeString("pt-BR")
    });

    sendRoomState(roomId);
  });

  socket.on("set-life", ({ roomId, playerNumber, value }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find(p => p.playerNumber === playerNumber);
    if (!player) return;
    if (player.socketId !== socket.id) return;

    const newLife = Number(value);
    if (isNaN(newLife)) return;

    const oldLife = player.life;
    player.life = newLife;

    room.lifeHistory.unshift({
      playerNumber,
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

    const player = room.players.find(p => p.playerNumber === playerNumber);
    if (!player) return;
    if (player.socketId !== socket.id) return;

    const oldLife = player.life;
    player.life = 20;

    room.lifeHistory.unshift({
      playerNumber,
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
    if (!room || room.timer.running) return;

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

    room.lifeHistory = [];
    sendRoomState(roomId);
  });

  socket.on("leave-room", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const removed = removeSocketFromRoom(roomId, socket.id);

    socket.leave(roomId);
    socket.emit("left-room");

    if (removed) {
      socket.to(roomId).emit("user-disconnected", socket.id);
      sendRoomState(roomId);
    }

    cleanEmptyRoom(roomId);
  });

  socket.on("disconnect", () => {
    console.log("Usuário desconectado:", socket.id);

    for (const roomId in rooms) {
      const removed = removeSocketFromRoom(roomId, socket.id);

      if (removed) {
        socket.to(roomId).emit("user-disconnected", socket.id);
        sendRoomState(roomId);
      }

      cleanEmptyRoom(roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});