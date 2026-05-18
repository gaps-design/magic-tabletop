const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");
const cameraFor = params.get("cameraFor");

const roomText = document.getElementById("roomText");
const entryRoomText = document.getElementById("entryRoomText");

const entryModal = document.getElementById("entryModal");
const playerRoleBtn = document.getElementById("playerRoleBtn");
const spectatorRoleBtn = document.getElementById("spectatorRoleBtn");
const playerFields = document.getElementById("playerFields");

const playerNameInput = document.getElementById("playerNameInput");
const deckNameInput = document.getElementById("deckNameInput");
const guildInput = document.getElementById("guildInput");
const enterRoomBtn = document.getElementById("enterRoomBtn");
const entryError = document.getElementById("entryError");

const copyRoomBtn = document.getElementById("copyRoomBtn");
const usersCountBtn = document.getElementById("usersCountBtn");

const dualViewBtn = document.getElementById("dualViewBtn");
const focusViewBtn = document.getElementById("focusViewBtn");
const dualViewBtnBottom = document.getElementById("dualViewBtnBottom");
const fullscreenBtn = document.getElementById("fullscreenBtn");

let selectedRole = "player";
let myPlayerNumber = null;

if (roomText) {
    roomText.innerText = `Sala: ${roomId}`;
}

if (entryRoomText) {
    entryRoomText.innerText = `Escolha como deseja entrar na sala ${roomId}`;
}

/* =========================
   MODO CÂMERA DO CELULAR
========================= */

if (cameraFor) {
    selectedRole = "camera";

    document.body.classList.add("camera-mode");

    if (entryModal) {
        entryModal.style.display = "none";
    }

    window.addEventListener("load", async () => {
        try {
            await joinRoom(roomId, {
                role: "camera",
                linkedPlayer: Number(cameraFor),
                name: `Câmera Jogador ${cameraFor}`,
                deck: "Câmera auxiliar",
                guild: "---"
            });
        } catch (error) {
            alert("Erro ao iniciar câmera do celular: " + error.message);
        }
    });
}

/* =========================
   ENTRADA NA SALA
========================= */

if (playerRoleBtn) {
    playerRoleBtn.addEventListener("click", () => {
        selectedRole = "player";

        playerRoleBtn.classList.add("active");
        spectatorRoleBtn.classList.remove("active");

        if (playerFields) playerFields.style.display = "flex";
    });
}

if (spectatorRoleBtn) {
    spectatorRoleBtn.addEventListener("click", () => {
        selectedRole = "spectator";

        spectatorRoleBtn.classList.add("active");
        playerRoleBtn.classList.remove("active");

        if (playerFields) playerFields.style.display = "none";
    });
}

if (enterRoomBtn) {
    enterRoomBtn.addEventListener("click", async () => {
        if (entryError) entryError.innerText = "";

        const name = playerNameInput ? playerNameInput.value.trim() : "";
        const deck = deckNameInput ? deckNameInput.value.trim() : "";
        const guild = guildInput ? guildInput.value.trim() : "";

        if (selectedRole === "player") {
            if (!name || !deck) {
                if (entryError) {
                    entryError.innerText = "Preencha nome do jogador e nome do deck.";
                }
                return;
            }
        }

        try {
            await joinRoom(roomId, {
                role: selectedRole,
                name: selectedRole === "spectator" ? "Espectador" : name,
                deck,
                guild
            });

            if (entryModal) {
                entryModal.style.display = "none";
            }

        } catch (error) {
            if (entryError) {
                entryError.innerText = "Erro ao entrar na sala: " + error.message;
            }
        }
    });
}

/* =========================
   SOCKET / STATUS DO USUÁRIO
========================= */

