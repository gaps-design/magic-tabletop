const params = new URLSearchParams(window.location.search);

let roomId = params.get("room");
const cameraFor = params.get("cameraFor");
const forcedRole = params.get("role");
const roomFormat = params.get("format") || "Formato livre";

function generateRoomId() {
    return "sala-" + Math.random().toString(36).substring(2, 8);
}

if (!roomId || roomId === "null" || roomId === "undefined") {
    roomId = generateRoomId();
    const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    window.history.replaceState({}, "", newUrl);
}

async function safeJoinRoom(roomId, data) {
    if (!roomId) throw new Error("Sala inválida.");

    if (typeof joinRoom !== "function") {
        throw new Error("Função joinRoom não carregou. Verifique se o webrtc.js está antes do sala.js.");
    }

    return await joinRoom(roomId, data);
}

/* =========================
   ELEMENTOS
========================= */

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

const chatContainer = document.getElementById("chatContainer");
const toggleChatBtn = document.getElementById("toggleChatBtn");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");

const diceOverlay = document.getElementById("diceOverlay");
const rollDiceBtn = document.getElementById("rollDiceBtn");
const resetDiceBtn = document.getElementById("resetDiceBtn");
const diceOne = document.getElementById("diceOne");
const diceTwo = document.getElementById("diceTwo");
const diceResultText = document.getElementById("diceResultText");
const diceHistoryList = document.getElementById("diceHistoryList");

const localMutedIcon = document.getElementById("localMutedIcon");
const remoteMutedIcon = document.getElementById("remoteMutedIcon");

let selectedRole =
    forcedRole === "spectator"
        ? "spectator"
        : "player";
let myPlayerNumber = null;
let currentPlayersCount = 0;
let currentPlayers = [];

let chatMessagesSent = 0;
let chatCooldown = false;

let diceHistory = [];

const diceSymbols = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

if (roomText) roomText.innerText = `Sala: ${roomId}`;
if (entryRoomText) entryRoomText.innerText = `Escolha como deseja entrar na sala ${roomId}`;

/* =========================
   LOCAL STORAGE
========================= */

function loadSavedPlayerData() {
    if (playerNameInput) {
        playerNameInput.value = localStorage.getItem("mt_player_name") || "";
    }

    if (deckNameInput) {
        deckNameInput.value = localStorage.getItem("mt_deck_name") || "";
    }

    if (guildInput) {
        guildInput.value = localStorage.getItem("mt_guild_name") || "";
    }
}

function savePlayerData() {
    if (playerNameInput) {
        localStorage.setItem("mt_player_name", playerNameInput.value.trim());
    }

    if (deckNameInput) {
        localStorage.setItem("mt_deck_name", deckNameInput.value);
    }

    if (guildInput) {
        localStorage.setItem("mt_guild_name", guildInput.value);
    }
}

loadSavedPlayerData();

/* =========================
   ENTRADA FORÇADA ESPECTADOR
========================= */

if (forcedRole === "spectator") {

    selectedRole = "spectator";

    if (playerRoleBtn) {
        playerRoleBtn.classList.remove("active");
    }

    if (spectatorRoleBtn) {
        spectatorRoleBtn.classList.add("active");
    }

    showSpectatorFields();

    if (playerRoleBtn) {
    playerRoleBtn.style.display = "none";
}

if (spectatorRoleBtn) {
    spectatorRoleBtn.style.width = "100%";
    spectatorRoleBtn.style.pointerEvents = "none";
}

const roleOptions = document.querySelector(".role-options");
if (roleOptions) {
    roleOptions.style.gridTemplateColumns = "1fr";
}

    if (entryError) {
        entryError.innerText = "Sala cheia. Entrando como espectador.";
    }
}

/* =========================
   MODAL ENTRADA
========================= */

function showPlayerFields() {
    if (playerFields) playerFields.style.display = "flex";
    if (deckNameInput?.closest("label")) deckNameInput.closest("label").style.display = "block";
    if (guildInput?.closest("label")) guildInput.closest("label").style.display = "block";
}

