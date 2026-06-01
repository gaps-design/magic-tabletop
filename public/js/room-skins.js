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
    const observedVideoTracks = new WeakSet();
    const lastVideoStateLog = new WeakMap();
    const frameProbeCanvas = document.createElement("canvas");
    const frameProbeContext = frameProbeCanvas.getContext("2d", { willReadFrequently: true });

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

    function ensureSkinFallbackLayer(cameraCard) {
        if (!cameraCard) return null;

        let layer = cameraCard.querySelector(":scope > .skin-fallback-layer");
        if (!layer) {
            layer = document.createElement("div");
            layer.className = "skin-fallback-layer";
            layer.setAttribute("aria-hidden", "true");

            const video = cameraCard.querySelector("video");
            if (video) {
                video.before(layer);
            } else {
                cameraCard.appendChild(layer);
            }
        }

        return layer;
    }

    function getVideoTracksInfo(video) {
        const stream = video?.srcObject;
        return stream instanceof MediaStream ? stream.getVideoTracks() : [];
    }

    function inspectVideoFrame(video) {
        if (!frameProbeContext || !video?.videoWidth || !video?.videoHeight) {
            return { usable: false, reason: "no-frame-dimensions" };
        }

        const width = 32;
        const height = Math.max(12, Math.round(width * (video.videoHeight / video.videoWidth)));
        frameProbeCanvas.width = width;
        frameProbeCanvas.height = height;

        try {
            frameProbeContext.drawImage(video, 0, 0, width, height);
            const { data } = frameProbeContext.getImageData(0, 0, width, height);
            let litPixels = 0;
            let maxChannel = 0;
            let lumaSum = 0;
            let lumaSqSum = 0;
            const pixels = data.length / 4;

            for (let index = 0; index < data.length; index += 4) {
                const red = data[index];
                const green = data[index + 1];
                const blue = data[index + 2];
                const luma = (red * 0.2126) + (green * 0.7152) + (blue * 0.0722);
                const pixelMax = Math.max(red, green, blue);

                maxChannel = Math.max(maxChannel, pixelMax);
                if (pixelMax > 24) litPixels += 1;
                lumaSum += luma;
                lumaSqSum += luma * luma;
            }

            const meanLuma = lumaSum / pixels;
            const lumaVariance = Math.max(0, (lumaSqSum / pixels) - (meanLuma * meanLuma));
            const litRatio = litPixels / pixels;
            const usable = maxChannel > 32 || litRatio > 0.015 || lumaVariance > 10;

            return {
                usable,
                reason: usable ? "frame-has-content" : "black-frame",
                maxChannel: Math.round(maxChannel),
                meanLuma: Math.round(meanLuma * 10) / 10,
                lumaVariance: Math.round(lumaVariance * 10) / 10,
                litRatio: Math.round(litRatio * 1000) / 1000
            };
        } catch (error) {
            return {
                usable: true,
                reason: "frame-probe-failed",
                errorName: error?.name || "UnknownError",
                errorMessage: error?.message || ""
            };
        }
    }

    function getVideoUsability(video) {
        const stream = video?.srcObject;
        if (!(stream instanceof MediaStream)) {
            return { usable: false, reason: "no-srcObject", streamId: null, tracks: [] };
        }

        const tracks = getVideoTracksInfo(video);
        const liveEnabledTrack = tracks.some(track =>
            track.readyState === "live" &&
            track.enabled === true &&
            track.muted !== true
        );

        if (!liveEnabledTrack) {
            return {
                usable: false,
                reason: "no-live-enabled-track",
                streamId: stream.id,
                tracks
            };
        }

        if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            return {
                usable: false,
                reason: "no-current-frame",
                streamId: stream.id,
                tracks
            };
        }

        const frame = inspectVideoFrame(video);

        return {
            usable: frame.usable,
            reason: frame.reason,
            streamId: stream.id,
            tracks,
            frame
        };
    }

    function hasUsableVideo(video) {
        return getVideoUsability(video).usable;
    }

    function getVideoDiagnostics(video, usability) {
        return {
            videoId: video?.id || "",
            videoWidth: video?.videoWidth || 0,
            videoHeight: video?.videoHeight || 0,
            readyState: video?.readyState ?? null,
            paused: !!video?.paused,
            srcObject: !!video?.srcObject,
            streamId: usability.streamId || null,
            tracks: (usability.tracks || []).map(track => ({
                id: track.id,
                enabled: track.enabled,
                muted: track.muted,
                readyState: track.readyState
            })),
            hasUsableVideo: !!usability.usable,
            reason: usability.reason,
            frame: usability.frame || null
        };
    }

    function logVideoStateChange(video, diagnostics) {
        const stateKey = JSON.stringify({
            videoId: diagnostics.videoId,
            hasUsableVideo: diagnostics.hasUsableVideo,
            reason: diagnostics.reason,
            videoWidth: diagnostics.videoWidth,
            videoHeight: diagnostics.videoHeight,
            readyState: diagnostics.readyState,
            srcObject: diagnostics.srcObject,
            tracks: diagnostics.tracks.map(track => ({
                enabled: track.enabled,
                muted: track.muted,
                readyState: track.readyState
            })),
            frame: diagnostics.frame
        });

        if (lastVideoStateLog.get(video) === stateKey) return;
        lastVideoStateLog.set(video, stateKey);
        console.log("[ROOM-SKIN][VIDEO-STATE]", diagnostics);
    }

    function hasVisibleVideoStream(video) {
        return hasUsableVideo(video);
    }

    function updateCameraVideoState(playerNumber) {
        const { camera } = getPlayerElements(playerNumber);
        const video = camera?.querySelector("video");
        if (!camera || !video) return;

        const usability = getVideoUsability(video);
        const hasVideo = usability.usable;
        logVideoStateChange(video, getVideoDiagnostics(video, usability));
        camera.classList.toggle("room-skin-video-empty", !hasVideo);
        camera.classList.toggle("no-usable-video", !hasVideo);
        video.dataset.roomSkinVideoState = hasVideo ? "active" : "empty";

        if (hasVideo) {
            video.style.removeProperty("opacity");
            video.style.removeProperty("visibility");
            video.style.removeProperty("background");
            video.style.removeProperty("background-color");
        } else {
            video.style.setProperty("opacity", "0", "important");
            video.style.setProperty("visibility", "hidden", "important");
            video.style.setProperty("background", "transparent", "important");
            video.style.setProperty("background-color", "transparent", "important");
            camera.style.setProperty("background-color", "transparent", "important");
        }

        if (video.srcObject instanceof MediaStream) {
            video.srcObject.getVideoTracks().forEach(track => {
                if (observedVideoTracks.has(track)) return;
                observedVideoTracks.add(track);
                ["mute", "unmute", "ended"].forEach(eventName => {
                    track.addEventListener(eventName, () => scheduleRoomSkinSync(20));
                });
            });
        }
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

        element.classList.add("room-skin-active", "has-room-skin", `room-skin-${skinId}`);
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
            element.classList.remove("has-room-skin", "no-usable-video");
            element.removeAttribute("data-room-skin");
            element.style.removeProperty("--room-skin-bg");
            element.style.removeProperty("--room-skin-accent");
        });

        camera?.querySelector(":scope > .room-skin-background")?.remove();
        camera?.querySelector(":scope > .skin-fallback-layer")?.remove();
    }

    function refreshFloatingRoomSkin(playerNumber) {
        const skinId = normalizeRoomSkin(playerRoomSkins[playerNumber] || "none");
        const skin = ROOM_SKINS[skinId];
        const { floatingColumn } = getPlayerElements(playerNumber);

        if (!floatingColumn) return;

        if (skinId === "none" || floatingColumn.childElementCount === 0) {
            removeRoomSkinClasses(floatingColumn);
            floatingColumn.classList.remove("has-room-skin", "no-usable-video");
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
        ensureSkinFallbackLayer(camera);
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
        [0, 120, 300, 700, 1500, 2500, 5000, 7500, 10000].forEach(delay => {
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
        hasUsableVideo,
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
    setInterval(syncRoomSkinVisuals, 2500);
})();
