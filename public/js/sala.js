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
const googleEntryProfile = document.getElementById("googleEntryProfile");
const googleEntryPhoto = document.getElementById("googleEntryPhoto");
const googleEntryText = document.getElementById("googleEntryText");
const deckNameInput = document.getElementById("deckNameInput");
const guildInput = document.getElementById("guildInput");
const enterRoomBtn = document.getElementById("enterRoomBtn");
const entryError = document.getElementById("entryError");

const copyRoomBtn = document.getElementById("copyRoomBtn");
const usersCountBtn = document.getElementById("usersCountBtn");
const spectatorsCountBtn = document.getElementById("spectatorsCountBtn");
const resenhaBecomeSpectatorBtn = document.getElementById("resenhaBecomeSpectatorBtn");
const resenhaBecomePlayerBtn = document.getElementById("resenhaBecomePlayerBtn");
const roomUsersPanel = document.getElementById("roomUsersPanel");
const closeRoomUsersPanel = document.getElementById("closeRoomUsersPanel");
const roomUsersTitle = document.getElementById("roomUsersTitle");
const roomUsersList = document.getElementById("roomUsersList");

const dualViewBtn = document.getElementById("dualViewBtn");
const focusViewBtn = document.getElementById("focusViewBtn");
const dualViewBtnBottom = document.getElementById("dualViewBtnBottom");
const cleanModeBtn = document.getElementById("cleanModeBtn");
const cleanModeBtnBottom = document.getElementById("cleanModeBtnBottom");
const cleanExitBar = document.getElementById("cleanExitBar");
const cleanMenuTab = document.getElementById("cleanMenuTab");
const cleanExitBtn = document.getElementById("cleanExitBtn");
const cleanFocusBtn = document.getElementById("cleanFocusBtn");
const cleanDualBtn = document.getElementById("cleanDualBtn");
const cleanCopyRoomBtn = document.getElementById("cleanCopyRoomBtn");
const cleanLeaveRoomBtn = document.getElementById("cleanLeaveRoomBtn");
const leaveConfirmModal = document.getElementById("leaveConfirmModal");
const cancelLeaveRoomBtn = document.getElementById("cancelLeaveRoomBtn");
const confirmLeaveRoomBtn = document.getElementById("confirmLeaveRoomBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const localVideoElement = document.getElementById("localVideo");
const cameraFramingBtn = document.getElementById("cameraFramingBtn");
const cameraFramingPanel = document.getElementById("cameraFramingPanel");
const closeCameraFramingBtn = document.getElementById("closeCameraFramingBtn");
const cameraZoomRange = document.getElementById("cameraZoomRange");
const cameraXRange = document.getElementById("cameraXRange");
const cameraYRange = document.getElementById("cameraYRange");
const resetCameraFramingBtn = document.getElementById("resetCameraFramingBtn");
const saveCameraFramingBtn = document.getElementById("saveCameraFramingBtn");

const toggleChatBtn = document.getElementById("toggleChatBtn");
const closeChatBtn = document.getElementById("closeChatBtn");
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
const toggleFaceCameraBtn = document.getElementById("toggleFaceCameraBtn");
const faceCameraStatusText = document.getElementById("faceCameraStatusText");
const faceCameraSelect = document.getElementById("faceCameraSelect");
const faceCameraSelectControl = document.querySelector(".face-camera-select-control");

const leaveSpectatorBtn = document.getElementById("leaveSpectatorBtn");

const spectatorChatInput = document.getElementById("spectatorChatInput");
const sendSpectatorChatBtn = document.getElementById("sendSpectatorChatBtn");
const requestSpectatorMicBtn = document.getElementById("requestSpectatorMicBtn");
const spectatorMobileChatBtn = document.getElementById("spectatorMobileChatBtn");
const spectatorMicStatus = document.getElementById("spectatorMicStatus");
const spectatorMarkersList = document.getElementById("spectatorMarkersList");

let selectedRole = forcedRole === "spectator" ? "spectator" : "player";
let myPlayerNumber = null;
let myCameraKey = "";
let currentPlayersCount = 0;
let currentPlayers = [];
let currentCameraClients = [];
let currentSpectators = [];
let currentQueue = [];
let isQueuedInResenha = false;
let currentRoomMarkerState = { 1: {}, 2: {} };
let currentMatchScore = { 1: 0, 2: 0 };
let hasReceivedMatchScore = false;
let victoryOverlayTimer = null;
const previousOfficialLife = {};
const lifeDeltaTimers = {};
let hasSeenLoggedUser = false;
let hasHandledLogout = false;
let isRedirectingHome = false;
let googleRoomProfile = null;

let chatMessagesSent = 0;
let chatCooldown = false;
let cleanModeEnabled = false;
let cleanHudHidden = false;
const CAMERA_FRAMING_STORAGE_KEY = "resenhaon-camera-framing";
const CAMERA_FRAMING_DEFAULT = { zoom: 1, x: 0, y: 0 };
const cameraFramingLimits = {
    zoom: { min: 1, max: 2.5, step: 0.1 },
    offset: { min: -200, max: 200, step: 10 }
};
let cameraFraming = { ...CAMERA_FRAMING_DEFAULT };
let currentLifeHistory = [];
let localOpponentLifeHistory = [];
let lastRoomToastKey = "";
let lastRoomToastAt = 0;
let faceCameraStream = null;
let faceCameraDeviceId = localStorage.getItem("magicSelectedFaceCamera") || "";
let faceCameraStatus = "off";
const remoteFaceCameras = {};
let lastTimerRemaining = null;
let timerAudioContext = null;
const timerAlertMarks = [1200, 900, 600, 300];
const firedTimerAlerts = new Set();
let timerSirenPlayed = false;
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

function closeRoomTabOrHome(delay = 250) {
    if (isRedirectingHome) return;

    isRedirectingHome = true;

    setTimeout(() => {
        window.close();

        setTimeout(() => {
            if (!window.closed) {
                window.location.href = "/";
            }
        }, 180);
    }, delay);
}

function leaveRoomForLogoutOnce() {
    if (hasHandledLogout) return;

    hasHandledLogout = true;

    if (typeof window.shutdownRoomConnection === "function") {
        window.shutdownRoomConnection();
    }

    socket.emit("leave-room", { roomId });
    closeRoomTabOrHome(250);
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

function getGoogleProfileName(user) {
    if (!user) return "";

    const displayName = String(user.displayName || "").trim();
    if (displayName) return displayName;

    const email = String(user.email || "").trim();
    if (email.includes("@")) return email.split("@")[0];

    return "";
}

function applyGoogleEntryProfile(user) {
    const name = getGoogleProfileName(user);

    if (!name) {
        googleRoomProfile = null;

        if (playerNameInput) {
            playerNameInput.readOnly = false;
            playerNameInput.classList.remove("from-google-profile");
            if (!playerNameInput.value.trim()) {
                playerNameInput.value = localStorage.getItem("mt_player_name") || "";
            }
        }

        googleEntryProfile?.classList.add("hidden");
        return;
    }

    googleRoomProfile = {
        uid: user.uid || "",
        name,
        email: user.email || "",
        photo: user.photoURL || "/assets/default-avatar.png"
    };

    if (playerNameInput) {
        playerNameInput.value = name;
        playerNameInput.readOnly = true;
        playerNameInput.classList.add("from-google-profile");
    }

    if (googleEntryPhoto) {
        googleEntryPhoto.src = googleRoomProfile.photo;
        googleEntryPhoto.alt = name;
    }

    if (googleEntryText) {
        googleEntryText.innerText = `Entrando como: ${name}`;
    }

    googleEntryProfile?.classList.remove("hidden");
}

function waitForAuthResolution(timeout = 1800) {
    if (window.authHasResolved || window.currentUser) {
        return Promise.resolve(window.currentUser || null);
    }

    return new Promise((resolve) => {
        let settled = false;

        const finish = (user) => {
            if (settled) return;
            settled = true;
            resolve(user || window.currentUser || null);
        };

        const timer = setTimeout(() => finish(null), timeout);

        bindAuthStateChanged((user) => {
            clearTimeout(timer);
            finish(user);
        });
    });
}

bindAuthStateChanged((user) => {
        if (selectedRole === "camera" || cameraFor) return;

        if (user) {
            hasSeenLoggedUser = true;
            hasHandledLogout = false;
            applyGoogleEntryProfile(user);
            return;
        }

        applyGoogleEntryProfile(null);

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

function clampCameraFramingValue(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
}

function normalizeCameraFraming(rawValue = {}) {
    return {
        zoom: clampCameraFramingValue(rawValue.zoom ?? CAMERA_FRAMING_DEFAULT.zoom, cameraFramingLimits.zoom.min, cameraFramingLimits.zoom.max),
        x: clampCameraFramingValue(rawValue.x ?? CAMERA_FRAMING_DEFAULT.x, cameraFramingLimits.offset.min, cameraFramingLimits.offset.max),
        y: clampCameraFramingValue(rawValue.y ?? CAMERA_FRAMING_DEFAULT.y, cameraFramingLimits.offset.min, cameraFramingLimits.offset.max)
    };
}

function loadCameraFraming() {
    try {
        const saved = JSON.parse(localStorage.getItem(CAMERA_FRAMING_STORAGE_KEY) || "{}");
        cameraFraming = normalizeCameraFraming(saved);
    } catch (error) {
        cameraFraming = { ...CAMERA_FRAMING_DEFAULT };
    }
}

function syncCameraFramingControls() {
    if (cameraZoomRange) cameraZoomRange.value = String(cameraFraming.zoom);
    if (cameraXRange) cameraXRange.value = String(cameraFraming.x);
    if (cameraYRange) cameraYRange.value = String(cameraFraming.y);
}

function applyCameraFraming() {
    if (!localVideoElement) return;

    const { zoom, x, y } = normalizeCameraFraming(cameraFraming);
    cameraFraming = { zoom, x, y };
    localVideoElement.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
}

function saveCameraFraming({ notify = true } = {}) {
    localStorage.setItem(CAMERA_FRAMING_STORAGE_KEY, JSON.stringify(cameraFraming));
    if (notify) showRoomToast("Ajuste da câmera salvo.");
}

function setCameraFraming(nextValue, { persist = false } = {}) {
    cameraFraming = normalizeCameraFraming({
        ...cameraFraming,
        ...nextValue
    });
    syncCameraFramingControls();
    applyCameraFraming();
    if (persist) saveCameraFraming({ notify: false });
}

function resetCameraFraming() {
    setCameraFraming(CAMERA_FRAMING_DEFAULT);
    saveCameraFraming({ notify: false });
}

function toggleCameraFramingPanel(forceOpen) {
    if (!cameraFramingPanel) return;

    const shouldOpen = forceOpen ?? cameraFramingPanel.classList.contains("hidden");
    cameraFramingPanel.classList.toggle("hidden", !shouldOpen);
}

loadCameraFraming();
syncCameraFramingControls();
applyCameraFraming();

function getMainCameraDeviceId() {
    const mainCameraSelect = document.getElementById("cameraSelect");
    return mainCameraSelect?.value || localStorage.getItem("magicSelectedCamera") || "";
}

function getActiveFaceCameraDeviceId() {
    return faceCameraStream?.getVideoTracks?.()[0]?.getSettings?.().deviceId || faceCameraDeviceId || "";
}

function updateFaceCameraControls() {
    const isPlayer = selectedRole === "player";

    toggleFaceCameraBtn?.classList.toggle("hidden", !isPlayer);
    faceCameraSelectControl?.classList.toggle("hidden", !isPlayer);

    if (faceCameraStatusText) {
        const labels = {
            off: "Desativada",
            starting: "Ativando...",
            on: "Ativada",
            error: "Erro"
        };

        faceCameraStatusText.innerText = labels[faceCameraStatus] || labels.off;
    }

    if (toggleFaceCameraBtn) {
        toggleFaceCameraBtn.classList.toggle("active", faceCameraStatus === "on");
        toggleFaceCameraBtn.disabled = faceCameraStatus === "starting" || !isPlayer;
    }
}

async function getFaceCameraDevices({ warnIfMissing = false } = {}) {
    if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices?.getUserMedia) {
        if (warnIfMissing) showRoomToast("Não foi possível ativar a câmera de rosto.");
        return [];
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(device => device.kind === "videoinput");
    const mainCameraId = getMainCameraDeviceId();
    const secondaryCameras = cameras.filter(camera => !mainCameraId || camera.deviceId !== mainCameraId);

    if (faceCameraSelect) {
        faceCameraSelect.innerHTML = "";

        secondaryCameras.forEach((camera, index) => {
            const option = document.createElement("option");
            option.value = camera.deviceId;
            option.text = camera.label || `Câmera de rosto ${index + 1}`;
            faceCameraSelect.appendChild(option);
        });

        if (!secondaryCameras.some(camera => camera.deviceId === faceCameraDeviceId)) {
            faceCameraDeviceId = secondaryCameras[0]?.deviceId || "";
        }

        if (faceCameraDeviceId) {
            faceCameraSelect.value = faceCameraDeviceId;
        }
    }

    if (warnIfMissing && cameras.length <= 1) {
        showRoomToast("Nenhuma segunda câmera encontrada.");
    }

    return secondaryCameras;
}

function renderFaceCameraCard(root, { stream, playerNumber, name, isLocal = false } = {}) {
    if (!root || !stream) return false;

    const card = document.createElement("div");
    const header = document.createElement("div");
    const title = document.createElement("strong");
    const closeButton = document.createElement("button");
    const video = document.createElement("video");

    card.className = `face-camera-card face-camera-player-${playerNumber || "local"}`;
    header.className = "face-camera-header";
    title.innerText = isLocal
        ? "Minha FaceCam"
        : `FaceCam ${name || `Jogador ${playerNumber || ""}`}`.trim();
    closeButton.type = "button";
    closeButton.innerText = "X";
    closeButton.setAttribute("aria-label", "Desligar câmera de rosto");
    closeButton.classList.toggle("hidden", !isLocal);
    closeButton.addEventListener("click", () => stopFaceCamera());

    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    header.appendChild(title);
    header.appendChild(closeButton);
    card.appendChild(header);
    card.appendChild(video);
    root.appendChild(card);

    return true;
}

async function startFaceCamera() {
    if (selectedRole !== "player") return;

    faceCameraStatus = "starting";
    updateFaceCameraControls();

    try {
        const secondaryCameras = await getFaceCameraDevices({ warnIfMissing: true });

        if (!secondaryCameras.length) {
            faceCameraStatus = "off";
            updateFaceCameraControls();
            return;
        }

        const requestedDeviceId = faceCameraSelect?.value || faceCameraDeviceId || secondaryCameras[0].deviceId;
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: requestedDeviceId } },
            audio: false
        });

        stopFaceCamera({ silent: true });

        faceCameraStream = stream;
        faceCameraStatus = "on";
        faceCameraDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId || requestedDeviceId;
        localStorage.setItem("magicSelectedFaceCamera", faceCameraDeviceId);

        faceCameraStream.getVideoTracks().forEach(track => {
            track.onended = () => {
                if (faceCameraStream) {
                    stopFaceCamera({ silent: true });
                    showRoomToast("FaceCam desconectada.");
                }
            };
        });

        if (faceCameraSelect && faceCameraDeviceId) {
            faceCameraSelect.value = faceCameraDeviceId;
        }

        updateFaceCameraControls();
        renderFloatingMarkers();

        try {
            window.startFaceCamBroadcast?.(faceCameraStream, {
                roomId,
                playerNumber: myPlayerNumber,
                name: googleRoomProfile?.name || playerNameInput?.value?.trim() || `Jogador ${myPlayerNumber || ""}`
            });
        } catch (broadcastError) {
            console.warn("FaceCam local ativa, mas transmissão remota falhou:", broadcastError);
            showRoomToast("FaceCam local ativa. Transmissão remota indisponível.");
        }
    } catch (error) {
        console.warn("Erro ao ativar câmera de rosto:", error);

        faceCameraStatus = "error";
        updateFaceCameraControls();

        if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
            showRoomToast("Permissão da câmera de rosto negada.");
        } else if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError" || error?.name === "DevicesNotFoundError") {
            showRoomToast("Nenhuma segunda câmera encontrada.");
        } else {
            showRoomToast("Não foi possível ativar a câmera de rosto.");
        }

        setTimeout(() => {
            if (faceCameraStatus === "error") {
                faceCameraStatus = "off";
                updateFaceCameraControls();
            }
        }, 1800);
    }
}