function showSpectatorFields() {
    if (playerFields) playerFields.style.display = "flex";
    if (deckNameInput?.closest("label")) deckNameInput.closest("label").style.display = "none";
    if (guildInput?.closest("label")) guildInput.closest("label").style.display = "none";
}

if (playerRoleBtn) {
    playerRoleBtn.addEventListener("click", () => {
        selectedRole = "player";
        playerRoleBtn.classList.add("active");
        spectatorRoleBtn?.classList.remove("active");
        showPlayerFields();
    });
}

if (spectatorRoleBtn) {
    spectatorRoleBtn.addEventListener("click", () => {
        selectedRole = "spectator";
        spectatorRoleBtn.classList.add("active");
        playerRoleBtn?.classList.remove("active");
        showSpectatorFields();
    });
}

/* =========================
   CÂMERA CELULAR
========================= */

if (cameraFor) {
    selectedRole = "camera";
    document.body.classList.add("camera-mode");

    if (entryModal) entryModal.style.display = "none";

    window.addEventListener("load", async () => {
        try {
            await safeJoinRoom(roomId, {
                role: "camera",
                linkedPlayer: Number(cameraFor),
                name: `Câmera Jogador ${cameraFor}`,
                deck: "Câmera auxiliar",
                guild: "---",
                format: roomFormat
            });
        } catch (error) {
            alert("Erro ao iniciar câmera do celular: " + error.message);
        }
    });
}

/* =========================
   ENTRAR NA SALA
========================= */

if (enterRoomBtn) {
    enterRoomBtn.addEventListener("click", async () => {
        if (entryError) entryError.innerText = "";

        const name = playerNameInput ? playerNameInput.value.trim() : "";
        const deck = deckNameInput ? deckNameInput.value : "";
        const guild = guildInput ? guildInput.value : "";

        if (!name) {
            if (entryError) entryError.innerText = "Digite seu nome.";
            return;
        }

        if (selectedRole === "player" && !deck) {
            if (entryError) entryError.innerText = "Selecione o deck.";
            return;
        }

        if (selectedRole === "player") {
            savePlayerData();
        }

        try {
            await safeJoinRoom(roomId, {
                role: selectedRole,
                name,
                deck: selectedRole === "spectator" ? "---" : deck,
                guild: selectedRole === "spectator" ? "---" : guild,
                format: roomFormat
            });

            if (entryModal) entryModal.style.display = "none";
        } catch (error) {
            if (entryError) {
                entryError.innerText = "Erro ao entrar na sala: " + error.message;
            }
        }
    });
}

/* =========================
   SOCKET STATUS
========================= */

socket.on("assigned-role", (data) => {
    if (data.role === "spectator") {
        myPlayerNumber = null;
        selectedRole = "spectator";

        document.body.classList.add("spectator-mode");
        document.body.classList.remove("camera-mode");
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
    }
});

socket.on("room-full", () => {
    alert("Sala cheia. Você pode entrar como espectador.");
});

socket.on("room-state", (state) => {
    const players = Array.isArray(state.players) ? state.players : [];

    currentPlayers = players;
    currentPlayersCount = players.length;

    if (usersCountBtn) {
        const spectatorsCount = Number(state.spectators || 0);
        const cameraCount = Array.isArray(state.cameraClients) ? state.cameraClients.length : 0;

        usersCountBtn.innerText = `👥 ${players.length + spectatorsCount + cameraCount}`;
    }

    const p1 = players.find(p => Number(p.playerNumber) === 1);
    const p2 = players.find(p => Number(p.playerNumber) === 2);

    updatePlayerPanel(1, p1);
    updatePlayerPanel(2, p2);

    renderLifeHistory(state.lifeHistory || []);
    updateTimerDisplay(state.timer);

    if (state.micStatus) {
        updateMicIconsFromState(state);
    }
});