socket.on("assigned-role", (data) => {
    if (data.role === "spectator") {
        myPlayerNumber = null;
        selectedRole = "spectator";

        document.body.classList.add("spectator-mode");
        document.body.classList.remove("camera-mode");

        console.log("Você entrou como espectador.");
        return;
    }

    if (data.role === "camera") {
        myPlayerNumber = null;
        selectedRole = "camera";

        document.body.classList.add("camera-mode");
        document.body.classList.remove("spectator-mode");

        return;
    }

    if (data.playerNumber) {
        myPlayerNumber = Number(data.playerNumber);
        selectedRole = "player";

        document.body.classList.remove("spectator-mode");
        document.body.classList.remove("camera-mode");

        console.log("Você é o jogador:", myPlayerNumber);
    }
});

socket.on("room-full", () => {
    alert("Sala cheia. Você pode entrar como espectador.");
});

socket.on("room-state", (state) => {
    if (usersCountBtn) {
        const cameraCount = state.cameraClients ? state.cameraClients.length : 0;
        usersCountBtn.innerText = `👥 ${state.players.length + state.spectators + cameraCount}`;
    }

    const p1 = state.players.find(p => p.playerNumber === 1);
    const p2 = state.players.find(p => p.playerNumber === 2);

    if (p1) {
        document.getElementById("player1Name").innerText = p1.name;
        document.getElementById("player1Deck").innerText = p1.deck;
        document.getElementById("player1Guild").innerText = p1.guild || "---";
        document.getElementById("player1Life").innerText = p1.life;
    } else {
        document.getElementById("player1Name").innerText = "Jogador 1";
        document.getElementById("player1Deck").innerText = "Aguardando...";
        document.getElementById("player1Guild").innerText = "---";
        document.getElementById("player1Life").innerText = "20";
    }

    if (p2) {
        document.getElementById("player2Name").innerText = p2.name;
        document.getElementById("player2Deck").innerText = p2.deck;
        document.getElementById("player2Guild").innerText = p2.guild || "---";
        document.getElementById("player2Life").innerText = p2.life;
    } else {
        document.getElementById("player2Name").innerText = "Jogador 2";
        document.getElementById("player2Deck").innerText = "Aguardando...";
        document.getElementById("player2Guild").innerText = "---";
        document.getElementById("player2Life").innerText = "20";
    }

    renderLifeHistory(state.lifeHistory || []);
    updateTimerDisplay(state.timer);
});

/* =========================
   VIDA
========================= */

document.querySelectorAll(".life-buttons button").forEach(button => {
    button.addEventListener("click", () => {
        const playerNumber = Number(button.dataset.player);
        const amount = Number(button.dataset.amount);

        if (selectedRole === "spectator" || selectedRole === "camera") {
            alert("Você não pode alterar vida nesse modo.");
            return;
        }

        if (myPlayerNumber !== playerNumber) {
            alert("Você só pode alterar a sua própria vida.");
            return;
        }

        socket.emit("change-life", {
            roomId,
            playerNumber: myPlayerNumber,
            amount
        });
    });
});

window.setManualLife = function(playerNumber) {
    if (selectedRole === "spectator" || selectedRole === "camera") {
        alert("Você não pode alterar vida nesse modo.");
        return;
    }

    if (myPlayerNumber !== playerNumber) {
        alert("Você só pode alterar a sua própria vida.");
        return;
    }

    const input = document.getElementById(`manualLife${playerNumber}`);
    if (!input) return;

    const value = Number(input.value);

    if (isNaN(value) || input.value === "") {
        alert("Digite um valor de vida válido.");
        return;
    }

    socket.emit("set-life", {
        roomId,
        playerNumber: myPlayerNumber,
        value
    });

    input.value = "";
};

window.resetLife = function(playerNumber) {
    if (selectedRole === "spectator" || selectedRole === "camera") {
        alert("Você não pode resetar vida nesse modo.");
        return;
    }

    if (myPlayerNumber !== playerNumber) {
        alert("Você só pode resetar a sua própria vida.");
        return;
    }

    socket.emit("reset-life", {
        roomId,
        playerNumber: myPlayerNumber
    });
};

/* =========================
   BOTÕES GERAIS
========================= */

window.leaveRoom = function() {
    socket.emit("leave-room", { roomId });

    setTimeout(() => {
        window.location.href = "/";
    }, 300);
};

