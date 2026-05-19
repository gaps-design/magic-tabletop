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

function normalizeRoomCode(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function enterRoom(roomId, format = "casual") {
  if (!roomId) {
    alert("Digite o código da mesa.");
    return;
  }

  const url = `/sala.html?room=${roomId}&format=${encodeURIComponent(format)}`;

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

  const randomCode =
    "private-" + Math.floor(100000 + Math.random() * 900000);

  enterRoom(randomCode, "privado");
});

joinRoomBtn.addEventListener("click", () => {

  const roomId = normalizeRoomCode(roomCodeInput.value);

  if (!roomId) {
    alert("Digite o código da mesa.");
    return;
  }

  openFormatModal(roomId);
});

roomCodeInput.addEventListener("keydown", (event) => {

  if (event.key === "Enter") {

    const roomId = normalizeRoomCode(roomCodeInput.value);

    if (!roomId) {
      alert("Digite o código da mesa.");
      return;
    }

    openFormatModal(roomId);
  }
});

enterTableButtons.forEach((button) => {

  button.addEventListener("click", () => {

    const card = button.closest(".room-card");

    const roomId = card.dataset.room;

    const isResenha =
      card.dataset.special === "resenha";

    if (isResenha) {

      enterRoom(roomId, "mesa-da-resenha");
      return;
    }

    openFormatModal(roomId);
  });
});

confirmFormat.addEventListener("click", () => {

  if (!selectedRoomId) return;

  const selectedFormat = formatSelect.value;

  enterRoom(selectedRoomId, selectedFormat);
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