function updatePlayerPanel(playerNumber, playerData) {
    const name = document.getElementById(`player${playerNumber}Name`);
    const deck = document.getElementById(`player${playerNumber}Deck`);
    const guild = document.getElementById(`player${playerNumber}Guild`);
    const life = document.getElementById(`player${playerNumber}Life`);

    if (playerData) {
        if (name) name.innerText = playerData.name || `Jogador ${playerNumber}`;
        if (deck) deck.innerText = playerData.deck || "---";
        if (guild) guild.innerText = playerData.guild || "---";
        if (life) life.innerText = playerData.life ?? 20;
    } else {
        if (name) name.innerText = `Jogador ${playerNumber}`;
        if (deck) deck.innerText = "Aguardando...";
        if (guild) guild.innerText = "---";
        if (life) life.innerText = "20";
    }
}

/* =========================
   MICROFONE MUTADO
========================= */

function updateLocalMutedIcon(micEnabled) {
    if (!localMutedIcon) return;

    if (micEnabled) {
        localMutedIcon.classList.add("hidden");
    } else {
        localMutedIcon.classList.remove("hidden");
    }
}

function updateRemoteMutedIcon(micEnabled) {
    if (!remoteMutedIcon) return;

    if (micEnabled) {
        remoteMutedIcon.classList.add("hidden");
    } else {
        remoteMutedIcon.classList.remove("hidden");
    }
}

function updateMicIconsFromState(state) {
    const players = Array.isArray(state.players) ? state.players : [];
    const micStatus = state.micStatus || {};

    const me = players.find(p => Number(p.playerNumber) === myPlayerNumber);
    const remote = players.find(p => Number(p.playerNumber) !== myPlayerNumber);

    if (me && micStatus[me.socketId] !== undefined) {
        updateLocalMutedIcon(micStatus[me.socketId]);
    }

    if (remote && micStatus[remote.socketId] !== undefined) {
        updateRemoteMutedIcon(micStatus[remote.socketId]);
    }
}

socket.on("mic-status-update", ({ socketId, micEnabled }) => {
    if (socketId === socket.id) {
        updateLocalMutedIcon(micEnabled);
    } else {
        updateRemoteMutedIcon(micEnabled);
    }
});

/* reforço local caso o webrtc.js emita corretamente */
socket.on("update-mic-status", ({ socketId, micEnabled }) => {
    if (socketId === socket.id) {
        updateLocalMutedIcon(micEnabled);
    } else {
        updateRemoteMutedIcon(micEnabled);
    }
});

/* =========================
   DADOS
========================= */

window.toggleDiceOverlay = function() {
    if (!diceOverlay) return;
    diceOverlay.classList.toggle("hidden");
};

function setDiceFaces(d1, d2) {
    if (diceOne) diceOne.innerText = diceSymbols[Math.max(1, d1) - 1] || "⚀";
    if (diceTwo) diceTwo.innerText = diceSymbols[Math.max(1, d2) - 1] || "⚀";
}

function startDiceAnimation() {
    if (!diceOne || !diceTwo) return;

    diceOne.classList.add("rolling");
    diceTwo.classList.add("rolling");

    let counter = 0;

    const interval = setInterval(() => {
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;

        setDiceFaces(d1, d2);

        counter++;

        if (counter >= 12) {
            clearInterval(interval);
        }
    }, 80);
}

function stopDiceAnimation(d1, d2) {
    if (diceOne) diceOne.classList.remove("rolling");
    if (diceTwo) diceTwo.classList.remove("rolling");

    setDiceFaces(d1, d2);
}

function addDiceHistoryLine(text) {
    if (!text) return;

    diceHistory.push(text);
    renderDiceHistory();
}

function renderDiceHistory() {
    if (!diceHistoryList) return;

    if (diceHistory.length === 0) {
        diceHistoryList.innerHTML = "Aguardando lançamento...";
        return;
    }

    diceHistoryList.innerHTML = diceHistory
        .map(item => `<div>${item}</div>`)
        .join("");
}

function getPlayerNameByNumber(playerNumber) {
    const player = currentPlayers.find(p => Number(p.playerNumber) === Number(playerNumber));
    return player?.name || `Jogador ${playerNumber}`;
}

