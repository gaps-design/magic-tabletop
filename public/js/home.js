const createPrivateRoomButton = document.getElementById("createPrivateRoom");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomCodeInput = document.getElementById("roomCodeInput");
const enterTableButtons = document.querySelectorAll(".enter-table-btn");
const refreshRoomsButton = document.getElementById("refreshRooms");

const formatModal = document.getElementById("formatModal");
const formatSelect = document.getElementById("formatSelect");
const confirmFormat = document.getElementById("confirmFormat");
const cancelFormat = document.getElementById("cancelFormat");

const convesCard = document.getElementById("convesCard");
const convesModal = document.getElementById("convesModal");
const closeConves = document.getElementById("closeConves");

if (joinRoomBtn) joinRoomBtn.innerText = "Entrar na Sala";
if (createPrivateRoomButton) createPrivateRoomButton.innerText = "Criar Sala Privada";
document.querySelector('[data-presence-count="conves"]')?.previousElementSibling?.replaceChildren("Online");
document.querySelector('[data-presence-count="calabouco"]')?.previousElementSibling?.replaceChildren("Jogando");
document.querySelector('[data-presence-count="proa"]')?.previousElementSibling?.replaceChildren("Assistindo");
document.querySelectorAll('a[href="/nao-afiliacao.html"]').forEach(link => {
  link.innerText = "Aviso Legal";
});

let selectedRoomId = null;
let lobbyTables = {};
let lastOnlineUid = null;
let hasHandledHomeLogout = false;

const socket = io();

function normalizeRoomCode(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
}

function checkLoginBeforeAction() {
  if (!window.requireLogin || !window.requireLogin()) {
    return false;
  }

  return true;
}

function enterRoom(roomId, format = "Formato livre", role = "player") {
  if (!checkLoginBeforeAction()) return;

  if (!roomId) {
    alert("Digite o código da mesa.");
    return;
  }

  const url = `/sala.html?room=${encodeURIComponent(roomId)}&format=${encodeURIComponent(format)}&role=${encodeURIComponent(role)}`;
  window.open(url, "_blank");
}

function openFormatModal(roomId) {
  if (!checkLoginBeforeAction()) return;

  selectedRoomId = roomId;

  if (formatModal) {
    formatModal.classList.add("active");
    formatModal.classList.remove("hidden");
  }
}

function closeFormatModal() {
  selectedRoomId = null;

  if (formatModal) {
    formatModal.classList.remove("active");
    formatModal.classList.add("hidden");
  }
}

function handleEnterTable(roomId, isResenha = false) {
  if (!checkLoginBeforeAction()) return;

  const table = lobbyTables[roomId];

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
}

if (createPrivateRoomButton) {
  createPrivateRoomButton.addEventListener("click", () => {
    if (!checkLoginBeforeAction()) return;

    const randomCode = "private-" + Math.floor(100000 + Math.random() * 900000);
    openFormatModal(randomCode);
  });
}

if (joinRoomBtn) {
  joinRoomBtn.addEventListener("click", () => {
    if (!checkLoginBeforeAction()) return;

    const roomId = normalizeRoomCode(roomCodeInput?.value);

    if (!roomId) {
      alert("Digite o código da mesa.");
      return;
    }

    handleEnterTable(roomId, false);
  });
}

if (roomCodeInput) {
  roomCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      joinRoomBtn?.click();
    }
  });
}

enterTableButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!checkLoginBeforeAction()) return;

    const card = button.closest(".room-card");
    if (!card) return;

    const roomId = card.dataset.room;
    const isResenha = card.dataset.special === "resenha";

    handleEnterTable(roomId, isResenha);
  });
});

if (confirmFormat) {
  confirmFormat.addEventListener("click", () => {
    if (!selectedRoomId) return;
    if (!checkLoginBeforeAction()) return;

    const selectedFormat = formatSelect?.value || "Formato livre";
    enterRoom(selectedRoomId, selectedFormat, "player");
  });
}

if (cancelFormat) {
  cancelFormat.addEventListener("click", closeFormatModal);
}

if (formatModal) {
  formatModal.addEventListener("click", (event) => {
    if (event.target === formatModal) {
      closeFormatModal();
    }
  });
}

if (refreshRoomsButton) {
  refreshRoomsButton.addEventListener("click", () => {
    window.location.reload();
  });
}

/* =========================
   LOGIN / USUÁRIO ONLINE
========================= */

function bindAuthStateChanged(callback) {
  if (window.onAuthStateChanged) {
    window.onAuthStateChanged(callback);
    return;
  }

  window.addEventListener("firebase-auth-ready", () => {
    window.onAuthStateChanged?.(callback);
  }, { once: true });
}

bindAuthStateChanged((user) => {
  if (user) {
    lastOnlineUid = user.uid;
    hasHandledHomeLogout = false;

    socket.emit("user-online", {
      uid: user.uid,
      name: user.displayName || "Usuário",
      email: user.email || "",
      photo: user.photoURL || "/assets/default-avatar.png"
    });
  } else {
    if (!lastOnlineUid && !window.authHadUser && !window.isSigningOut) return;
    if (hasHandledHomeLogout) return;

    hasHandledHomeLogout = true;
    lastOnlineUid = null;
    socket.emit("user-logout");
  }
});