socket.on("left-room", () => {
    window.location.href = "/";
});

if (copyRoomBtn) {
    copyRoomBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(window.location.href);
        alert("Link da sala copiado!");
    });
}

window.copyCameraLink = async function() {
    if (!myPlayerNumber) {
        alert("Entre como jogador primeiro para gerar o link da câmera.");
        return;
    }

    const cameraUrl =
        `${window.location.origin}/sala.html?room=${roomId}&cameraFor=${myPlayerNumber}`;

    await navigator.clipboard.writeText(cameraUrl);

    alert("Link da câmera copiado! Abra esse link no celular.");
};

document.querySelectorAll(".rotate-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const video = btn.parentElement.querySelector("video");
        if (!video) return;

        if (video.style.transform === "rotate(180deg)") {
            video.style.transform = "rotate(0deg)";
        } else {
            video.style.transform = "rotate(180deg)";
        }
    });
});

if (dualViewBtn) {
    dualViewBtn.addEventListener("click", () => {
        document.body.classList.remove("focus-mode");
    });
}

if (dualViewBtnBottom) {
    dualViewBtnBottom.addEventListener("click", () => {
        document.body.classList.remove("focus-mode");
    });
}

if (focusViewBtn) {
    focusViewBtn.addEventListener("click", () => {
        document.body.classList.add("focus-mode");
    });
}

if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", () => {
        document.documentElement.requestFullscreen();
    });
}

/* =========================
   CRONÔMETRO
========================= */

function formatTimer(seconds) {
    if (!seconds && seconds !== 0) return "50:00";

    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;

    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function updateTimerDisplay(timer) {
    const timerDisplay = document.getElementById("timerDisplay");
    if (!timerDisplay) return;

    if (!timer) {
        timerDisplay.innerText = "50:00";
        return;
    }

    timerDisplay.innerText = formatTimer(timer.remaining);
}

window.setTimer = function() {
    const input = document.getElementById("timerMinutesInput");
    const minutes = Number(input.value);

    if (selectedRole === "camera") return;

    if (isNaN(minutes) || minutes <= 0) {
        alert("Digite um tempo válido em minutos.");
        return;
    }

    socket.emit("set-timer", {
        roomId,
        minutes
    });
};

window.startTimer = function() {
    if (selectedRole === "camera") return;
    socket.emit("start-timer", { roomId });
};

window.pauseTimer = function() {
    if (selectedRole === "camera") return;
    socket.emit("pause-timer", { roomId });
};

window.resetTimer = function() {
    if (selectedRole === "camera") return;
    socket.emit("reset-timer", { roomId });
};

socket.on("timer-update", (timer) => {
    updateTimerDisplay(timer);
});

/* =========================
   HISTÓRICO DE VIDA
========================= */

window.togglePlayerHistory = function(playerNumber) {
    const panel = document.getElementById(`lifeHistoryPanel${playerNumber}`);
    if (!panel) return;

    panel.classList.toggle("hidden");
};

function renderLifeHistory(history) {
    const list1 = document.getElementById("lifeHistoryList1");
    const list2 = document.getElementById("lifeHistoryList2");

    if (!list1 || !list2) return;

    list1.innerHTML = "";
    list2.innerHTML = "";

    const history1 = history.filter(item => item.playerNumber === 1);
    const history2 = history.filter(item => item.playerNumber === 2);

    renderPlayerHistory(list1, history1);
    renderPlayerHistory(list2, history2);
}

function renderPlayerHistory(list, history) {
    if (!history || history.length === 0) {
        list.innerHTML = `<p class="empty-history">Sem alterações.</p>`;
        return;
    }

    history.forEach(item => {
        const div = document.createElement("div");
        div.className = "history-item-small";

        div.innerHTML = `
            <span>${item.oldLife} → ${item.newLife}</span>
            <small>${item.time}</small>
        `;

        list.appendChild(div);
    });
}

window.clearLifeHistory = function() {
    if (selectedRole === "camera") return;
    socket.emit("clear-life-history", { roomId });
};