if (rollDiceBtn) {
    rollDiceBtn.addEventListener("click", () => {
        if (selectedRole !== "player") {
            alert("Apenas jogadores podem lançar dados.");
            return;
        }

        if (currentPlayersCount < 2) {
            if (diceResultText) {
                diceResultText.innerText = "Aguardando o segundo jogador entrar para disputar o início.";
            }
            return;
        }

        if (diceOverlay) diceOverlay.classList.remove("hidden");

        if (diceResultText) {
            diceResultText.innerText = "Dados rolando...";
        }

        startDiceAnimation();

        socket.emit("roll-dice", { roomId });
    });
}

if (resetDiceBtn) {
    resetDiceBtn.addEventListener("click", () => {
        if (selectedRole !== "player") return;

        socket.emit("reset-dice", { roomId });

        diceHistory = [];
        renderDiceHistory();

        setDiceFaces(1, 1);

        if (diceResultText) {
            diceResultText.innerText = "Cada jogador lança 2D6. Maior resultado escolhe se quer começar.";
        }
    });
}

socket.on("dice-rolled", (roll) => {
    if (diceOverlay) diceOverlay.classList.remove("hidden");

    const playerName = roll.playerName || getPlayerNameByNumber(roll.playerNumber);

    setTimeout(() => {
        stopDiceAnimation(roll.dice1, roll.dice2);

        const line = `${playerName} tirou ${roll.total} (${roll.dice1}+${roll.dice2})`;

        if (diceResultText) {
            diceResultText.innerText = line;
        }

        addDiceHistoryLine(line);
    }, 900);
});

socket.on("dice-winner", (data) => {
    if (diceOverlay) diceOverlay.classList.remove("hidden");

    const winnerName =
        data.playerName ||
        data.winnerName ||
        getPlayerNameByNumber(data.playerNumber);

    setTimeout(() => {
        const line = `🏆 ${winnerName} escolhe se vai começar.`;

        if (diceResultText) {
            diceResultText.innerText = line;
        }

        addDiceHistoryLine(line);
    }, 1100);
});

socket.on("dice-draw", (data) => {
    if (diceOverlay) diceOverlay.classList.remove("hidden");

    setTimeout(() => {
        setDiceFaces(1, 1);

        const line = data.message || "Empate! Lancem novamente.";

        if (diceResultText) {
            diceResultText.innerText = line;
        }

        addDiceHistoryLine(`⚠️ ${line}`);
    }, 1000);
});

socket.on("dice-reset", () => {
    diceHistory = [];
    renderDiceHistory();

    setDiceFaces(1, 1);

    if (diceResultText) {
        diceResultText.innerText = "Cada jogador lança 2D6. Maior resultado escolhe se quer começar.";
    }
});

/* =========================
   VIDA OFICIAL
========================= */

function changeOfficialLife(playerNumber, amount) {
    if (selectedRole !== "player") return;

    if (Number(playerNumber) !== Number(myPlayerNumber)) {
        alert("Você só pode alterar a sua própria vida oficial.");
        return;
    }

    socket.emit("change-life", {
        roomId,
        playerNumber: myPlayerNumber,
        amount: Number(amount)
    });
}

/* funciona com HTML antigo e novo */
document.querySelectorAll("[data-player][data-amount]").forEach(button => {
    button.addEventListener("click", () => {
        const playerNumber = Number(button.dataset.player);
        const amount = Number(button.dataset.amount);

        changeOfficialLife(playerNumber, amount);
    });
});

window.changeMyLife = function(amount) {
    if (selectedRole !== "player") return;

    socket.emit("change-life", {
        roomId,
        playerNumber: myPlayerNumber,
        amount: Number(amount)
    });
};

