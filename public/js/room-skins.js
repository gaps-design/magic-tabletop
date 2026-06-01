(() => {
    const STORAGE_KEY = "resenhaon:selectedRoomSkin";

    const ROOM_SKINS = {
        none: {
            label: "Sem skin",
            image: null,
            accent: "#22d3ee"
        },
        "leme-tempestade": {
            label: "Leme Tempestade",
            image: "/assets/room-skins/leme-tempestade.png",
            accent: "#00ffd5"
        },
        floresta: {
            label: "Floresta do Entardecer",
            image: "/assets/room-skins/skinsala-floresta.png",
            accent: "#7CFC00"
        },
        pantano: {
            label: "Pântano Sombrio",
            image: "/assets/room-skins/skinsala-pantano.png",
            accent: "#5bff5b"
        },
        planice: {
            label: "Planície da Tempestade",
            image: "/assets/room-skins/skinsala-planice.png",
            accent: "#f5d77a"
        },
        raios: {
            label: "Terra dos Mil Raios",
            image: "/assets/room-skins/skinsala-raios.png",
            accent: "#ff3c3c"
        }
    };

    const params = new URLSearchParams(window.location.search);
    const roomId = params.get("room") || "default";
    const roomSkinSelect = document.getElementById("roomSkinSelect");
    const playerRoomSkins = { 1: "none", 2: "none" };
    const lastEmittedSkins = { 1: "", 2: "" };
    let lastRoomPlayers = [];
    let roomSkinSyncTimer = null;

    function getSocket() {
        if (typeof socket !== "undefined") return socket;
        return window.socket || null;
    }

    function normalizeRoomSkin(skinId) {
        return ROOM_SKINS[skinId] ? skinId : "none";
    }

    function getLocalPlayerNumber() {
        if (window.ResenhaONRoom?.getState) {
            const state = window.ResenhaONRoom.getState();
            if (Number(state?.myPlayerNumber) === 1) return 1;
            if (Number(state?.myPlayerNumber) === 2) return 2;
        }

        if (document.body.classList.contains("player-one-active")) return 1;
        if (document.body.classList.contains("player-two-active")) return 2;

        return null;
    }

    function getStorageKey(playerNumber) {
        return `${STORAGE_KEY}:${roomId}:player-${playerNumber}`;
    }

    function getPlayerElements(playerNumber) {
        return {
            panel: document.getElementById(`playerPanel${playerNumber}`),
            camera: document.querySelector(`.camera-player-${playerNumber}`),
            floatingColumn: document.querySelector(`.floating-player-${playerNumber}`)
        };
    }

    function ensureBackgroundLayer(cameraCard) {
        if (!cameraCard) return null;

        let layer = cameraCard.querySelector(":scope > .room-skin-background");
        if (!layer) {
            layer = document.createElement("div");
            layer.className = "room-skin-background";
            layer.setAttribute("aria-hidden", "true");
            cameraCard.prepend(layer);
        }

        return layer;
    }

    function hasVisibleVideoStream(video) {
        const stream = video?.srcObject;
        if (!(stream instanceof MediaStream)) return false;
        if (!video.videoWidth || !video.videoHeight) return false;

        const activeVideoTrack = stream.getVideoTracks().some(track =>
            track.readyState === "live" &&
            track.enabled !== false &&
            track.muted !== true
        );

        return activeVideoTrack;
    }

    function updateCameraVideoState(playerNumber) {
        const { camera } = getPlayerElements(playerNumber);
        const video = camera?.querySelector("video");
        if (!camera || !video) return;

        const hasVideo = hasVisibleVideoStream(video);
        camera.classList.toggle("room-skin-video-empty", !hasVideo);
        video.dataset.roomSkinVideoState = hasVideo ? "active" : "empty";
    }

    function bindCameraVideoState(cameraCard, playerNumber) {
        if (!cameraCard || cameraCard.dataset.roomSkinVideoStateBound === "true") return;

        cameraCard.dataset.roomSkinVideoStateBound = "true";
        const video = cameraCard.querySelector("video");
        if (!video) return;

        ["loadedmetadata", "loadeddata", "canplay", "playing", "pause", "emptied", "stalled", "suspend", "resize"].forEach(eventName => {
            video.addEventListener(eventName, () => updateCameraVideoState(playerNumber));
        });

        setInterval(() => updateCameraVideoState(playerNumber), 900);
        updateCameraVideoState(playerNumber);
    }

    function removeRoomSkinClasses(element) {
        if (!element) return;

        Array.from(element.classList).forEach(className => {
            if (className === "room-skin-background") return;
            if (className.startsWith("room-skin-")) {
                element.classList.remove(className);
            }
        });
    }

    function setRoomSkinProperties(element, skinId, skin) {
        if (!element) return;

        if (element.dataset.roomSkin !== skinId) {
            removeRoomSkinClasses(element);
            element.dataset.roomSkin = skinId;
        }

        element.classList.add("room-skin-active", `room-skin-${skinId}`);
        element.style.setProperty("--room-skin-accent", skin.accent);
        if (skin.image) {
            element.style.setProperty("--room-skin-bg", `url("${skin.image}")`);
        }
    }

    function clearRoomSkin(playerNumber) {
        const { panel, camera, floatingColumn } = getPlayerElements(playerNumber);

        [panel, camera, floatingColumn].forEach(element => {
            if (!element) return;
            removeRoomSkinClasses(element);
            element.removeAttribute("data-room-skin");
            element.style.removeProperty("--room-skin-bg");
            element.style.removeProperty("--room-skin-accent");
        });

        camera?.querySelector(":scope > .room-skin-background")?.remove();
    }

    function refreshFloatingRoomSkin(playerNumber) {
        const skinId = normalizeRoomSkin(playerRoomSkins[playerNumber] || "none");
        const skin = ROOM_SKINS[skinId];
        const { floatingColumn } = getPlayerElements(playerNumber);

        if (!floatingColumn) return;

        if (skinId === "none" || floatingColumn.childElementCount === 0) {
            removeRoomSkinClasses(floatingColumn);
            floatingColumn.removeAttribute("data-room-skin");
            floatingColumn.style.removeProperty("--room-skin-bg");
            floatingColumn.style.removeProperty("--room-skin-accent");
            return;
        }

        setRoomSkinProperties(floatingColumn, skinId, skin);
    }

    function applyRoomSkin(playerNumber, skinId, options = {}) {
        const normalizedSkinId = normalizeRoomSkin(skinId);
        const skin = ROOM_SKINS[normalizedSkinId];
        const { panel, camera, floatingColumn } = getPlayerElements(playerNumber);
        const previousSkinId = playerRoomSkins[playerNumber];

        playerRoomSkins[playerNumber] = normalizedSkinId;

        if (normalizedSkinId === "none") {
            clearRoomSkin(playerNumber);
            updateLocalAccent();
            return;
        }

        if (previousSkinId !== normalizedSkinId) {
            clearRoomSkin(playerNumber);
        }

        [panel, camera, floatingColumn].forEach(element => {
            setRoomSkinProperties(element, normalizedSkinId, skin);
        });

        ensureBackgroundLayer(camera);
        bindCameraVideoState(camera, playerNumber);
        updateCameraVideoState(playerNumber);
        updateLocalAccent();

        if (!options.silent) {
            console.log("[ROOM-SKIN] aplicada", { playerNumber, skinId: normalizedSkinId });
        }
    }

    function updateLocalAccent() {
        const localPlayerNumber = getLocalPlayerNumber();
        const localSkinId = localPlayerNumber ? playerRoomSkins[localPlayerNumber] : "none";
        const skin = ROOM_SKINS[localSkinId] || ROOM_SKINS.none;

        document.documentElement.style.setProperty("--local-room-skin-accent", skin.accent);
        document.body.dataset.localRoomSkin = localSkinId;

        if (roomSkinSelect && localPlayerNumber) {
            roomSkinSelect.value = normalizeRoomSkin(
                localStorage.getItem(getStorageKey(localPlayerNumber)) || localSkinId
            );
        }

        [1, 2].forEach(refreshFloatingRoomSkin);
    }

    function updateSelectAvailability() {
        if (!roomSkinSelect) return;

        const state = window.ResenhaONRoom?.getState?.();
        const isPlayer = state?.selectedRole === "player" || document.body.classList.contains("player-one-active") || document.body.classList.contains("player-two-active");
        roomSkinSelect.disabled = !isPlayer;
    }

    function emitRoomSkin(playerNumber, skinId) {
        const activeSocket = getSocket();
        if (!activeSocket?.emit) return;

        const normalizedSkinId = normalizeRoomSkin(skinId);
        if (lastEmittedSkins[playerNumber] === normalizedSkinId) return;
        lastEmittedSkins[playerNumber] = normalizedSkinId;

        activeSocket.emit("player-room-skin-change", {
            roomId,
            playerSlot: playerNumber,
            skinId: normalizedSkinId
        });
    }

    function setLocalRoomSkin(skinId) {
        const playerNumber = getLocalPlayerNumber();
        if (!playerNumber) return;

        const normalizedSkinId = normalizeRoomSkin(skinId);
        localStorage.setItem(getStorageKey(playerNumber), normalizedSkinId);
        applyRoomSkin(playerNumber, normalizedSkinId);
        emitRoomSkin(playerNumber, normalizedSkinId);
    }

    function restoreLocalRoomSkin({ emit = true } = {}) {
        const playerNumber = getLocalPlayerNumber();
        if (!playerNumber) {
            updateSelectAvailability();
            updateLocalAccent();
            return;
        }

        const savedSkin = normalizeRoomSkin(localStorage.getItem(getStorageKey(playerNumber)) || "none");
        applyRoomSkin(playerNumber, savedSkin, { silent: true });
        if (emit) {
            emitRoomSkin(playerNumber, savedSkin);
        }
        updateSelectAvailability();
    }

    function applyRoomSkinState(players = []) {
        lastRoomPlayers = Array.isArray(players) ? players : [];

        lastRoomPlayers.forEach(player => {
            const playerNumber = Number(player.playerNumber);
            if (![1, 2].includes(playerNumber)) return;
            applyRoomSkin(playerNumber, player.roomSkin || "none", { silent: true });
        });

        [1, 2].forEach(playerNumber => {
            if (!lastRoomPlayers.some(player => Number(player.playerNumber) === playerNumber)) {
                clearRoomSkin(playerNumber);
                playerRoomSkins[playerNumber] = "none";
            }
        });

        updateLocalAccent();
        updateSelectAvailability();
    }

    function updateAllCameraVideoStates() {
        [1, 2].forEach(updateCameraVideoState);
    }

    function syncRoomSkinVisuals() {
        if (lastRoomPlayers.length) {
            applyRoomSkinState(lastRoomPlayers);
        } else {
            updateLocalAccent();
            updateSelectAvailability();
        }

        updateAllCameraVideoStates();
    }

    function scheduleRoomSkinSync(delay = 80) {
        clearTimeout(roomSkinSyncTimer);
        roomSkinSyncTimer = setTimeout(syncRoomSkinVisuals, delay);
    }

    function scheduleRoomSkinSettleSyncs() {
        [0, 120, 300, 700, 1500, 2500, 5000].forEach(delay => {
            setTimeout(syncRoomSkinVisuals, delay);
        });
    }

    roomSkinSelect?.addEventListener("change", () => {
        setLocalRoomSkin(roomSkinSelect.value);
    });

    window.addEventListener("resenhaon-room-state", () => {
        setTimeout(() => {
            updateSelectAvailability();
            updateLocalAccent();
            syncRoomSkinVisuals();
        }, 50);
    });

    const activeSocket = getSocket();
    if (activeSocket?.on) {
        activeSocket.on("room-state", state => {
            applyRoomSkinState(Array.isArray(state?.players) ? state.players : []);
            scheduleRoomSkinSettleSyncs();
        });

        activeSocket.on("player-room-skin-update", payload => {
            if (!payload || payload.roomId !== roomId) return;
            applyRoomSkin(Number(payload.playerSlot), payload.skinId || "none");
            scheduleRoomSkinSettleSyncs();
        });
    }

    const observer = new MutationObserver(() => {
        setTimeout(() => {
            updateSelectAvailability();
            updateLocalAccent();
        }, 50);
    });

    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"]
    });

    const videoArea = document.querySelector(".video-area");
    if (videoArea) {
        const videoAreaObserver = new MutationObserver(() => {
            scheduleRoomSkinSync(60);
        });

        videoAreaObserver.observe(videoArea, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "style"]
        });
    }

    const floatingRoot = document.getElementById("floatingMarkersRoot");
    if (floatingRoot) {
        const floatingObserver = new MutationObserver(() => {
            [1, 2].forEach(refreshFloatingRoomSkin);
        });

        floatingObserver.observe(floatingRoot, {
            childList: true
        });
    }

    window.ResenhaONRoomSkins = {
        applyRoomSkin,
        setLocalRoomSkin,
        refreshFloatingRoomSkin,
        syncRoomSkinVisuals,
        skins: ROOM_SKINS
    };

    setTimeout(() => {
        restoreLocalRoomSkin();
        scheduleRoomSkinSettleSyncs();
    }, 500);
    setTimeout(() => {
        restoreLocalRoomSkin();
        scheduleRoomSkinSettleSyncs();
    }, 1500);
})();
