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
    lifeHistory: room.lifeHistory || [],
    timer: publicTimer(room.timer)
  });
}

io.on("connection", (socket) => {
  console.log("Usuário conectado:", socket.id);

  socket.on("join-room", (data) => {
    const roomId = data.roomId;
    const role = data.role || data.user?.role;
    const name = data.name || data.user?.name || "Jogador";
    const deck = data.deck || data.user?.deck || "Deck não informado";
    const guild = data.guild || data.user?.guild || "---";

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        spectators: [],
        lifeHistory: [],
        timer: createDefaultTimer()
      };
    }

    const room = rooms[roomId];

    if (role === "spectator") {
      room.spectators.push(socket.id);
      socket.join(roomId);

      socket.emit("assigned-role", {
        role: "spectator"
      });

      sendRoomState(roomId);
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
    socket.join(roomId);

    socket.emit("assigned-role", {
      role: "player",
      playerNumber
    });

    sendRoomState(roomId);

    console.log(`Jogador ${playerNumber} entrou na sala ${roomId}`);
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

    room.players = room.players.filter(p => p.socketId !== socket.id);
    room.spectators = room.spectators.filter(id => id !== socket.id);

    socket.leave(roomId);
    socket.emit("left-room");

    sendRoomState(roomId);

    if (room.players.length === 0 && room.spectators.length === 0) {
      if (room.timer?.interval) {
        clearInterval(room.timer.interval);
      }

      delete rooms[roomId];
    }
  });

  socket.on("disconnect", () => {
    console.log("Usuário desconectado:", socket.id);

    for (const roomId in rooms) {
      const room = rooms[roomId];

      room.players = room.players.filter(p => p.socketId !== socket.id);
      room.spectators = room.spectators.filter(id => id !== socket.id);

      sendRoomState(roomId);

      if (room.players.length === 0 && room.spectators.length === 0) {
        if (room.timer?.interval) {
          clearInterval(room.timer.interval);
        }

        delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});