window.setManualLife = function(playerNumber) {
    if (selectedRole !== "player") return;

    if (Number(myPlayerNumber) !== Number(playerNumber)) {
        alert("Você só pode alterar a sua própria vida oficial.");
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
    if (selectedRole !== "player") return;

    if (Number(myPlayerNumber) !== Number(playerNumber)) {
        alert("Você só pode resetar a sua própria vida oficial.");
        return;
    }

    socket.emit("reset-life", {
        roomId,
        playerNumber: myPlayerNumber
    });
};

/* =========================
   VIDA DO OPONENTE LOCAL
========================= */

window.changeOpponentLifeLocal = function(panelPlayerNumber, amount) {
    if (selectedRole !== "player") return;

    if (Number(panelPlayerNumber) !== Number(myPlayerNumber)) {
        alert("Você só pode alterar a anotação do oponente no seu próprio painel.");
        return;
    }

    const box = document.getElementById(`player${panelPlayerNumber}OpponentLife`);
    if (!box) return;

    const current = Number(box.innerText || 20);
    box.innerText = current + Number(amount);
};

document.querySelectorAll(".opponent-life").forEach(lifeBox => {
    lifeBox.addEventListener("click", () => {
        if (selectedRole !== "player") return;

        const id = lifeBox.id || "";
        const panelPlayerNumber = Number(id.replace("player", "").replace("OpponentLife", ""));

        if (Number(panelPlayerNumber) !== Number(myPlayerNumber)) {
            alert("Você só pode alterar a anotação do oponente no seu próprio painel.");
            return;
        }

        const current = Number(lifeBox.innerText || 20);
        const value = prompt("Digite a vida do oponente:", current);

        if (value === null) return;

        const newValue = Number(value);

        if (isNaN(newValue)) {
            alert("Valor inválido.");
            return;
        }

        lifeBox.innerText = newValue;
    });
});

/* =========================
   GERAIS
========================= */

window.leaveRoom = function() {
    socket.emit("leave-room", { roomId });

    setTimeout(() => {
        window.close();

        setTimeout(() => {
            window.location.href = "/";
        }, 200);
    }, 300);
};

socket.on("left-room", () => {
    window.location.href = "/";
});

if (copyRoomBtn) {
    copyRoomBtn.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            alert("Link da sala copiado!");
        } catch (error) {
            alert("Não foi possível copiar o link.");
        }
    });
}

window.copyCameraLink = async function() {
    if (!myPlayerNumber) {
        alert("Entre como jogador primeiro para gerar o link da câmera.");
        return;
    }

    const cameraUrl = `${window.location.origin}/sala.html?room=${roomId}&cameraFor=${myPlayerNumber}`;

    try {
        await navigator.clipboard.writeText(cameraUrl);
        alert("Link da câmera copiado! Abra esse link no celular.");
    } catch (error) {
        alert(cameraUrl);
    }
};

document.querySelectorAll(".rotate-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const video = btn.parentElement.querySelector("video");
        if (!video) return;

        video.style.transform =
            video.style.transform === "rotate(180deg)"
                ? "rotate(0deg)"
                : "rotate(180deg)";
    });
});

if (dualViewBtn) {
    dualViewBtn.addEventListener("click", () => {
        if (selectedRole === "spectator") return;
        document.body.classList.remove("focus-mode");
    });
}

if (dualViewBtnBottom) {
    dualViewBtnBottom.addEventListener("click", () => {
        if (selectedRole === "spectator") return;
        document.body.classList.remove("focus-mode");
    });
}

if (focusViewBtn) {
    focusViewBtn.addEventListener("click", () => {
        if (selectedRole === "spectator") return;
        document.body.classList.add("focus-mode");
    });
}

if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", () => {
        document.documentElement.requestFullscreen();
    });
}

/* =========================
   TIMER
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
    if (selectedRole !== "player") return;

    const input = document.getElementById("timerMinutesInput");
    if (!input) return;

    const minutes = Number(input.value);

    if (isNaN(minutes) || minutes <= 0) {
        alert("Digite um tempo válido em minutos.");
        return;
    }

    socket.emit("set-timer", { roomId, minutes });
};

window.startTimer = function() {
    if (selectedRole !== "player") return;
    socket.emit("start-timer", { roomId });
};

window.pauseTimer = function() {
    if (selectedRole !== "player") return;
    socket.emit("pause-timer", { roomId });
};

window.resetTimer = function() {
    if (selectedRole !== "player") return;
    socket.emit("reset-timer", { roomId });
};

socket.on("timer-update", (timer) => {
    updateTimerDisplay(timer);
});

/* =========================
   HISTÓRICO DE VIDA
========================= */