function sendUserToConves() {
  setTimeout(() => {
    if (!window.getLoggedUserProfile) return;

    const user = window.getLoggedUserProfile();
    if (!user) return;

    socket.emit("user-online", {
      uid: user.uid,
      name: user.displayName || user.name || "Usuário",
      email: user.email || "",
      photo: user.photoURL || user.photo || "/assets/default-avatar.png"
    });
  }, 1200);
}

sendUserToConves();

/* =========================
   LOBBY STATE
========================= */

socket.on("lobby-state", (tables) => {
  if (!Array.isArray(tables)) return;

  tables.forEach((table) => {
    lobbyTables[table.roomId] = table;

    const card = document.querySelector(`[data-room="${table.roomId}"]`);
    if (!card) return;

    const formatBadge = card.querySelector(".format-badge");

    if (formatBadge) {
      formatBadge.innerText = table.format || "Formato livre";
    }

    const strongs = card.querySelectorAll(".room-info strong");

    if (table.isResenha) {
      if (strongs[0]) strongs[0].innerText = `${table.players}`;
      if (strongs[1]) strongs[1].innerText = `${table.spectators}`;
      if (strongs[2]) strongs[2].innerText = `${table.cameras}`;
    } else {
      if (strongs[0]) strongs[0].innerText = `${table.players}/2`;
      if (strongs[1]) strongs[1].innerText = `${table.spectators}`;
    }

    const button = card.querySelector(".enter-table-btn");
    if (!button) return;

    if (!table.isResenha && table.isFull) {
      card.classList.add("table-full");
      button.classList.add("full-btn");
      button.innerText = "Assistir";
    } else {
      card.classList.remove("table-full");
      button.classList.remove("full-btn");
      button.innerText = table.isResenha ? "Entrar na resenha →" : "Entrar na mesa →";
    }
  });
});

/* =========================
   CONVÉS
========================= */

socket.on("conves-state", (users) => {
  if (!Array.isArray(users)) return;
  renderPresence(buildPresenceFromLegacyUsers(users));
});

socket.on("presence-update", (presence) => {
  renderPresence(presence);
});

function buildPresenceFromLegacyUsers(users = []) {
  return {
    proa: users.filter(u => u.status === "spectating" || u.role === "spectator"),
    conves: users.filter(u => u.status === "playing" || u.role === "player"),
    calabouco: users.filter(u => u.status === "idle" || u.role === "idle")
  };
}

function renderPresence(presence = {}) {
  const proa = Array.isArray(presence.proa) ? presence.proa : [];
  const conves = Array.isArray(presence.conves) ? presence.conves : [];
  const calabouco = Array.isArray(presence.calabouco) ? presence.calabouco : [];

  const proaCount = document.getElementById("proaCount");
  const convesCount = document.getElementById("convesCount");
  const calaboucoCount = document.getElementById("calaboucoCount");

  const proaList = document.getElementById("proaList");
  const convesList = document.getElementById("convesList");
  const calaboucoList = document.getElementById("calaboucoList");

  if (proaCount) proaCount.innerText = proa.length;
  if (convesCount) convesCount.innerText = conves.length;
  if (calaboucoCount) calaboucoCount.innerText = calabouco.length;

  document.querySelectorAll('[data-presence-count="proa"]').forEach(item => {
    item.innerText = proa.length;
  });
  document.querySelectorAll('[data-presence-count="conves"]').forEach(item => {
    item.innerText = conves.length;
  });
  document.querySelectorAll('[data-presence-count="calabouco"]').forEach(item => {
    item.innerText = calabouco.length;
  });

  if (proaList) proaList.innerHTML = renderUserList(proa, "👁️");
  if (convesList) convesList.innerHTML = renderUserList(conves, "⚔️");
  if (calaboucoList) calaboucoList.innerHTML = renderUserList(calabouco, "👻");
}

function renderUserList(list, icon) {
  if (!list.length) {
    return `<p class="empty-conves">Ninguém por aqui...</p>`;
  }

  return list.map(user => `
    <div class="conves-user">
      <img src="${user.photo || "/assets/default-avatar.png"}" alt="Perfil">
      <div>
        <strong>${icon} ${user.name || "Usuário"}</strong>
        <span>${user.roomId ? user.roomId.toUpperCase() : "No porto"}</span>
      </div>
    </div>
  `).join("");
}

if (convesCard && convesModal) {
  convesCard.addEventListener("click", () => {
    convesModal.classList.add("active");
    convesModal.classList.remove("hidden");
  });
}

if (closeConves && convesModal) {
  closeConves.addEventListener("click", () => {
    convesModal.classList.remove("active");
    convesModal.classList.add("hidden");
  });
}

if (convesModal) {
  convesModal.addEventListener("click", (event) => {
    if (event.target === convesModal) {
      convesModal.classList.remove("active");
      convesModal.classList.add("hidden");
    }
  });
}