function stopFaceCamera({ silent = false } = {}) {
    window.stopFaceCamBroadcast?.({ roomId });

    if (faceCameraStream) {
        faceCameraStream.getTracks().forEach(track => track.stop());
    }

    faceCameraStream = null;
    faceCameraStatus = "off";
    updateFaceCameraControls();
    renderFloatingMarkers();

    if (!silent) {
        showRoomToast("Câmera de rosto desligada.");
    }
}

window.releaseFaceCamForMainCamera = async function(cameraId) {
    const activeFaceDeviceId = getActiveFaceCameraDeviceId();

    if (!faceCameraStream || !cameraId || activeFaceDeviceId !== cameraId) {
        return false;
    }

    stopFaceCamera({ silent: true });
    showRoomToast("FaceCam desligada para liberar a câmera principal.");
    await new Promise(resolve => setTimeout(resolve, 80));
    return true;
};

window.updateRemoteFaceCam = function(playerNumber, stream, info = {}) {
    const normalizedPlayer = Number(playerNumber || info.playerNumber);
    if (![1, 2].includes(normalizedPlayer) || !stream) return;

    remoteFaceCameras[normalizedPlayer] = {
        stream,
        name: info.name || `Jogador ${normalizedPlayer}`,
        socketId: info.socketId || ""
    };

    renderFloatingMarkers();
};

window.removeRemoteFaceCam = function(playerNumberOrSocketId) {
    Object.entries(remoteFaceCameras).forEach(([playerNumber, camera]) => {
        if (
            Number(playerNumberOrSocketId) === Number(playerNumber) ||
            String(camera.socketId) === String(playerNumberOrSocketId)
        ) {
            delete remoteFaceCameras[playerNumber];
        }
    });

    renderFloatingMarkers();
};

async function toggleFaceCamera() {
    if (faceCameraStream) {
        stopFaceCamera();
        return;
    }

    await startFaceCamera();
}

if (playerRoleBtn) {
    playerRoleBtn.addEventListener("click", () => {
        selectedRole = "player";
        playerRoleBtn.classList.add("active");
        spectatorRoleBtn?.classList.remove("active");
        showPlayerFields();
        updateFaceCameraControls();
    });
}