window.togglePlayerHistory = function(playerNumber) {
    if (selectedRole === "spectator") return;

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

    renderPlayerHistory(list1, history.filter(item => Number(item.playerNumber) === 1));
    renderPlayerHistory(list2, history.filter(item => Number(item.playerNumber) === 2));
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
    if (selectedRole !== "player") return;
    socket.emit("clear-life-history", { roomId });
};

/* =========================
   MARCADORES POR JOGADOR
========================= */

const playerMarkers = {
    1: {
        energy: 0,
        poison: 0,
        storm: 0
    },

    2: {
        energy: 0,
        poison: 0,
        storm: 0
    }
};

window.changePlayerMarker = function(playerNumber, type, amount) {

    if (!playerMarkers[playerNumber]) return;

    if (!playerMarkers[playerNumber].hasOwnProperty(type)) return;

    playerMarkers[playerNumber][type] += Number(amount);

    if (playerMarkers[playerNumber][type] < 0) {
        playerMarkers[playerNumber][type] = 0;
    }

    const el = document.getElementById(`${type}Marker${playerNumber}`);

    if (el) {
        el.innerText = playerMarkers[playerNumber][type];
    }
};

/* =========================
   ANOTAÇÕES
========================= */

window.toggleNotesPanel = function() {
    const panel = document.getElementById("tableNotesPanel");
    if (!panel) return;

    panel.classList.toggle("hidden");
};

/* =========================
   CHAT / EMOTES
========================= */

function injectChatEmotes() {
    const emojiBar = document.querySelector(".emoji-bar");
    if (!emojiBar) return;

    emojiBar.innerHTML = "";

    const emotes = [
        { emoji: "🔥", label: "Fogo" },
        { emoji: "😂", label: "Rindo" },
        { emoji: "😱", label: "Surpreso" },
        { emoji: "👏", label: "Palmas" },
        { emoji: "❤️", label: "Coração" },
        { emoji: "🤫", label: "Silêncio" },
        { emoji: "🙏", label: "Fé" },
        { emoji: "👍", label: "Joinha" },
        { emoji: "😴", label: "Dormindo" },
        { emoji: "😈", label: "Capetinha" },
        { emoji: "🤨", label: "Duvidando" },
        { emoji: "🤔", label: "Pensativo" }
    ];

    emotes.forEach(item => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "emoji-btn";
        button.innerText = item.emoji;
        button.title = item.label;

        button.addEventListener("click", () => {
            sendChatMessage(item.emoji, "emoji");
        });

        emojiBar.appendChild(button);
    });
}

window.addEventListener("load", () => {
    injectChatEmotes();
});

if (toggleChatBtn) {
    toggleChatBtn.addEventListener("click", () => {
        const container = document.getElementById("chatContainer");
        if (!container) return;

        container.classList.toggle("hidden");
    });
}

function canSendChat() {
    if (chatCooldown) {
        alert("Chat temporariamente bloqueado. Aguarde 3 segundos.");
        return false;
    }

    chatMessagesSent++;

    if (chatMessagesSent >= 5) {
        chatCooldown = true;

        setTimeout(() => {
            chatMessagesSent = 0;
            chatCooldown = false;
        }, 3000);
    }

    return true;
}

function sendChatMessage(message, type = "text") {
    if (!message || !String(message).trim()) return;
    if (!canSendChat()) return;

    socket.emit("chat-message", {
        roomId,
        message: String(message).trim(),
        type
    });
}

if (sendChatBtn) {
    sendChatBtn.addEventListener("click", () => {
        const input = document.getElementById("chatInput");
        if (!input) return;

        sendChatMessage(input.value, "text");
        input.value = "";
    });
}

