const createPrivateRoomButton = document.getElementById("createPrivateRoom");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomCodeInput = document.getElementById("roomCodeInput");
const enterTableButtons = document.querySelectorAll(".enter-table-btn");
const refreshRoomsButton = document.getElementById("refreshRooms");

const formatModal = document.getElementById("formatModal");
const formatSelect = document.getElementById("formatSelect");
const confirmFormat = document.getElementById("confirmFormat");
const cancelFormat = document.getElementById("cancelFormat");

let selectedRoomId = null;
let lobbyTables = {};

function normalizeRoomCode(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function enterRoom(roomId, format = "Formato livre", role = "player") {
  if (!window.requireLogin || !window.requireLogin()) return;

  if (!roomId) {
    alert("Digite o código da mesa.");
    return;
  }

  const url =
    `/sala.html?room=${roomId}&format=${encodeURIComponent(format)}&role=${role}`;

  window.open(url, "_blank");
}

function openFormatModal(roomId) {
  selectedRoomId = roomId;
  formatModal.classList.add("active");
}

function closeFormatModal() {
  selectedRoomId = null;
  formatModal.classList.remove("active");
}

createPrivateRoomButton.addEventListener("click", () => {
  if (!window.requireLogin || !window.requireLogin()) return;

  const randomCode =
    "private-" + Math.floor(100000 + Math.random() * 900000);

  openFormatModal(randomCode);
});

joinRoomBtn.addEventListener("click", () => {
  const roomId = normalizeRoomCode(roomCodeInput.value);

  if (!roomId) {
    alert("Digite o código da mesa.");
    return;
  }

  const table = lobbyTables[roomId];

  if (table?.isFull) {
    enterRoom(roomId, table.format || "Formato livre", "spectator");
    return;
  }

  if (table?.players > 0) {
    enterRoom(roomId, table.format || "Formato livre", "player");
    return;
  }

  openFormatModal(roomId);
});

roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRoomBtn.click();
  }
});

enterTableButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".room-card");
    const roomId = card.dataset.room;
    const table = lobbyTables[roomId];
    const isResenha = card.dataset.special === "resenha";

    if (isResenha) {
      enterRoom(roomId, "Mesa da Resenha", "player");
      return;
    }

    if (table?.isFull) {
      enterRoom(roomId, table.format || "Formato livre", "spectator");
      return;
    }

    if (table?.players > 0) {
      enterRoom(roomId, table.format || "Formato livre", "player");
      return;
    }

    openFormatModal(roomId);
  });
});

confirmFormat.addEventListener("click", () => {
  if (!selectedRoomId) return;

  const selectedFormat = formatSelect.value;

  enterRoom(selectedRoomId, selectedFormat, "player");
});

cancelFormat.addEventListener("click", () => {
  closeFormatModal();
});

formatModal.addEventListener("click", (event) => {
  if (event.target === formatModal) {
    closeFormatModal();
  }
});

refreshRoomsButton.addEventListener("click", () => {
  window.location.reload();
});

/* =========================
   SOCKET LOBBY
========================= */

const socket = io();

auth.onAuthStateChanged((user) => {
  if (!user) return;

  socket.emit("user-online", {
    uid: user.uid,
    name: user.displayName,
    email: user.email,
    photo: user.photoURL
  });
});

socket.on("lobby-state", (tables) => {
  if (!Array.isArray(tables)) return;

  tables.forEach((table) => {
    lobbyTables[table.roomId] = table;

    const card =
      document.querySelector(`[data-room="${table.roomId}"]`);

    if (!card) return;

    const formatBadge =
      card.querySelector(".format-badge");

    if (formatBadge) {
      formatBadge.innerText =
        table.format || "Formato livre";
    }

    const strongs =
      card.querySelectorAll(".room-info strong");

    if (table.isResenha) {
      if (strongs[0]) strongs[0].innerText = `${table.cameras}/2`;
      if (strongs[1]) strongs[1].innerText = table.players;
      if (strongs[2]) strongs[2].innerText = table.spectators;
    } else {
      if (strongs[0]) strongs[0].innerText = `${table.players}/2`;
      if (strongs[1]) strongs[1].innerText = table.spectators;
    }

    const button =
      card.querySelector(".enter-table-btn");

    if (!button) return;

    if (!table.isResenha && table.isFull) {
      card.classList.add("table-full");
      button.classList.add("full-btn");
      button.innerText = "Sala cheia — assistir 👁️";
    } else {
      card.classList.remove("table-full");
      button.classList.remove("full-btn");

      if (table.isResenha) {
        button.innerText = "Entrar na resenha →";
      } else {
        button.innerText = "Entrar na mesa →";
      }
    }
  });
});
function sendUserToConves() {
  setTimeout(() => {
    if (!window.getLoggedUserProfile) return;

    const user = window.getLoggedUserProfile();
    if (!user) return;

    socket.emit("user-online", user);
  }, 1200);
}

