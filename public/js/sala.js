const params = new URLSearchParams(window.location.search);

let roomId = params.get("room");
const cameraFor = params.get("cameraFor");
const cameraKeyFromUrl = params.get("cameraKey");
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
const spectatorsCountBtn = document.getElementById("spectatorsCountBtn");
const roomUsersPanel = document.getElementById("roomUsersPanel");
const closeRoomUsersPanel = document.getElementById("closeRoomUsersPanel");
const roomUsersTitle = document.getElementById("roomUsersTitle");
const roomUsersList = document.getElementById("roomUsersList");

const dualViewBtn = document.getElementById("dualViewBtn");
const focusViewBtn = document.getElementById("focusViewBtn");
const dualViewBtnBottom = document.getElementById("dualViewBtnBottom");
const fullscreenBtn = document.getElementById("fullscreenBtn");

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

const leaveSpectatorBtn = document.getElementById("leaveSpectatorBtn");

const spectatorChatInput = document.getElementById("spectatorChatInput");
const sendSpectatorChatBtn = document.getElementById("sendSpectatorChatBtn");

let selectedRole = forcedRole === "spectator" ? "spectator" : "player";
let myPlayerNumber = null;
let myCameraKey = "";
let currentPlayersCount = 0;
let currentPlayers = [];
let currentCameraClients = [];
let currentSpectators = [];
let currentQueue = [];
let hasSeenLoggedUser = false;
let hasHandledLogout = false;
let isRedirectingHome = false;

let chatMessagesSent = 0;
let chatCooldown = false;
const CHAT_HISTORY_LIMIT = 80;
const MATCH_EVENTS_LIMIT = 60;

let diceHistory = [];

const diceSymbols = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

if (roomText) roomText.innerText = `Sala: ${roomId}`;
if (entryRoomText) entryRoomText.innerText = `Escolha como deseja entrar na sala ${roomId}`;

function redirectHomeOnce(delay = 250) {
    if (isRedirectingHome) return;

    isRedirectingHome = true;

    setTimeout(() => {
        window.location.href = "/";
    }, delay);
}

function leaveRoomForLogoutOnce() {
    if (hasHandledLogout) return;

    hasHandledLogout = true;

    if (typeof window.shutdownRoomConnection === "function") {
        window.shutdownRoomConnection();
    }

    socket.emit("leave-room", { roomId });
    redirectHomeOnce(250);
}

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
        if (selectedRole === "camera" || cameraFor) return;

        if (user) {
            hasSeenLoggedUser = true;
            hasHandledLogout = false;
            return;
        }

        if (!hasSeenLoggedUser && !window.authHadUser && !window.isSigningOut) return;

        leaveRoomForLogoutOnce();
});

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

function showLeaveSpectatorButton() {
    if (!leaveSpectatorBtn) return;

    if (selectedRole === "spectator") {
        leaveSpectatorBtn.classList.remove("hidden");
    } else {
        leaveSpectatorBtn.classList.add("hidden");
    }
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
   ENTRADA FORÇADA ESPECTADOR
========================= */

if (forcedRole === "spectator") {
    selectedRole = "spectator";

    if (playerRoleBtn) {
        playerRoleBtn.classList.remove("active");
        playerRoleBtn.style.display = "none";
    }

    if (spectatorRoleBtn) {
        spectatorRoleBtn.classList.add("active");
        spectatorRoleBtn.style.width = "100%";
        spectatorRoleBtn.style.pointerEvents = "none";
    }

    const roleOptions = document.querySelector(".role-options");
    if (roleOptions) {
        roleOptions.style.gridTemplateColumns = "1fr";
    }

    showSpectatorFields();

    if (entryError) {
        entryError.innerText = "Sala cheia. Entrando como espectador.";
    }
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
                cameraKey: cameraKeyFromUrl,
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

        showLeaveSpectatorButton();
        return;
    }

    if (data.role === "camera") {
        myPlayerNumber = null;
        selectedRole = "camera";

        document.body.classList.add("camera-mode");
        document.body.classList.remove("spectator-mode");

        showLeaveSpectatorButton();
        return;
    }

    if (data.playerNumber) {
        myPlayerNumber = Number(data.playerNumber);
        myCameraKey = data.cameraKey || "";
        selectedRole = "player";

        document.body.classList.remove("spectator-mode");
        document.body.classList.remove("camera-mode");

        showLeaveSpectatorButton();
    }
});

socket.on("room-full", () => {
    alert("Sala cheia. Você pode entrar como espectador.");
});