if (chatInput) {
    chatInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            sendChatMessage(chatInput.value, "text");
            chatInput.value = "";
        }
    });
}

socket.on("chat-message", (data) => {
    renderChatMessage(data);

    if (data.type === "emoji") {
        spawnFloatingEmoji(data.message);
    }
});

socket.on("chat-cooldown", (data) => {
    alert(`Aguarde ${data.remaining || 3} segundos para enviar outra mensagem.`);
});

function renderChatMessage(data) {

    const messageHtml = `
        <strong>${data.name || "Usuário"}:</strong>
        <span>${data.message}</span>
    `;

    // CHAT NORMAL
    const container = document.getElementById("chatMessages");

    if (container) {

        const div = document.createElement("div");
        div.className = "chat-message";
        div.innerHTML = messageHtml;

        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    // CHAT ESPECTADOR
    const spectatorContainer = document.getElementById("spectatorChatMessages");

    if (spectatorContainer) {

        const spectatorDiv = document.createElement("div");
        spectatorDiv.className = "chat-message";
        spectatorDiv.innerHTML = messageHtml;

        spectatorContainer.appendChild(spectatorDiv);
        spectatorContainer.scrollTop = spectatorContainer.scrollHeight;
    }
}

function spawnFloatingEmoji(emoji) {
    const el = document.createElement("div");

    el.className = "floating-emoji";
    el.innerText = emoji;
    el.style.left = `${Math.floor(Math.random() * 80) + 10}%`;

    document.body.appendChild(el);

    setTimeout(() => {
        el.remove();
    }, 5000);
}

renderDiceHistory();
/* =========================
   AJUSTE VIDA OPONENTE LOCAL
========================= */

window.changeOpponentLifeLocal = function(panelPlayerNumber, amount) {

    if (selectedRole !== "player") return;

    if (Number(panelPlayerNumber) !== Number(myPlayerNumber)) {
        alert("Você só pode alterar a anotação do oponente no seu painel.");
        return;
    }

    const box = document.getElementById(`player${panelPlayerNumber}OpponentLife`);

    if (!box) return;

    const current = Number(box.innerText || 20);

    box.innerText = current + Number(amount);
};

/* =========================
   GARANTIR CHAT FUNCIONANDO
========================= */

window.addEventListener("load", () => {

    injectChatEmotes();

    const chatMessages = document.getElementById("chatMessages");

    if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

});

/* =========================
   GARANTIR HISTÓRICO DADOS
========================= */

renderDiceHistory();

/* =========================
   DEBUG MICROFONE
========================= */

console.log("Sala.js carregado com sucesso");
const leaveSpectatorBtn = document.getElementById("leaveSpectatorBtn");

if (currentRole === "spectator" && leaveSpectatorBtn) {
    leaveSpectatorBtn.classList.remove("hidden");

    leaveSpectatorBtn.addEventListener("click", () => {

        if (window.opener && !window.opener.closed) {
            window.close();
        } else {
            window.location.href = "/";
        }

    });
}

if (leaveSpectatorBtn) {
    if (selectedRole === "spectator") {
        leaveSpectatorBtn.classList.remove("hidden");
    }

    leaveSpectatorBtn.addEventListener("click", () => {
        socket.emit("leave-room", { roomId });

        setTimeout(() => {
            window.close();

            setTimeout(() => {
                window.location.href = "/";
            }, 200);
        }, 300);
    });
}
const spectatorChatInput = document.getElementById("spectatorChatInput");
const sendSpectatorChatBtn = document.getElementById("sendSpectatorChatBtn");

if (sendSpectatorChatBtn) {
    sendSpectatorChatBtn.addEventListener("click", () => {
        if (!spectatorChatInput) return;

        sendChatMessage(spectatorChatInput.value, "text");
        spectatorChatInput.value = "";
    });
}

if (spectatorChatInput) {
    spectatorChatInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            sendChatMessage(spectatorChatInput.value, "text");
            spectatorChatInput.value = "";
        }
    });
}