if (spectatorRoleBtn) {
    spectatorRoleBtn.addEventListener("click", () => {
        selectedRole = "spectator";
        spectatorRoleBtn.classList.add("active");
        playerRoleBtn?.classList.remove("active");
        showSpectatorFields();
        stopFaceCamera({ silent: true });
        updateFaceCameraControls();
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

        if (!window.authHasResolved && !googleRoomProfile) {
            const resolvedUser = await waitForAuthResolution();
            applyGoogleEntryProfile(resolvedUser);
        }

        const name = (googleRoomProfile?.name || (playerNameInput ? playerNameInput.value.trim() : "")).trim();
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
                profile: googleRoomProfile,
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
        stopFaceCamera({ silent: true });
        myPlayerNumber = null;
        selectedRole = "spectator";

        document.body.classList.add("spectator-mode");
        document.body.classList.remove("camera-mode");
        document.body.classList.remove("player-one-active", "player-two-active", "focus-mode");
        document.body.classList.remove("spectator-mobile-chat-open");
        closePlayerChatPanel();

        if (spectatorMicStatus) spectatorMicStatus.innerText = "Você está mutado";
        if (requestSpectatorMicBtn) {
            requestSpectatorMicBtn.dataset.allowed = "false";
            requestSpectatorMicBtn.innerText = "Solicitar microfone";
            requestSpectatorMicBtn.disabled = false;
        }

        showLeaveSpectatorButton();
        updateFaceCameraControls();
        renderAllMarkerPanels();
        renderMatchScore(currentMatchScore);
        return;
    }

    if (data.role === "camera") {
        stopFaceCamera({ silent: true });
        myPlayerNumber = null;
        selectedRole = "camera";

        document.body.classList.add("camera-mode");
        document.body.classList.remove("spectator-mode");
        document.body.classList.remove("player-one-active", "player-two-active", "focus-mode");

        showLeaveSpectatorButton();
        updateFaceCameraControls();
        renderAllMarkerPanels();
        return;
    }

    if (data.playerNumber) {
        myPlayerNumber = Number(data.playerNumber);
        myCameraKey = data.cameraKey || "";
        selectedRole = "player";

        document.body.classList.remove("spectator-mode");
        document.body.classList.remove("camera-mode");
        document.body.classList.toggle("player-one-active", myPlayerNumber === 1);
        document.body.classList.toggle("player-two-active", myPlayerNumber === 2);

        showLeaveSpectatorButton();
        updateFaceCameraControls();
        renderAllMarkerPanels();
        renderMatchScore(currentMatchScore);
        syncActiveMarkersToRoom();
    }
});

socket.on("room-full", () => {
    alert("Sala cheia. Você pode entrar como espectador.");
});

socket.on("resenha-queue-update", ({ position }) => {
    const text = position
        ? `Você entrou na fila da Mesa da Resenha. Posição ${position}.`
        : "Você entrou na fila da Mesa da Resenha.";

    isQueuedInResenha = position > 0;
    updateResenhaRoleButtons();

    if (entryError) entryError.innerText = text;
    addMatchEvent(text);
});

socket.on("room-state", (state) => {
    const players = Array.isArray(state.players) ? state.players : [];

    currentPlayers = players;
    currentCameraClients = Array.isArray(state.cameraClients) ? state.cameraClients : [];
    currentSpectators = Array.isArray(state.spectatorList) ? state.spectatorList : [];
    currentQueue = Array.isArray(state.queueList) ? state.queueList : [];
    isQueuedInResenha = roomId === "mtg-1002" && currentQueue.some(item => item.socketId === socket.id);
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
    updateCameraTitles(p1, p2);

    applyRoomMarkerState(state.markerState || {});
    renderMatchScore(state.matchScore || {});
    renderLifeHistory(state.lifeHistory || []);
    renderSpectatorMarkerSummary(state.markerState || {});
    updateTimerDisplay(state.timer);
    updateResenhaRoleButtons();

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
        const newLife = Number(playerData.life ?? 20);
        const previousLife = previousOfficialLife[playerNumber];

        if (name) name.innerText = playerData.name || `Jogador ${playerNumber}`;
        if (deck) deck.innerText = playerData.deck || "---";
        if (guild) guild.innerText = playerData.guild || "---";
        if (life) life.innerText = newLife;

        if (typeof previousLife === "number" && previousLife !== newLife) {
            showLifeDelta(playerNumber, newLife - previousLife);
        }

        previousOfficialLife[playerNumber] = newLife;
    } else {
        if (name) name.innerText = `Jogador ${playerNumber}`;
        if (deck) deck.innerText = "Aguardando...";
        if (guild) guild.innerText = "---";
        if (life) life.innerText = "20";
        delete previousOfficialLife[playerNumber];
    }
}

