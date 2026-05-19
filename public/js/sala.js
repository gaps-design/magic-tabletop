const params = new URLSearchParams(window.location.search);

let roomId = params.get("room");
const cameraFor = params.get("cameraFor");
const roomFormat = params.get("format") || "Formato livre";

/* =========================
   PROTEÇÃO DA SALA
========================= */

function generateRoomId() {
    return "sala-" + Math.random().toString(36).substring(2, 8);
}

if (!roomId || roomId === "null" || roomId === "undefined") {
    roomId = generateRoomId();

    const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    window.history.replaceState({}, "", newUrl);
}

/* =========================
   FUNÇÃO SEGURA PARA ENTRAR
========================= */

async function safeJoinRoom(roomId, data) {
    if (!roomId) {
        throw new Error("Sala inválida.");
    }

    if (typeof joinRoom !== "function") {
        throw new Error("Função joinRoom não carregou. Verifique se o webrtc.js está antes do sala.js no HTML.");
    }

    return await joinRoom(roomId, data);
}

/* =========================
   ELEMENTOS DA TELA
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
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");

const diceOverlay = document.getElementById("diceOverlay");
const rollDiceBtn = document.getElementById("rollDiceBtn");
const resetDiceBtn = document.getElementById("resetDiceBtn");
const diceOne = document.getElementById("diceOne");
const diceTwo = document.getElementById("diceTwo");
const diceResultText = document.getElementById("diceResultText");

const localMutedIcon = document.getElementById("localMutedIcon");
const remoteMutedIcon = document.getElementById("remoteMutedIcon");

let selectedRole = "player";
let myPlayerNumber = null;

let chatMessagesSent = 0;
let chatCooldown = false;

let currentPlayersCount = 0;

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
   CAMPOS DE ENTRADA
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

/* =========================
   MODO CÂMERA DO CELULAR
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
   ENTRADA NA SALA
========================= */

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

        if (selectedRole === "player") {
            if (!deck) {
                if (entryError) entryError.innerText = "Selecione o deck.";
                return;
            }

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
            if (entryError) entryError.innerText = "Erro ao entrar na sala: " + error.message;
        }
    });
}

/* =========================
   SOCKET / STATUS
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
    if (usersCountBtn) {
        const playersCount = Array.isArray(state.players) ? state.players.length : 0;
        const spectatorsCount = Number(state.spectators || 0);
        const cameraCount = Array.isArray(state.cameraClients) ? state.cameraClients.length : 0;

        usersCountBtn.innerText = `👥 ${playersCount + spectatorsCount + cameraCount}`;
        currentPlayersCount = playersCount;
    }

    const players = Array.isArray(state.players) ? state.players : [];

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

/* =========================
   DADOS DE INÍCIO
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

        setDiceFaces(1, 1);

        if (diceResultText) {
            diceResultText.innerText = "Cada jogador lança 2D6. Maior resultado escolhe se quer começar.";
        }
    });
}

socket.on("dice-rolled", (roll) => {
    if (diceOverlay) diceOverlay.classList.remove("hidden");

    setTimeout(() => {
        stopDiceAnimation(roll.dice1, roll.dice2);

        if (diceResultText) {
            diceResultText.innerText =
                `Jogador ${roll.playerNumber} rolou ${roll.dice1} + ${roll.dice2} = ${roll.total}.`;
        }
    }, 900);
});

socket.on("dice-winner", (data) => {
    if (diceOverlay) diceOverlay.classList.remove("hidden");

    setTimeout(() => {
        if (diceResultText) {
            diceResultText.innerText =
                `🏆 ${data.message} Resultado: ${data.total}.`;
        }
    }, 1100);
});

socket.on("dice-draw", (data) => {
    if (diceOverlay) diceOverlay.classList.remove("hidden");

    setTimeout(() => {
        setDiceFaces(1, 1);

        if (diceResultText) {
            diceResultText.innerText = data.message || "Empate! Lancem novamente.";
        }
    }, 1000);
});

socket.on("dice-reset", () => {
    setDiceFaces(1, 1);

    if (diceResultText) {
        diceResultText.innerText = "Cada jogador lança 2D6. Maior resultado escolhe se quer começar.";
    }
});

/* =========================
   VIDA
========================= */

document.querySelectorAll(".life-buttons button").forEach(button => {
    button.addEventListener("click", () => {
        const playerNumber = Number(button.dataset.player);
        const amount = Number(button.dataset.amount);

        if (selectedRole === "spectator" || selectedRole === "camera") return;

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
    if (selectedRole === "spectator" || selectedRole === "camera") return;

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
    if (selectedRole === "spectator" || selectedRole === "camera") return;

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
   VIDA DO OPONENTE LOCAL
========================= */

document.querySelectorAll(".opponent-life").forEach(lifeBox => {
    lifeBox.addEventListener("click", () => {
        if (selectedRole !== "player") return;

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
        if (selectedRole === "spectator") return;

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
   HISTÓRICO
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
        button.className = "emoji-btn";
        button.innerText = item.emoji;
        button.title = item.label;

        button.addEventListener("click", () => {
            sendChatMessage(item.emoji, "emoji");
        });

        emojiBar.appendChild(button);
    });
}

injectChatEmotes();

if (toggleChatBtn) {
    toggleChatBtn.addEventListener("click", () => {
        if (!chatContainer) return;
        chatContainer.classList.toggle("hidden");
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
    if (!message || !message.trim()) return;
    if (!canSendChat()) return;

    socket.emit("chat-message", {
        roomId,
        message: message.trim(),
        type
    });
}

if (sendChatBtn) {
    sendChatBtn.addEventListener("click", () => {
        if (!chatInput) return;

        sendChatMessage(chatInput.value, "text");
        chatInput.value = "";
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
    if (!chatMessages) return;

    const div = document.createElement("div");
    div.className = "chat-message";

    div.innerHTML = `
        <strong>${data.name || "Usuário"}:</strong>
        <span>${data.message}</span>
    `;

    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
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