sendUserToConves();

socket.on("conves-state", (users) => {
  renderConves(users);
});

function renderConves(users = []) {
  const totalOnline = document.getElementById("convesOnline");
  const totalTables = document.getElementById("convesTables");
  const totalSpectators = document.getElementById("convesSpectators");

  const proaList = document.getElementById("proaList");
  const convesList = document.getElementById("convesList");
  const calaboucoList = document.getElementById("calaboucoList");

  if (!totalOnline) return;

  const players = users.filter(u => u.role === "player");
  const spectators = users.filter(u => u.role === "spectator");
  const idle = users.filter(u => u.role === "idle");

  const occupiedRooms = new Set(
    players
      .filter(u => u.roomId)
      .map(u => u.roomId)
  );

  totalOnline.innerText = users.length;
  totalTables.innerText = occupiedRooms.size;
  totalSpectators.innerText = spectators.length;

  proaList.innerHTML = renderUserList(players, "⚔️");
  convesList.innerHTML = renderUserList(spectators, "👁️");
  calaboucoList.innerHTML = renderUserList(idle, "⛓️");
}

function renderUserList(list, icon) {
  if (!list.length) {
    return `<p class="empty-conves">Ninguém por aqui...</p>`;
  }

  return list.map(user => `
    <div class="conves-user">
      <img src="${user.photo || "assets/default-avatar.png"}" alt="Perfil">
      <div>
        <strong>${icon} ${user.name || "Usuário"}</strong>
        <span>${user.roomId ? user.roomId.toUpperCase() : "No porto"}</span>
      </div>
    </div>
  `).join("");
}

const convesCard = document.getElementById("convesCard");
const convesModal = document.getElementById("convesModal");
const closeConves = document.getElementById("closeConves");

if (convesCard) {
  convesCard.addEventListener("click", () => {
    convesModal.classList.add("active");
convesModal.classList.remove("hidden");
  });
}

if (closeConves) {
  closeConves.addEventListener("click", () => {
    convesModal.classList.remove("active");
convesModal.classList.add("hidden");
  });
}

if (convesModal) {
  convesModal.addEventListener("click", (event) => {
    if (event.target === convesModal) {
      convesModal.classList.remove("active");
    }
  });
}

if (convesButton) {

    convesButton.addEventListener("click", () => {

        convesModal.classList.remove("hidden");

    });

}

if (convesModal) {

    convesModal.addEventListener("click", (e) => {

        if (e.target === convesModal) {

            convesModal.classList.add("hidden");

        }

    });

}

socket.on("conves-state", (users) => {

    if (!Array.isArray(users)) return;

    onlineCount.innerText =
        `${users.length} online`;

    const players =
        users.filter(u => u.role === "player");

    const spectators =
        users.filter(u => u.role === "spectator");

    const idle =
        users.filter(u => u.role === "idle");

    const occupiedRooms =
        [...new Set(players.map(p => p.roomId))];

    tableCount.innerText =
        `${occupiedRooms.length} mesas`;

    spectatorCount.innerText =
        `${spectators.length} espectadores`;

    playersDeck.innerHTML = "";
    spectatorsDeck.innerHTML = "";
    idleDeck.innerHTML = "";

    players.forEach(user => {

        playersDeck.innerHTML += `
            <div class="conves-user">

                <img src="${user.photo}" />

                <div>
                    <strong>${user.name}</strong>
                    <p>Mesa: ${user.roomId}</p>
                </div>

            </div>
        `;

    });

    spectators.forEach(user => {

        spectatorsDeck.innerHTML += `
            <div class="conves-user">

                <img src="${user.photo}" />

                <div>
                    <strong>${user.name}</strong>
                    <p>Assistindo</p>
                </div>

            </div>
        `;

    });

    idle.forEach(user => {

        idleDeck.innerHTML += `
            <div class="conves-user">

                <img src="${user.photo}" />

                <div>
                    <strong>${user.name}</strong>
                    <p>Online no lobby</p>
                </div>

            </div>
        `;

    });

});