socket.on("resenha-queue-update", ({ position }) => {
    const text = position
        ? `Você entrou na fila da Mesa da Resenha. Posição ${position}.`
        : "Você entrou na fila da Mesa da Resenha.";

    if (entryError) entryError.innerText = text;
    addMatchEvent(text);
});

socket.on("room-state", (state) => {
    const players = Array.isArray(state.players) ? state.players : [];

    currentPlayers = players;
    currentCameraClients = Array.isArray(state.cameraClients) ? state.cameraClients : [];
    currentSpectators = Array.isArray(state.spectatorList) ? state.spectatorList : [];
    currentQueue = Array.isArray(state.queueList) ? state.queueList : [];
    currentPlayersCount = players.length;

    const formatText = document.getElementById("formatText");
    if (formatText && state.format) {
        formatText.innerText = `Formato: ${state.format}`;
    }

    if (usersCountBtn) {
        const cameraCount = currentCameraClients.length;

        usersCountBtn.innerText = `👥 ${players.length + cameraCount}`;
    }

    if (spectatorsCountBtn) {
        spectatorsCountBtn.innerText = `👁️ ${currentSpectators.length}`;
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
    const cameras = Array.isArray(state.cameraClients) ? state.cameraClients : [];
    const micStatus = state.micStatus || {};

    const me = players.find(p => Number(p.playerNumber) === myPlayerNumber);
    const remote = players.find(p => Number(p.playerNumber) !== myPlayerNumber);
    const myCamera = cameras.find(c => Number(c.linkedPlayer) === Number(myPlayerNumber));
    const remoteCamera = remote
        ? cameras.find(c => Number(c.linkedPlayer) === Number(remote.playerNumber))
        : null;

    const localMicId = myCamera?.socketId || me?.socketId;
    const remoteMicId = remoteCamera?.socketId || remote?.socketId;

    if (localMicId && micStatus[localMicId] !== undefined) {
        updateLocalMutedIcon(micStatus[localMicId]);
    }

    if (remoteMicId && micStatus[remoteMicId] !== undefined) {
        updateRemoteMutedIcon(micStatus[remoteMicId]);
    }
}

socket.on("mic-status-update", ({ socketId, micEnabled, info }) => {
    const linkedPlayer = Number(info?.linkedPlayer || info?.playerNumber || 0);

    if (socketId === socket.id || (myPlayerNumber && linkedPlayer === Number(myPlayerNumber))) {
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
        addMatchEvent(`🎲 ${line}`);
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
        addMatchEvent(line);
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
        alert("Você só pode alterar a anotação do oponente no seu painel.");
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
    if (typeof window.shutdownRoomConnection === "function") {
        window.shutdownRoomConnection();
    }

    socket.emit("leave-room", { roomId });
    redirectHomeOnce(300);
};

socket.on("left-room", () => {
    redirectHomeOnce(0);
});

if (leaveSpectatorBtn) {
    leaveSpectatorBtn.addEventListener("click", () => {
        if (typeof window.shutdownRoomConnection === "function") {
            window.shutdownRoomConnection();
        }

        socket.emit("leave-room", { roomId });
        redirectHomeOnce(300);
    });
}

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

function openRoomUsersPanel(title, people = []) {
    if (!roomUsersPanel || !roomUsersList || !roomUsersTitle) return;

    roomUsersTitle.innerText = title;
    roomUsersList.innerHTML = "";

    if (!people.length) {
        const empty = document.createElement("p");
        empty.className = "room-users-empty";
        empty.innerText = "Ninguém por aqui ainda.";
        roomUsersList.appendChild(empty);
    }

    people.forEach(person => {
        const item = document.createElement("div");
        item.className = "room-user-item";

        const img = document.createElement("img");
        img.src = person.photo || "/assets/default-avatar.png";
        img.alt = person.name || "Usuário";

        const info = document.createElement("div");

        const name = document.createElement("strong");
        name.innerText = person.name || "Usuário";

        const status = document.createElement("span");
        status.innerText = person.status || "";

        info.appendChild(name);
        info.appendChild(status);
        item.appendChild(img);
        item.appendChild(info);

        roomUsersList.appendChild(item);
    });

    roomUsersPanel.classList.remove("hidden");
}

if (usersCountBtn) {
    usersCountBtn.addEventListener("click", () => {
        const players = currentPlayers.map(p => ({
            name: `J${p.playerNumber}: ${p.name || "Jogador"}`,
            photo: p.photo || "",
            status: [p.deck, p.guild].filter(Boolean).join(" • ") || "Jogador ativo"
        }));

        const cameras = currentCameraClients.map(c => ({
            name: c.name || `Câmera J${c.linkedPlayer}`,
            photo: c.photo || "",
            status: `Câmera vinculada ao J${c.linkedPlayer}`
        }));

        const queue = currentQueue.map((q, index) => ({
            name: `${index + 1}. ${q.name || "Jogador"}`,
            photo: q.photo || "",
            status: `Fila da Resenha • ${[q.deck, q.guild].filter(Boolean).join(" • ") || "Aguardando"}`
        }));

        openRoomUsersPanel("Jogadores, câmeras e fila", [...players, ...cameras, ...queue]);
    });
}

if (spectatorsCountBtn) {
    spectatorsCountBtn.addEventListener("click", () => {
        openRoomUsersPanel(
            "Espectadores",
            currentSpectators.map(s => ({
                name: s.name || "Espectador",
                photo: s.photo || "",
                status: s.micEnabled ? "Microfone ativo" : "Microfone mutado"
            }))
        );
    });
}

if (closeRoomUsersPanel) {
    closeRoomUsersPanel.addEventListener("click", () => {
        roomUsersPanel?.classList.add("hidden");
    });
}

if (roomUsersPanel) {
    roomUsersPanel.addEventListener("click", event => {
        if (event.target === roomUsersPanel) {
            roomUsersPanel.classList.add("hidden");
        }
    });
}

window.copyCameraLink = async function() {
    if (!myPlayerNumber) {
        alert("Entre como jogador primeiro para gerar o link da câmera.");
        return;
    }

    if (!myCameraKey) {
        alert("A chave da câmera ainda não carregou. Aguarde um instante e tente novamente.");
        return;
    }

    const cameraUrl = `${window.location.origin}/sala.html?room=${roomId}&cameraFor=${myPlayerNumber}&cameraKey=${encodeURIComponent(myCameraKey)}`;

    try {
        await navigator.clipboard.writeText(cameraUrl);
    } catch (error) {
        console.warn("Não foi possível copiar automaticamente.", error);
    }

    openCameraQrModal(cameraUrl);
};

window.openCameraQrModal = function(cameraUrl) {
    const modal = document.getElementById("cameraQrModal");
    const qrBox = document.getElementById("cameraQrCode");

    if (!modal || !qrBox) return;

    qrBox.innerHTML = "";

    new QRCode(qrBox, {
        text: cameraUrl,
        width: 220,
        height: 220
    });

    modal.classList.remove("hidden");
};

window.closeCameraQrModal = function() {
    const modal = document.getElementById("cameraQrModal");
    if (modal) modal.classList.add("hidden");
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
   HISTÓRICO DE VIDA / EVENTOS
========================= */

const processedLifeEvents = new Set();

window.togglePlayerHistory = function(playerNumber) {
    if (selectedRole === "spectator") return;

    const panel = document.getElementById(`lifeHistoryPanel${playerNumber}`);
    if (!panel) return;

    panel.classList.toggle("hidden");
};

function renderLifeHistory(history = []) {
    const list1 = document.getElementById("lifeHistoryList1");
    const list2 = document.getElementById("lifeHistoryList2");

    if (!list1 || !list2) return;

    list1.innerHTML = "";
    list2.innerHTML = "";

    renderPlayerHistory(list1, history.filter(item => Number(item.playerNumber) === 1));
    renderPlayerHistory(list2, history.filter(item => Number(item.playerNumber) === 2));

    history.forEach(item => {
        const key = `${item.playerNumber}-${item.oldLife}-${item.newLife}-${item.time}-${item.change}`;

        if (processedLifeEvents.has(key)) return;
        processedLifeEvents.add(key);

        const playerName = item.playerName || `Jogador ${item.playerNumber}`;
        const diff = Number(item.newLife) - Number(item.oldLife);

        if (item.change === "reset") {
            addMatchEvent(`${playerName} resetou a vida para 20`);
            return;
        }

        if (diff < 0) {
            addMatchEvent(`${playerName} perdeu ${Math.abs(diff)} de vida`);
        }

        if (diff > 0) {
            addMatchEvent(`${playerName} ganhou ${diff} de vida`);
        }
    });
}

function renderPlayerHistory(list, history = []) {
    if (!history.length) {
        list.innerHTML = `<p class="empty-history">Sem alterações.</p>`;
        return;
    }

    history.forEach(item => {
        const div = document.createElement("div");
        div.className = "history-item-small";

        div.innerHTML = `
            <span>${item.oldLife} → ${item.newLife}</span>
            <small>${item.time || ""}</small>
        `;

        list.appendChild(div);
    });
}

function addMatchEvent(text) {
    const list = document.getElementById("matchEventsList");
    if (!list || !text) return;

    if (list.innerText.includes("Aguardando eventos")) {
        list.innerHTML = "";
    }

    const div = document.createElement("div");
    div.className = "event-item";
    div.innerText = text;

    list.appendChild(div);
    trimChildren(list, MATCH_EVENTS_LIMIT);
    scrollToLatest(list);
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

function getEmotes() {
    return [
        { emoji: "\u{1F64F}", label: "Fé" },
        { emoji: "\u{1F44D}", label: "Joinha" },
        { emoji: "\u{1F44E}", label: "Joinha invertido" },
        { emoji: "\u{1F622}", label: "Choro" },
        { emoji: "\u{1F602}", label: "Rindo" },
        { emoji: "\u{1F631}", label: "Surpreso" },
        { emoji: "\u{1F525}", label: "Fogo" },
        { emoji: "\u{1F480}", label: "Morreu" },
        { emoji: "\u{2764}\u{FE0F}", label: "Coração" },
        { emoji: "\u{1F44F}", label: "Aplausos" },
        { emoji: "\u{1F914}", label: "Pensando" },
        { emoji: "\u{1F60E}", label: "Estiloso" },
        { emoji: "\u{1F621}", label: "Bravo" },
        { emoji: "\u{1F3B2}", label: "Dado" },
        { emoji: "\u{2694}\u{FE0F}", label: "Combate" },
        { emoji: "\u{1F9E0}", label: "Jogada inteligente" },
        { emoji: "\u{1FA84}", label: "Mágica" }
    ];
}

function injectChatEmotes() {
    const emojiBar = document.querySelector(".emoji-bar");
    if (!emojiBar) return;

    emojiBar.innerHTML = "";

    getEmotes().forEach(item => {
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

function injectSpectatorEmotes() {
    const bar = document.getElementById("spectatorEmojiBar");
    if (!bar) return;

    bar.innerHTML = "";

    getEmotes().forEach(item => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.innerText = item.emoji;
        btn.title = item.label;

        btn.addEventListener("click", () => {
            sendChatMessage(item.emoji, "emoji");
        });

        bar.appendChild(btn);
    });
}

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

socket.on("chat-message", (data) => {
    renderChatMessage(data);
});

socket.on("floating-emoji", (data) => {
    spawnFloatingEmoji(data?.message || data?.emoji);
});

socket.on("spectator-joined", ({ name }) => {
    addMatchEvent(`${name || "Um espectador"} entrou para assistir.`);
});

socket.on("chat-cooldown", (data) => {
    alert(`Aguarde ${data.remaining || 3} segundos para enviar outra mensagem.`);
});

function renderChatMessage(data) {
    appendChatMessage(document.getElementById("chatMessages"), data);
    appendChatMessage(document.getElementById("spectatorChatMessages"), data);
}

function appendChatMessage(container, data) {
    if (!container) return;

    const div = document.createElement("div");
    const name = document.createElement("strong");
    const text = document.createElement("span");

    div.className = "chat-message";
    name.innerText = `${data.name || "Usuário"}:`;
    text.innerText = data.message || "";

    div.appendChild(name);
    div.appendChild(text);

    container.appendChild(div);
    trimChildren(container, CHAT_HISTORY_LIMIT);
    scrollToLatest(container);
}

function trimChildren(container, limit) {
    while (container.children.length > limit) {
        container.removeChild(container.firstElementChild);
    }
}

function scrollToLatest(container) {
    requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
    });
}

function spawnFloatingEmoji(emoji) {
    if (!emoji) return;

    const el = document.createElement("div");

    el.className = "floating-emoji";
    el.innerText = emoji;
    el.style.left = `${Math.floor(Math.random() * 80) + 10}%`;
    el.style.setProperty("--emoji-drift", `${Math.floor(Math.random() * 121) - 60}px`);

    document.body.appendChild(el);

    setTimeout(() => {
        el.remove();
    }, 5000);
}

/* =========================
   ESPECTADOR
========================= */

window.setSpectatorFocus = function(mode) {
    document.body.classList.remove("spectator-focus-p1", "spectator-focus-p2");

    if (mode === "p1") {
        document.body.classList.add("spectator-focus-p1");
    }

    if (mode === "p2") {
        document.body.classList.add("spectator-focus-p2");
    }
};

/* =========================
   INICIALIZAÇÃO
========================= */

window.addEventListener("load", () => {
    injectChatEmotes();
    injectSpectatorEmotes();

    const chatMessages = document.getElementById("chatMessages");

    if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    showLeaveSpectatorButton();
});

renderDiceHistory();

console.log("Sala.js carregado com sucesso");
