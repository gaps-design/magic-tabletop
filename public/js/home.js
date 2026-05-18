const createRoomButton = document.getElementById("createRoom");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomCodeInput = document.getElementById("roomCodeInput");
const enterTableButtons = document.querySelectorAll(".enter-table-btn");
const refreshRoomsButton = document.getElementById("refreshRooms");

function normalizeRoomCode(value) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function enterRoom(roomId) {
  if (!roomId) {
    alert("Digite o código da mesa.");
    return;
  }

  window.location.href = `/sala.html?room=${roomId}`;
}

createRoomButton.addEventListener("click", () => {
  const roomId = "mtg-" + Math.floor(1000 + Math.random() * 9000);
  enterRoom(roomId);
});

joinRoomBtn.addEventListener("click", () => {
  const roomId = normalizeRoomCode(roomCodeInput.value);
  enterRoom(roomId);
});

roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const roomId = normalizeRoomCode(roomCodeInput.value);
    enterRoom(roomId);
  }
});

enterTableButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const card = button.closest(".room-card");
    const roomId = card.dataset.room;
    enterRoom(roomId);
  });
});

refreshRoomsButton.addEventListener("click", () => {
  window.location.reload();
});