function updateCameraTitles(playerOne, playerTwo) {
    const titleOne = document.getElementById("localCameraTitle");
    const titleTwo = document.getElementById("remoteCameraTitle");

    if (titleOne) {
        titleOne.innerText = playerOne?.name || "Jogador 1";
    }

    if (titleTwo) {
        titleTwo.innerText = playerTwo?.name || "Jogador 2";
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

window.setLocalMutedIconState = updateLocalMutedIcon;
window.setRemoteMutedIconState = updateRemoteMutedIcon;

function getPlayerMicSocketId(player, cameras) {
    if (!player) return "";

    const linkedCamera = cameras.find(c => Number(c.linkedPlayer) === Number(player.playerNumber));
    return linkedCamera?.socketId || player.socketId || "";
}

function updateMutedIconForPlayer(playerNumber, micEnabled) {
    if (Number(playerNumber) === 1) {
        updateLocalMutedIcon(micEnabled);
    } else if (Number(playerNumber) === 2) {
        updateRemoteMutedIcon(micEnabled);
    }
}

function updateMicIconsFromState(state) {
    const players = Array.isArray(state.players) ? state.players : [];
    const cameras = Array.isArray(state.cameraClients) ? state.cameraClients : [];
    const micStatus = state.micStatus || {};

    if (selectedRole === "spectator") {
        [1, 2].forEach(playerNumber => {
            const player = players.find(p => Number(p.playerNumber) === Number(playerNumber));
            const micId = getPlayerMicSocketId(player, cameras);

            if (micId && micStatus[micId] !== undefined) {
                updateMutedIconForPlayer(playerNumber, micStatus[micId]);
            } else {
                updateMutedIconForPlayer(playerNumber, true);
            }
        });
        return;
    }

    const me = players.find(p => Number(p.playerNumber) === myPlayerNumber);
    const remote = players.find(p => Number(p.playerNumber) !== myPlayerNumber);

    const localMicId = getPlayerMicSocketId(me, cameras);
    const remoteMicId = getPlayerMicSocketId(remote, cameras);

    if (localMicId && micStatus[localMicId] !== undefined) {
        updateLocalMutedIcon(micStatus[localMicId]);
    }

    if (remoteMicId && micStatus[remoteMicId] !== undefined) {
        updateRemoteMutedIcon(micStatus[remoteMicId]);
    }
}

socket.on("mic-status-update", ({ socketId, micEnabled, info }) => {
    if (info?.role === "spectator") {
        return;
    }

    const linkedPlayer = Number(info?.linkedPlayer || info?.playerNumber || 0);

    if (selectedRole === "spectator") {
        updateMutedIconForPlayer(linkedPlayer, micEnabled);
        return;
    }

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

function isActivePlayer() {
    return (
        selectedRole === "player" &&
        !isQueuedInResenha &&
        [1, 2].includes(Number(myPlayerNumber)) &&
        currentPlayers.some(player => Number(player.playerNumber) === Number(myPlayerNumber))
    );
}

function isActivePlayerSlot(playerNumber) {
    return currentPlayers.some(player => Number(player.playerNumber) === Number(playerNumber));
}

function getOpponentPlayerNumber() {
    const normalizedPlayer = Number(myPlayerNumber);

    if (normalizedPlayer === 1) return 2;
    if (normalizedPlayer === 2) return 1;

    return null;
}

function normalizeMatchScore(score = {}) {
    return {
        1: Math.max(0, Math.min(3, Number(score[1] ?? score["1"]) || 0)),
        2: Math.max(0, Math.min(3, Number(score[2] ?? score["2"]) || 0))
    };
}

function renderScoreGroup(group, value, editable = false) {
    if (!group) return;

    group.classList.toggle("is-editable", editable);

    group.querySelectorAll(".match-score-slot").forEach(slot => {
        const slotValue = Number(slot.dataset.scoreSlot || 0);
        const filled = slotValue <= value;

        slot.classList.toggle("is-filled", filled);
        slot.setAttribute("aria-pressed", filled ? "true" : "false");
        slot.setAttribute("role", editable ? "button" : "img");
        slot.tabIndex = editable ? 0 : -1;
    });
}

function renderMatchScore(score = {}) {
    const previousScore = { ...currentMatchScore };
    const nextScore = normalizeMatchScore(score);

    if (hasReceivedMatchScore) {
        [1, 2].forEach(playerNumber => {
            if ((previousScore[playerNumber] || 0) < 2 && nextScore[playerNumber] === 2) {
                showVictoryOverlay(playerNumber);
            }
        });
    }

    currentMatchScore = nextScore;
    hasReceivedMatchScore = true;

    document.querySelectorAll("[data-score-player]").forEach(group => {
        const playerNumber = Number(group.dataset.scorePlayer);
        renderScoreGroup(
            group,
            currentMatchScore[playerNumber] || 0,
            selectedRole === "player" && Number(myPlayerNumber) === playerNumber && isActivePlayer()
        );
    });

    document.querySelectorAll("[data-opponent-score-for]").forEach(group => {
        const panelPlayerNumber = Number(group.dataset.opponentScoreFor);
        const opponentPlayerNumber = panelPlayerNumber === 1 ? 2 : 1;
        renderScoreGroup(group, currentMatchScore[opponentPlayerNumber] || 0, false);
    });
}

function playVictorySound() {
    try {
        const ctx = getTimerAudioContext();
        if (!ctx) return;

        const notes = [523.25, 659.25, 783.99, 1046.5];
        const now = ctx.currentTime;

        notes.forEach((frequency, index) => {
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            const start = now + index * 0.12;

            oscillator.type = "triangle";
            oscillator.frequency.setValueAtTime(frequency, start);
            gain.gain.setValueAtTime(0.001, start);
            gain.gain.exponentialRampToValueAtTime(0.12, start + 0.025);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);

            oscillator.connect(gain);
            gain.connect(ctx.destination);
            oscillator.start(start);
            oscillator.stop(start + 0.24);
        });
    } catch (error) {
        console.warn("Som de vitória bloqueado:", error);
    }
}

function showVictoryOverlay(playerNumber) {
    const playerName = getPlayerNameByNumber(playerNumber);
    let overlay = document.getElementById("victoryOverlay");

    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "victoryOverlay";
        overlay.className = "victory-overlay hidden";
        overlay.innerHTML = `
            <div class="victory-card">
                <div class="victory-emoji" aria-hidden="true">🎉</div>
                <strong class="victory-name"></strong>
                <span class="victory-text">WINS</span>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    overlay.querySelector(".victory-name").innerText = playerName;
    overlay.classList.remove("hidden");
    overlay.classList.remove("is-showing");
    void overlay.offsetWidth;
    overlay.classList.add("is-showing");

    playVictorySound();

    if (victoryOverlayTimer) {
        clearTimeout(victoryOverlayTimer);
    }

    victoryOverlayTimer = setTimeout(() => {
        overlay.classList.add("hidden");
        overlay.classList.remove("is-showing");
    }, 4200);
}

function updateMyMatchScoreFromSlot(slot) {
    if (!isActivePlayer()) return;

    const group = slot.closest("[data-score-player]");
    const playerNumber = Number(group?.dataset.scorePlayer || 0);
    const slotValue = Number(slot.dataset.scoreSlot || 0);

    if (playerNumber !== Number(myPlayerNumber)) return;
    if (![1, 2, 3].includes(slotValue)) return;

    const currentValue = currentMatchScore[playerNumber] || 0;
    const nextValue = currentValue >= slotValue ? slotValue - 1 : slotValue;

    socket.emit("match-score-update", {
        roomId,
        playerNumber,
        score: nextValue
    });
}

document.querySelectorAll("[data-score-player] .match-score-slot").forEach(slot => {
    slot.addEventListener("click", () => updateMyMatchScoreFromSlot(slot));
    slot.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;

        event.preventDefault();
        updateMyMatchScoreFromSlot(slot);
    });
});

function showLifeDeltaBesideElement(timerKey, lifeElement, delta) {
    const amount = Number(delta);
    if (!amount) return;

    const container = lifeElement?.closest(".life-control-box");
    if (!lifeElement || !container) return;

    const previousDelta = container.querySelector(".life-delta");
    if (previousDelta) previousDelta.remove();

    if (lifeDeltaTimers[timerKey]) {
        clearTimeout(lifeDeltaTimers[timerKey]);
    }

    const deltaEl = document.createElement("span");
    deltaEl.className = `life-delta ${amount > 0 ? "positive" : "negative"}`;
    deltaEl.innerText = amount > 0 ? `+${amount}` : String(amount);

    container.appendChild(deltaEl);

    lifeDeltaTimers[timerKey] = setTimeout(() => {
        deltaEl.remove();
        delete lifeDeltaTimers[timerKey];
    }, 1000);
}

function showLifeDelta(playerNumber, delta) {
    showLifeDeltaBesideElement(
        `official-${playerNumber}`,
        document.getElementById(`player${playerNumber}Life`),
        delta
    );
}

function showOpponentLifeDelta(panelPlayerNumber, delta) {
    showLifeDeltaBesideElement(
        `opponent-${panelPlayerNumber}`,
        document.getElementById(`player${panelPlayerNumber}OpponentLife`),
        delta
    );
}

function addLocalOpponentLifeHistory(panelPlayerNumber, oldLife, newLife) {
    if (selectedRole !== "player") return;
    if (Number(panelPlayerNumber) !== Number(myPlayerNumber)) return;

    const previous = Number(oldLife);
    const next = Number(newLife);
    if (!Number.isFinite(previous) || !Number.isFinite(next)) return;
    if (previous === next) return;

    localOpponentLifeHistory.push({
        oldLife: previous,
        newLife: next,
        time: new Date().toLocaleTimeString("pt-BR")
    });

    renderLifeHistoryPanel();
}

function updateLife(playerNumber, delta) {
    const normalizedPlayer = Number(playerNumber);
    const amount = Number(delta);

    if (!isActivePlayer()) return false;
    if (![1, 2].includes(normalizedPlayer)) return false;
    if (!isActivePlayerSlot(normalizedPlayer)) return false;
    if (!amount) return false;

    socket.emit("change-life", {
        roomId,
        playerNumber: normalizedPlayer,
        amount
    });

    return true;
}

function isLifeShortcutBlocked(event) {
    const target = event.target;
    const activeElement = document.activeElement;
    const editableElement = target?.closest?.("input, textarea, select, [contenteditable='true']");
    const notesPanel = document.getElementById("tableNotesPanel");

    if (editableElement) return true;

    return !!(
        notesPanel &&
        !notesPanel.classList.contains("hidden") &&
        activeElement &&
        notesPanel.contains(activeElement)
    );
}

function handleLifeShortcut(event) {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    if (isLifeShortcutBlocked(event)) return;
    if (!isActivePlayer()) return;

    let processed = false;

    if (event.key === "ArrowUp") {
        processed = updateLife(myPlayerNumber, 1);
    } else if (event.key === "ArrowDown") {
        processed = updateLife(myPlayerNumber, -1);
    } else if (event.key === "ArrowLeft") {
        processed = window.changeOpponentLifeLocal(myPlayerNumber, 1);
    } else if (event.key === "ArrowRight") {
        processed = window.changeOpponentLifeLocal(myPlayerNumber, -1);
    }

    if (processed) {
        event.preventDefault();
    }
}

function changeOfficialLife(playerNumber, amount) {
    if (selectedRole !== "player") return;

    if (Number(playerNumber) !== Number(myPlayerNumber)) {
        alert("Você só pode alterar a sua própria vida oficial.");
        return;
    }

    updateLife(myPlayerNumber, amount);
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

    updateLife(myPlayerNumber, amount);
};

document.addEventListener("keydown", handleLifeShortcut);

window.toggleManualLifePanel = function(playerNumber) {
    if (selectedRole !== "player") return;

    if (Number(myPlayerNumber) !== Number(playerNumber)) {
        alert("Você só pode editar a sua própria vida oficial.");
        return;
    }

    const box = document.getElementById(`manualLifeBox${playerNumber}`);
    if (!box) return;

    box.classList.toggle("hidden");
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

window.toggleOpponentLife = function(panelPlayerNumber) {
    if (selectedRole !== "player") return;

    if (Number(panelPlayerNumber) !== Number(myPlayerNumber)) {
        alert("Você só pode abrir a vida do oponente no seu painel.");
        return;
    }

    const box = document.getElementById(`opponentLifeBox${panelPlayerNumber}`);
    if (!box) return;

    box.classList.toggle("hidden");
};

window.changeOpponentLifeLocal = function(panelPlayerNumber, amount) {
    if (selectedRole !== "player") return false;

    if (Number(panelPlayerNumber) !== Number(myPlayerNumber)) {
        alert("Você só pode alterar a anotação do oponente no seu painel.");
        return;
    }

    const box = document.getElementById(`player${panelPlayerNumber}OpponentLife`);
    if (!box) return false;

    const current = Number(box.innerText || 20);
    const delta = Number(amount);
    if (!delta) return false;

    const next = current + delta;
    box.innerText = next;
    addLocalOpponentLifeHistory(panelPlayerNumber, current, next);
    showOpponentLifeDelta(panelPlayerNumber, delta);
    return true;
};

window.setOpponentLifeLocal = function(panelPlayerNumber) {
    if (selectedRole !== "player") return;

    if (Number(panelPlayerNumber) !== Number(myPlayerNumber)) {
        alert("Você só pode alterar a anotação do oponente no seu painel.");
        return;
    }

    const input = document.getElementById(`opponentManualLife${panelPlayerNumber}`);
    const box = document.getElementById(`player${panelPlayerNumber}OpponentLife`);

    if (!input || !box) return;

    const value = Number(input.value);

    if (isNaN(value) || input.value === "") {
        alert("Digite um valor válido para a vida do oponente.");
        return;
    }

    const current = Number(box.innerText || 20);
    box.innerText = value;
    addLocalOpponentLifeHistory(panelPlayerNumber, current, value);
    input.value = "";
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

        const currentValue = Number(lifeBox.innerText || 20);
        lifeBox.innerText = newValue;
        addLocalOpponentLifeHistory(panelPlayerNumber, currentValue, newValue);
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
    closeRoomTabOrHome(300);
};

window.confirmLeaveRoom = function() {
    if (!leaveConfirmModal) {
        window.leaveRoom?.();
        return;
    }

    leaveConfirmModal.classList.remove("hidden");
};

function closeLeaveConfirmModal() {
    leaveConfirmModal?.classList.add("hidden");
}

socket.on("left-room", () => {
    closeRoomTabOrHome(0);
});

if (leaveSpectatorBtn) {
    leaveSpectatorBtn.addEventListener("click", () => {
        window.confirmLeaveRoom?.();
    });
}

if (cancelLeaveRoomBtn) {
    cancelLeaveRoomBtn.addEventListener("click", closeLeaveConfirmModal);
}

if (confirmLeaveRoomBtn) {
    confirmLeaveRoomBtn.addEventListener("click", () => {
        closeLeaveConfirmModal();
        window.leaveRoom?.();
    });
}

if (leaveConfirmModal) {
    leaveConfirmModal.addEventListener("click", (event) => {
        if (event.target === leaveConfirmModal) {
            closeLeaveConfirmModal();
        }
    });
}

if (cameraFramingBtn) {
    cameraFramingBtn.addEventListener("click", () => toggleCameraFramingPanel());
}

if (closeCameraFramingBtn) {
    closeCameraFramingBtn.addEventListener("click", () => toggleCameraFramingPanel(false));
}

if (cameraZoomRange) {
    cameraZoomRange.addEventListener("input", () => {
        setCameraFraming({ zoom: Number(cameraZoomRange.value) });
    });
}

if (cameraXRange) {
    cameraXRange.addEventListener("input", () => {
        setCameraFraming({ x: Number(cameraXRange.value) });
    });
}

if (cameraYRange) {
    cameraYRange.addEventListener("input", () => {
        setCameraFraming({ y: Number(cameraYRange.value) });
    });
}

document.querySelectorAll("[data-camera-move]").forEach(button => {
    button.addEventListener("click", () => {
        const direction = button.dataset.cameraMove;
        const step = cameraFramingLimits.offset.step;
        const nextValue = { ...cameraFraming };

        if (direction === "up") nextValue.y -= step;
        if (direction === "down") nextValue.y += step;
        if (direction === "left") nextValue.x -= step;
        if (direction === "right") nextValue.x += step;

        setCameraFraming(nextValue);
    });
});

if (resetCameraFramingBtn) {
    resetCameraFramingBtn.addEventListener("click", resetCameraFraming);
}

if (saveCameraFramingBtn) {
    saveCameraFramingBtn.addEventListener("click", () => {
        saveCameraFraming();
        toggleCameraFramingPanel(false);
    });
}

if (toggleFaceCameraBtn) {
    toggleFaceCameraBtn.addEventListener("click", toggleFaceCamera);
}

if (faceCameraSelect) {
    faceCameraSelect.addEventListener("change", async () => {
        faceCameraDeviceId = faceCameraSelect.value;

        if (faceCameraDeviceId) {
            localStorage.setItem("magicSelectedFaceCamera", faceCameraDeviceId);
        }

        if (faceCameraStream) {
            await startFaceCamera();
        }
    });
}

const mainCameraSelectForFace = document.getElementById("cameraSelect");

if (mainCameraSelectForFace) {
    mainCameraSelectForFace.addEventListener("change", async () => {
        const activeFaceDeviceId = getActiveFaceCameraDeviceId();

        await getFaceCameraDevices().catch(() => {});

        if (faceCameraStream && activeFaceDeviceId && activeFaceDeviceId === getMainCameraDeviceId()) {
            stopFaceCamera({ silent: true });
            showRoomToast("FaceCam desligada para liberar a câmera principal.");
        }
    });
}

const originalShutdownRoomConnection = window.shutdownRoomConnection;

if (typeof originalShutdownRoomConnection === "function") {
    window.shutdownRoomConnection = function(...args) {
        stopFaceCamera({ silent: true });
        return originalShutdownRoomConnection.apply(this, args);
    };
}

window.addEventListener("beforeunload", () => {
    stopFaceCamera({ silent: true });
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

        if (person.actionLabel && person.onAction) {
            const action = document.createElement("button");
            action.type = "button";
            action.className = "room-user-action";
            action.innerText = person.actionLabel;
            action.addEventListener("click", person.onAction);
            item.appendChild(action);
        }

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
                status: s.micAllowed
                    ? (s.micEnabled ? "🎙️ Microfone ativo" : "✅ Microfone liberado")
                    : "🔇 Microfone mutado",
                actionLabel: selectedRole === "player" ? (s.micAllowed ? "Mutar" : "Desmutar") : "",
                onAction: selectedRole === "player"
                    ? () => socket.emit("spectator-mic-permission", {
                        roomId,
                        spectatorSocketId: s.socketId,
                        allow: !s.micAllowed
                    })
                    : null
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

function updateResenhaRoleButtons() {
    if (roomId !== "mtg-1002") {
        resenhaBecomeSpectatorBtn?.classList.add("hidden");
        resenhaBecomePlayerBtn?.classList.add("hidden");
        return;
    }

    const isActivePlayer = selectedRole === "player";
    const isSpectatorOnly = selectedRole === "spectator" && !isQueuedInResenha;
    const canBecomeSpectator = isActivePlayer || isQueuedInResenha;

    resenhaBecomeSpectatorBtn?.classList.toggle("hidden", !canBecomeSpectator);
    resenhaBecomePlayerBtn?.classList.toggle("hidden", !isSpectatorOnly);
}

if (resenhaBecomeSpectatorBtn) {
    resenhaBecomeSpectatorBtn.addEventListener("click", () => {
        socket.emit("resenha-become-spectator", { roomId });
    });
}

if (resenhaBecomePlayerBtn) {
    resenhaBecomePlayerBtn.addEventListener("click", () => {
        socket.emit("resenha-become-player", { roomId });
    });
}

function showSpectatorMicRequest(data) {
    const existing = document.querySelector(`[data-mic-request="${data.spectatorSocketId}"]`);
    if (existing) existing.remove();

    const prompt = document.createElement("div");
    prompt.className = "mic-request-toast";
    prompt.dataset.micRequest = data.spectatorSocketId;

    const img = document.createElement("img");
    img.src = data.photo || "/assets/default-avatar.png";
    img.alt = data.name || "Espectador";

    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.innerText = data.name || "Espectador";
    const subtitle = document.createElement("span");
    subtitle.innerText = "solicitou microfone";
    text.appendChild(title);
    text.appendChild(subtitle);

    const actions = document.createElement("div");
    actions.className = "mic-request-actions";

    const allow = document.createElement("button");
    allow.type = "button";
    allow.innerText = "Permitir áudio";
    allow.addEventListener("click", () => {
        socket.emit("spectator-mic-response", {
            roomId,
            spectatorSocketId: data.spectatorSocketId,
            allow: true
        });
        prompt.remove();
    });

    const deny = document.createElement("button");
    deny.type = "button";
    deny.innerText = "Negar";
    deny.addEventListener("click", () => {
        socket.emit("spectator-mic-response", {
            roomId,
            spectatorSocketId: data.spectatorSocketId,
            allow: false
        });
        prompt.remove();
    });

    actions.appendChild(allow);
    actions.appendChild(deny);
    prompt.appendChild(img);
    prompt.appendChild(text);
    prompt.appendChild(actions);
    document.body.appendChild(prompt);
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

function isTypingInEditableField() {
    const activeElement = document.activeElement;
    const tag = activeElement?.tagName;

    return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        activeElement?.isContentEditable ||
        !!activeElement?.closest?.("#chatContainer, #spectatorBottomArea, #tableNotesPanel")
    );
}

function isEntryModalVisible() {
    if (!entryModal) return false;
    if (entryModal.classList.contains("hidden")) return false;
    return window.getComputedStyle(entryModal).display !== "none";
}

function enableDualView() {
    if (selectedRole === "camera") return;

    document.body.classList.remove("focus-mode");

    if (selectedRole === "spectator" && typeof window.setSpectatorFocus === "function") {
        window.setSpectatorFocus("both");
    }
}

function enableFocusMode() {
    if (selectedRole === "camera") return;

    if (selectedRole === "spectator") {
        if (typeof window.setSpectatorFocus === "function") {
            window.setSpectatorFocus("p1");
        }
        return;
    }

    document.body.classList.add("focus-mode");
}

function restoreDefaultLayout() {
    enableDualView();
}

function updateCleanControls() {
    cleanModeBtn?.classList.toggle("active", cleanModeEnabled);
    cleanModeBtnBottom?.classList.toggle("active", cleanModeEnabled);
    cleanExitBar?.classList.toggle("expanded", false);
}

function enableCleanMode() {
    cleanModeEnabled = true;
    cleanHudHidden = false;
    document.body.classList.add("clean-mode");
    document.body.classList.remove("clean-hud-hidden");
    updateCleanControls();
}

function disableCleanMode() {
    cleanModeEnabled = false;
    cleanHudHidden = false;
    document.body.classList.remove("clean-mode", "clean-hud-hidden");
    updateCleanControls();
}

function toggleCleanMode() {
    if (cleanModeEnabled) {
        disableCleanMode();
        return;
    }

    enableCleanMode();
}

function toggleCleanHud() {
    if (!cleanModeEnabled) return;

    cleanHudHidden = !cleanHudHidden;
    document.body.classList.toggle("clean-hud-hidden", cleanHudHidden);
}

window.toggleCleanMode = toggleCleanMode;
window.enableCleanMode = enableCleanMode;
window.disableCleanMode = disableCleanMode;
window.toggleCleanHud = toggleCleanHud;
window.restoreDefaultLayout = restoreDefaultLayout;

if (cleanModeBtn) {
    cleanModeBtn.addEventListener("click", toggleCleanMode);
}

if (cleanModeBtnBottom) {
    cleanModeBtnBottom.addEventListener("click", toggleCleanMode);
}

if (cleanMenuTab) {
    cleanMenuTab.addEventListener("click", () => {
        cleanExitBar?.classList.toggle("expanded");
    });
}

if (cleanExitBtn) {
    cleanExitBtn.addEventListener("click", () => {
        disableCleanMode();
        restoreDefaultLayout();
    });
}

if (cleanFocusBtn) {
    cleanFocusBtn.addEventListener("click", enableFocusMode);
}

if (cleanDualBtn) {
    cleanDualBtn.addEventListener("click", enableDualView);
}

if (cleanCopyRoomBtn) {
    cleanCopyRoomBtn.addEventListener("click", () => {
        copyRoomBtn?.click();
    });
}

if (cleanLeaveRoomBtn) {
    cleanLeaveRoomBtn.addEventListener("click", () => {
        window.confirmLeaveRoom?.();
    });
}

if (dualViewBtn) {
    dualViewBtn.addEventListener("click", () => {
        if (selectedRole === "spectator") return;
        enableDualView();
    });
}

if (dualViewBtnBottom) {
    dualViewBtnBottom.addEventListener("click", () => {
        if (selectedRole === "spectator") return;
        enableDualView();
    });
}

if (focusViewBtn) {
    focusViewBtn.addEventListener("click", () => {
        if (selectedRole === "spectator") return;
        enableFocusMode();
    });
}

if (fullscreenBtn) {
    fullscreenBtn.addEventListener("click", () => {
        document.documentElement.requestFullscreen();
    });
}

document.addEventListener("keydown", (event) => {
    if (isEntryModalVisible()) return;
    if (isTypingInEditableField()) return;

    if (event.altKey && event.code === "KeyC") {
        event.preventDefault();
        toggleCleanMode();
        console.log("[UI] Clean mode toggled");
        return;
    }

    if (event.altKey && event.code === "KeyF") {
        event.preventDefault();
        enableFocusMode();
        console.log("[UI] Focus mode enabled");
        return;
    }

    if (event.altKey && event.code === "KeyD") {
        event.preventDefault();
        enableDualView();
        console.log("[UI] Dual view enabled");
        return;
    }

    if (event.altKey && event.code === "KeyH") {
        event.preventDefault();
        toggleCleanHud();
        console.log("[UI] Clean HUD toggled");
        return;
    }

    if (event.code === "Escape" && cleanModeEnabled) {
        event.preventDefault();
        disableCleanMode();
        restoreDefaultLayout();
        console.log("[UI] Layout restored");
    }
});

/* =========================
   TIMER
========================= */

function formatTimer(seconds) {
    if (!seconds && seconds !== 0) return "50:00";

    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;

    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function getTimerAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!timerAudioContext) {
        timerAudioContext = new AudioContextClass();
    }

    if (timerAudioContext.state === "suspended") {
        timerAudioContext.resume().catch(() => {});
    }

    return timerAudioContext;
}

function playTimerBeep() {
    try {
        const ctx = getTimerAudioContext();
        if (!ctx) return;

        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        const now = ctx.currentTime;

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.24);
    } catch (error) {
        console.warn("Alerta sonoro do timer bloqueado:", error);
    }
}

function playTimerSiren() {
    try {
        const ctx = getTimerAudioContext();
        if (!ctx) return;

        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        const now = ctx.currentTime;
        const duration = 5;

        oscillator.type = "sawtooth";
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.16, now + 0.08);

        for (let i = 0; i <= duration * 4; i++) {
            const time = now + i * 0.25;
            oscillator.frequency.setValueAtTime(i % 2 === 0 ? 620 : 920, time);
        }

        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(now);
        oscillator.stop(now + duration);
    } catch (error) {
        console.warn("Sirene do timer bloqueada:", error);
    }
}

function resetTimerAlerts() {
    firedTimerAlerts.clear();
    timerSirenPlayed = false;
    lastTimerRemaining = null;
}

function applyTimerVisualState(remaining) {
    const timerDisplay = document.getElementById("timerDisplay");
    if (!timerDisplay) return;

    timerDisplay.classList.remove("timer-warning", "timer-danger", "timer-ended");

    if (remaining <= 0) {
        timerDisplay.classList.add("timer-ended");
        return;
    }

    if (remaining <= 300) {
        timerDisplay.classList.add("timer-danger");
        return;
    }

    if (remaining <= 1200) {
        timerDisplay.classList.add("timer-warning");
    }
}

function processTimerAlerts(remaining, isRunning) {
    if (lastTimerRemaining !== null && remaining > lastTimerRemaining + 1) {
        resetTimerAlerts();
    }

    applyTimerVisualState(remaining);

    if (!isRunning || lastTimerRemaining === null) {
        lastTimerRemaining = remaining;
        return;
    }

    timerAlertMarks.forEach(mark => {
        if (lastTimerRemaining > mark && remaining <= mark && !firedTimerAlerts.has(mark)) {
            firedTimerAlerts.add(mark);
            playTimerBeep();
        }
    });

    if (lastTimerRemaining > 0 && remaining <= 0 && !timerSirenPlayed) {
        timerSirenPlayed = true;
        playTimerSiren();
    }

    lastTimerRemaining = remaining;
}

function updateTimerDisplay(timer) {
    const timerDisplay = document.getElementById("timerDisplay");
    if (!timerDisplay) return;

    if (!timer) {
        timerDisplay.innerText = "50:00";
        resetTimerAlerts();
        applyTimerVisualState(3000);
        return;
    }

    const remaining = Number(timer.remaining || 0);
    timerDisplay.innerText = formatTimer(remaining);
    processTimerAlerts(remaining, timer.running === true);
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

    resetTimerAlerts();
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
    resetTimerAlerts();
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

    const panel = document.getElementById("lifeHistoryFloatingPanel");
    if (!panel) return;

    panel.classList.toggle("hidden");
    renderLifeHistoryPanel();
};

window.closeLifeHistoryPanel = function() {
    document.getElementById("lifeHistoryFloatingPanel")?.classList.add("hidden");
};

function renderLifeHistory(history = []) {
    currentLifeHistory = Array.isArray(history) ? history : [];
    renderLifeHistoryPanel();

    currentLifeHistory.forEach(item => {
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
        list.innerHTML = `<p class="empty-history">Sem registros.</p>`;
        return;
    }

    list.innerHTML = "";

    history.forEach(item => {
        const div = document.createElement("div");
        div.className = "history-item-small";
        const diff = Number(item.newLife) - Number(item.oldLife);
        const diffText = diff > 0 ? `+${diff}` : String(diff);

        div.innerHTML = `
            <span>${diffText} ${item.oldLife} → ${item.newLife}</span>
            <small>${item.time || ""}</small>
        `;

        list.appendChild(div);
    });
}

function getLifeHistoryGroups() {
    if (selectedRole !== "player" || !myPlayerNumber) {
        return {
            mine: [],
            opponentByMe: localOpponentLifeHistory,
            opponentReal: []
        };
    }

    const opponentPlayerNumber = getOpponentPlayerNumber();

    return {
        mine: currentLifeHistory.filter(item => Number(item.playerNumber) === Number(myPlayerNumber)),
        opponentByMe: localOpponentLifeHistory,
        opponentReal: currentLifeHistory.filter(item => Number(item.playerNumber) === Number(opponentPlayerNumber))
    };
}

function renderLifeHistoryPanel() {
    const myList = document.getElementById("myLifeHistoryList");
    const opponentByMeList = document.getElementById("opponentByMeLifeHistoryList");
    const opponentRealList = document.getElementById("opponentRealLifeHistoryList");

    if (!myList || !opponentByMeList || !opponentRealList) return;

    const groups = getLifeHistoryGroups();

    renderPlayerHistory(myList, groups.mine);
    renderPlayerHistory(opponentByMeList, groups.opponentByMe);
    renderPlayerHistory(opponentRealList, groups.opponentReal);
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
    localOpponentLifeHistory = [];
    renderLifeHistoryPanel();
    socket.emit("clear-life-history", { roomId });
};
/* =========================
   MARCADORES POR JOGADOR
========================= */

const MARKER_DEFINITIONS = [
    { id: "storm", label: "Storm", icon: "\u{1F329}" },
    { id: "poison", label: "Veneno", icon: "\u{2620}\u{FE0F}" },
    { id: "energy", label: "Energia", icon: "\u{26A1}" },
    { id: "mana-white", label: "Mana Branca", icon: "\u{26AA}" },
    { id: "mana-blue", label: "Mana Azul", icon: "\u{1F535}" },
    { id: "mana-black", label: "Mana Preta", icon: "\u{26AB}" },
    { id: "mana-red", label: "Mana Vermelha", icon: "\u{1F534}" },
    { id: "mana-green", label: "Mana Verde", icon: "\u{1F7E2}" },
    { id: "mana-colorless", label: "Mana Incolor", icon: "\u{25C7}" }
];

const markerDefinitionsById = MARKER_DEFINITIONS.reduce((map, marker) => {
    map[marker.id] = marker;
    return map;
}, {});

let markerPanelsOpen = {
    1: false,
    2: false
};

const playerMarkers = loadPlayerMarkers();

function getDefaultMarkerState() {
    return {
        1: {},
        2: {}
    };
}

function getMarkerStorageKey() {
    return `mt_markers_${roomId || "local"}`;
}

function loadPlayerMarkers() {
    const fallback = getDefaultMarkerState();

    try {
        const saved = JSON.parse(localStorage.getItem(getMarkerStorageKey()) || "null");
        if (!saved || typeof saved !== "object") return fallback;

        [1, 2].forEach(playerNumber => {
            const playerSaved = saved[playerNumber] || {};

            Object.entries(playerSaved).forEach(([markerId, marker]) => {
                if (!markerDefinitionsById[markerId]) return;

                fallback[playerNumber][markerId] = {
                    value: Math.max(0, Number(marker.value) || 0),
                    placement: marker.placement === "floating" ? "floating" : "sidebar"
                };
            });
        });
    } catch (error) {
        console.warn("Não foi possível carregar marcadores salvos.", error);
    }

    return fallback;
}

function savePlayerMarkers() {
    try {
        localStorage.setItem(getMarkerStorageKey(), JSON.stringify(playerMarkers));
    } catch (error) {
        console.warn("Não foi possível salvar marcadores.", error);
    }
}

function isMarkerUiVisible() {
    return selectedRole !== "spectator" && selectedRole !== "camera";
}

function createMarkerButton(text, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.innerText = text;
    button.addEventListener("click", onClick);
    return button;
}

function renderAllMarkerPanels() {
    renderMarkerPanel(1);
    renderMarkerPanel(2);
    renderFloatingMarkers();
}

function normalizeRoomMarkerState(markerState = {}) {
    const normalized = { 1: {}, 2: {} };

    [1, 2].forEach(playerNumber => {
        const markers = markerState[playerNumber] || markerState[String(playerNumber)] || {};

        Object.entries(markers).forEach(([markerId, marker]) => {
            if (!markerDefinitionsById[markerId]) return;

            normalized[playerNumber][markerId] = {
                value: Math.max(0, Number(marker?.value) || 0),
                placement: playerMarkers[playerNumber]?.[markerId]?.placement === "floating"
                    ? "floating"
                    : "sidebar"
            };
        });
    });

    return normalized;
}

function applyRoomMarkerState(markerState = {}) {
    const normalized = normalizeRoomMarkerState(markerState);

    [1, 2].forEach(playerNumber => {
        playerMarkers[playerNumber] = normalized[playerNumber];
    });

    currentRoomMarkerState = normalized;
    savePlayerMarkers();
    renderAllMarkerPanels();
}

function emitMarkerUpdate(playerNumber, markerId, action, amount = 0) {
    const marker = playerMarkers[playerNumber]?.[markerId] || null;

    socket.emit("marker-update", {
        roomId,
        playerNumber,
        markerId,
        marker,
        action,
        amount
    });
}

function syncActiveMarkersToRoom() {
    [1, 2].forEach(playerNumber => {
        if (selectedRole === "player" && myPlayerNumber && Number(playerNumber) !== Number(myPlayerNumber)) return;

        Object.keys(playerMarkers[playerNumber] || {}).forEach(markerId => {
            emitMarkerUpdate(playerNumber, markerId, "sync");
        });
    });
}

function renderMarkerPanel(playerNumber) {
    const root = document.querySelector(`[data-player-marker-area="${playerNumber}"]`);
    if (!root) return;

    root.innerHTML = "";

    if (selectedRole === "camera") return;

    const isOwnPanel =
        selectedRole === "player" &&
        myPlayerNumber &&
        Number(playerNumber) === Number(myPlayerNumber);

    if (!isOwnPanel) {
        renderReadOnlyMarkerPanel(root, playerNumber);
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "marker-manager";

    const toggle = createMarkerButton(
        markerPanelsOpen[playerNumber] ? "▴ Painel de Marcadores" : "▾ Painel de Marcadores",
        "marker-panel-toggle",
        () => {
            markerPanelsOpen[playerNumber] = !markerPanelsOpen[playerNumber];
            renderMarkerPanel(playerNumber);
        }
    );

    wrapper.appendChild(toggle);

    const activeSidebar = document.createElement("div");
    activeSidebar.className = "active-marker-list";

    getActiveMarkers(playerNumber)
        .filter(marker => marker.placement !== "floating")
        .forEach(marker => {
            activeSidebar.appendChild(createActiveMarkerCard(playerNumber, marker));
        });

    wrapper.appendChild(activeSidebar);

    if (markerPanelsOpen[playerNumber]) {
        wrapper.appendChild(createMarkerPicker(playerNumber));
    }

    root.appendChild(wrapper);
}

function renderReadOnlyMarkerPanel(root, playerNumber) {
    const markers = getActiveMarkers(playerNumber);

    if (!markers.length) return;

    const wrapper = document.createElement("div");
    wrapper.className = "readonly-marker-summary";

    const title = document.createElement("div");
    title.className = "readonly-marker-title";
    title.innerText = selectedRole === "player"
        ? "Marcadores ativos do oponente"
        : "Marcadores ativos";
    wrapper.appendChild(title);

    const list = document.createElement("div");
    list.className = "readonly-marker-list";

    markers.forEach(marker => {
        const item = document.createElement("div");
        item.className = "readonly-marker-item";
        item.innerHTML = `
            <span>${marker.icon} ${marker.label}</span>
            <strong>${marker.value}</strong>
        `;
        list.appendChild(item);
    });

    wrapper.appendChild(list);
    root.appendChild(wrapper);
}

function createMarkerPicker(playerNumber) {
    const panel = document.createElement("div");
    panel.className = "marker-picker";

    const title = document.createElement("div");
    title.className = "marker-picker-title";
    title.innerText = "Adicionar marcador";
    panel.appendChild(title);

    const available = document.createElement("div");
    available.className = "marker-option-grid";

    MARKER_DEFINITIONS
        .filter(marker => !playerMarkers[playerNumber][marker.id])
        .forEach(marker => {
            const option = createMarkerButton(
                `${marker.icon} ${marker.label}`,
                "marker-option-btn",
                () => addPlayerMarker(playerNumber, marker.id)
            );

            available.appendChild(option);
        });

    if (!available.children.length) {
        const empty = document.createElement("p");
        empty.className = "marker-empty";
        empty.innerText = "Todos os marcadores estão ativos.";
        available.appendChild(empty);
    }

    panel.appendChild(available);
    return panel;
}

function getActiveMarkers(playerNumber) {
    return Object.entries(playerMarkers[playerNumber] || {})
        .map(([id, data]) => ({
            ...markerDefinitionsById[id],
            value: data.value,
            placement: data.placement
        }))
        .filter(marker => marker.id);
}

function createActiveMarkerCard(playerNumber, marker) {
    const card = document.createElement("div");
    card.className = `dynamic-marker-card ${marker.placement === "floating" ? "is-floating" : ""}`;

    const header = document.createElement("div");
    header.className = "dynamic-marker-header";

    const label = document.createElement("span");
    label.innerText = `${marker.icon} ${marker.label}`;

    const close = createMarkerButton("×", "marker-close-btn", () => {
        removePlayerMarker(playerNumber, marker.id);
    });
    close.title = "Remover marcador";

    header.appendChild(label);
    header.appendChild(close);

    const controls = document.createElement("div");
    controls.className = "dynamic-marker-controls";

    const minus = createMarkerButton("−", "marker-count-btn", () => {
        changePlayerMarker(playerNumber, marker.id, -1);
    });

    const value = document.createElement("strong");
    value.innerText = marker.value;

    const plus = createMarkerButton("+", "marker-count-btn", () => {
        changePlayerMarker(playerNumber, marker.id, 1);
    });

    controls.appendChild(minus);
    controls.appendChild(value);
    controls.appendChild(plus);

    const placement = createMarkerButton(
        marker.placement === "floating" ? "Manter na barra lateral" : "Fixar na tela",
        "marker-placement-btn",
        () => toggleMarkerPlacement(playerNumber, marker.id)
    );

    card.appendChild(header);
    card.appendChild(controls);
    card.appendChild(placement);

    return card;
}

function getFloatingPlayerColumn(root, playerNumber) {
    const normalizedPlayer = Number(playerNumber);
    if (![1, 2].includes(normalizedPlayer)) return root;

    let column = root.querySelector(`[data-floating-player="${normalizedPlayer}"]`);

    if (!column) {
        column = document.createElement("div");
        column.className = `floating-player-column floating-player-${normalizedPlayer}`;
        column.dataset.floatingPlayer = String(normalizedPlayer);
        root.appendChild(column);
    }

    return column;
}

function renderFloatingMarkers() {
    const root = document.getElementById("floatingMarkersRoot");
    if (!root) return;

    root.innerHTML = "";
    root.classList.remove("has-facecams");
    root.parentElement?.classList.remove("has-floating-markers", "has-floating-player-1", "has-floating-player-2");

    let faceCameraCount = 0;
    const visiblePlayers = new Set();

    if (selectedRole === "player" && faceCameraStream) {
        const playerNumber = Number(myPlayerNumber);
        const column = getFloatingPlayerColumn(root, playerNumber);

        renderFaceCameraCard(column, {
            stream: faceCameraStream,
            playerNumber,
            isLocal: true
        });
        visiblePlayers.add(playerNumber);
        faceCameraCount++;
    }

    Object.entries(remoteFaceCameras).forEach(([playerNumber, camera]) => {
        const normalizedPlayer = Number(playerNumber);
        if (selectedRole === "player" && normalizedPlayer === Number(myPlayerNumber)) return;

        if (renderFaceCameraCard(getFloatingPlayerColumn(root, normalizedPlayer), {
            stream: camera.stream,
            playerNumber: normalizedPlayer,
            name: camera.name,
            isLocal: false
        })) {
            visiblePlayers.add(normalizedPlayer);
            faceCameraCount++;
        }
    });

    if (!isMarkerUiVisible()) {
        if (faceCameraCount > 0) {
            root.classList.add("has-facecams");
            root.parentElement?.classList.add("has-floating-markers");
            visiblePlayers.forEach(playerNumber => {
                root.parentElement?.classList.add(`has-floating-player-${playerNumber}`);
            });
        } else {
            root.classList.remove("has-facecams");
        }

        return;
    }

    let floatingCount = 0;

    [1, 2].forEach(playerNumber => {
        if (selectedRole === "player" && myPlayerNumber && Number(playerNumber) !== Number(myPlayerNumber)) return;

        getActiveMarkers(playerNumber)
            .filter(marker => marker.placement === "floating")
            .forEach(marker => {
                const card = createActiveMarkerCard(playerNumber, marker);
                card.classList.add(`floating-marker-player-${playerNumber}`);
                getFloatingPlayerColumn(root, playerNumber).appendChild(card);
                visiblePlayers.add(playerNumber);
                floatingCount++;
            });
    });

    root.classList.toggle("has-facecams", faceCameraCount > 0);

    if (faceCameraCount > 0 || floatingCount > 0) {
        root.parentElement?.classList.add("has-floating-markers");
        visiblePlayers.forEach(playerNumber => {
            root.parentElement?.classList.add(`has-floating-player-${playerNumber}`);
        });
    }
}

function addPlayerMarker(playerNumber, markerId) {
    if (!markerDefinitionsById[markerId]) return;
    if (selectedRole === "player" && Number(playerNumber) !== Number(myPlayerNumber)) return;

    playerMarkers[playerNumber][markerId] = {
        value: 0,
        placement: "sidebar"
    };

    savePlayerMarkers();
    renderAllMarkerPanels();
    emitMarkerUpdate(playerNumber, markerId, "add");
}

function removePlayerMarker(playerNumber, markerId) {
    if (!playerMarkers[playerNumber]?.[markerId]) return;
    if (selectedRole === "player" && Number(playerNumber) !== Number(myPlayerNumber)) return;

    delete playerMarkers[playerNumber][markerId];
    savePlayerMarkers();
    renderAllMarkerPanels();
    emitMarkerUpdate(playerNumber, markerId, "remove");
}

function toggleMarkerPlacement(playerNumber, markerId) {
    const marker = playerMarkers[playerNumber]?.[markerId];
    if (!marker) return;
    if (selectedRole === "player" && Number(playerNumber) !== Number(myPlayerNumber)) return;

    marker.placement = marker.placement === "floating" ? "sidebar" : "floating";
    savePlayerMarkers();
    renderAllMarkerPanels();
}

window.changePlayerMarker = function(playerNumber, markerId, amount) {
    const marker = playerMarkers[playerNumber]?.[markerId];
    if (!marker) return;
    if (selectedRole === "player" && Number(playerNumber) !== Number(myPlayerNumber)) return;

    const normalizedAmount = Number(amount);
    const oldValue = marker.value;
    marker.value = Math.max(0, marker.value + normalizedAmount);
    savePlayerMarkers();
    renderAllMarkerPanels();

    if (marker.value !== oldValue) {
        emitMarkerUpdate(playerNumber, markerId, "change", normalizedAmount);
    }
};

window.addEventListener("load", renderAllMarkerPanels);

function renderSpectatorMarkerSummary(markerState = {}) {
    if (!spectatorMarkersList) return;

    spectatorMarkersList.innerHTML = "";

    let hasMarkers = false;

    [1, 2].forEach(playerNumber => {
        const playerMarkersState = markerState[playerNumber] || markerState[String(playerNumber)] || {};
        const activeMarkers = Object.entries(playerMarkersState)
            .filter(([markerId]) => markerDefinitionsById[markerId])
            .map(([markerId, marker]) => ({
                ...markerDefinitionsById[markerId],
                value: Number(marker?.value) || 0
            }));

        if (!activeMarkers.length) return;

        hasMarkers = true;

        const group = document.createElement("div");
        group.className = "spectator-marker-group";

        const title = document.createElement("strong");
        title.innerText = `Jogador ${playerNumber}`;
        group.appendChild(title);

        const list = document.createElement("div");
        list.className = "spectator-marker-chips";

        activeMarkers.forEach(marker => {
            const chip = document.createElement("span");
            chip.innerText = `${marker.icon} ${marker.label} ${marker.value}`;
            list.appendChild(chip);
        });

        group.appendChild(list);
        spectatorMarkersList.appendChild(group);
    });

    if (!hasMarkers) {
        const empty = document.createElement("div");
        empty.className = "spectator-marker-empty";
        empty.innerText = "Nenhum marcador ativo.";
        spectatorMarkersList.appendChild(empty);
    }
}

/* =========================
   ANOTAÇÕES
========================= */

window.toggleNotesPanel = function() {
    if (selectedRole !== "player") return;

    const panel = document.getElementById("tableNotesPanel");
    if (!panel) return;

    panel.classList.toggle("hidden");
};

/* =========================
   CHAT / EMOTES
========================= */

function getEmotes() {
    return [
        { emoji: "\u{1F525}", label: "Fogo" },
        { emoji: "\u{1F602}", label: "Rindo" },
        { emoji: "\u{1F631}", label: "Surpreso" },
        { emoji: "\u{1F44F}", label: "Aplausos" },
        { emoji: "\u{2764}\u{FE0F}", label: "Coração" },
        { emoji: "\u{1F92B}", label: "Segredo" },
        { emoji: "\u{1F64F}", label: "Fé" },
        { emoji: "\u{1F44D}", label: "Joinha" },
        { emoji: "\u{1F44E}", label: "Joinha invertido" },
        { emoji: "\u{1F622}", label: "Choro" },
        { emoji: "\u{1F634}", label: "Dormindo" },
        { emoji: "\u{1F608}", label: "Maligno" },
        { emoji: "\u{1F928}", label: "Desconfiado" },
        { emoji: "\u{1F914}", label: "Pensando" }
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

function toggleChatPanel(forceOpen = null) {
    const container = document.getElementById("chatContainer");
    if (!container) return;

    if (forceOpen === true) {
        container.classList.remove("hidden");
        return;
    }

    if (forceOpen === false) {
        container.classList.add("hidden");
        return;
    }

    container.classList.toggle("hidden");
}

function closePlayerChatPanel() {
    document.getElementById("chatContainer")?.classList.add("hidden");
}

if (toggleChatBtn) {
    toggleChatBtn.addEventListener("click", () => {
        toggleChatPanel();
    });
}

if (closeChatBtn) {
    closeChatBtn.addEventListener("click", () => {
        closePlayerChatPanel();
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

if (requestSpectatorMicBtn) {
    requestSpectatorMicBtn.addEventListener("click", async () => {
        if (selectedRole !== "spectator") return;

        if (requestSpectatorMicBtn.dataset.allowed === "true") {
            try {
                await window.enableSpectatorMicrophone?.();
                if (spectatorMicStatus) spectatorMicStatus.innerText = "Microfone liberado";
                requestSpectatorMicBtn.innerText = "Microfone ativo";
                requestSpectatorMicBtn.disabled = true;
            } catch (error) {
                alert("Não foi possível ativar seu microfone.");
            }
            return;
        }

        socket.emit("spectator-mic-request", { roomId });
        if (spectatorMicStatus) spectatorMicStatus.innerText = "Solicitação enviada";
        requestSpectatorMicBtn.innerText = "Solicitação enviada";
        requestSpectatorMicBtn.disabled = true;
    });
}

if (spectatorMobileChatBtn) {
    spectatorMobileChatBtn.addEventListener("click", () => {
        document.body.classList.toggle("spectator-mobile-chat-open");
    });
}

socket.on("chat-message", (data) => {
    renderChatMessage(data);
});

socket.on("floating-emoji", (data) => {
    spawnFloatingEmoji(data?.message || data?.emoji, data?.name);
});

function showRoomToast(message) {
    const text = String(message || "").trim();
    if (!text) return;

    const container = document.getElementById("roomToastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "room-toast";
    toast.innerText = text;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 2100);
}

socket.on("room-join-toast", ({ name, role, playerNumber }) => {
    const now = Date.now();
    const key = `${name || ""}-${role || ""}-${playerNumber || ""}`;

    if (key === lastRoomToastKey && now - lastRoomToastAt < 2500) return;

    lastRoomToastKey = key;
    lastRoomToastAt = now;

    let label = "";

    if (role === "player") {
        label = `Jogador ${playerNumber || ""}`.trim();
    } else if (role === "spectator") {
        label = "Espectador";
    } else if (role === "camera") {
        label = "Câmera auxiliar";
    }

    if (!label) return;

    showRoomToast(`${name || "Usuário"} entrou como ${label}`);
});

socket.on("spectator-joined", ({ name }) => {
    addMatchEvent(`${name || "Um espectador"} entrou para assistir.`);
});

socket.on("system-event", (data) => {
    if (!data?.message) return;
    addMatchEvent(data.time ? `[${data.time}] ${data.message}` : data.message);
});

socket.on("spectator-mic-requested", (data) => {
    if (selectedRole !== "player") return;
    showSpectatorMicRequest(data);
});

socket.on("spectator-mic-status", async ({ status }) => {
    if (!spectatorMicStatus || !requestSpectatorMicBtn) return;

    if (status === "pending") {
        spectatorMicStatus.innerText = "Solicitação enviada";
        requestSpectatorMicBtn.innerText = "Solicitação enviada";
        requestSpectatorMicBtn.disabled = true;
        return;
    }

    if (status === "allowed") {
        spectatorMicStatus.innerText = "Microfone liberado";
        requestSpectatorMicBtn.dataset.allowed = "true";
        requestSpectatorMicBtn.innerText = "Ativar microfone";
        requestSpectatorMicBtn.disabled = false;
        return;
    }

    if (status === "denied") {
        spectatorMicStatus.innerText = "Microfone negado";
        requestSpectatorMicBtn.innerText = "Solicitar microfone";
        requestSpectatorMicBtn.disabled = false;
        return;
    }

    if (status === "muted") {
        await window.disableSpectatorMicrophone?.();
        spectatorMicStatus.innerText = "Você está mutado";
        requestSpectatorMicBtn.dataset.allowed = "false";
        requestSpectatorMicBtn.innerText = "Solicitar microfone";
        requestSpectatorMicBtn.disabled = false;
    }
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

function spawnFloatingEmoji(emoji, authorName = "") {
    if (!emoji) return;

    const el = document.createElement("div");
    const emojiEl = document.createElement("span");
    const nameEl = document.createElement("strong");
    const safeAuthorName = String(authorName || "").trim();

    el.className = "floating-emoji";
    emojiEl.className = "floating-emoji-symbol";
    emojiEl.innerText = emoji;

    nameEl.className = "floating-emoji-author";
    nameEl.innerText = safeAuthorName || "Jogador";

    el.appendChild(emojiEl);
    el.appendChild(nameEl);
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
    updateFaceCameraControls();
    getFaceCameraDevices().catch(() => {});
});

renderDiceHistory();

console.log("Sala.js carregado com sucesso");
