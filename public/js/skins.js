(() => {
    const BASE_STORAGE_KEY = "resenhaon:selectedTableSkin";
    const CHANNEL_NAME = "resenhaon:table-skins";

    const TABLE_SKINS = {
        none: { label: "Sem skin", frame: null, effects: [] },
        "mono-white": { label: "Mono White", frame: "/assets/skins/mono-white/frame.png", effects: [] },
        "mono-blue": { label: "Mono Blue", frame: "/assets/skins/mono-blue/frame.png", effects: [] },
        "mono-black": { label: "Mono Black", frame: "/assets/skins/mono-black/frame.png", effects: [] },
        "mono-red": { label: "Mono Red", frame: "/assets/skins/mono-red/frame.png", effects: [] },
        "mono-green": { label: "Mono Green", frame: "/assets/skins/mono-green/frame.png", effects: [] }
    };

    const skinSelect = document.getElementById("tableSkinSelect");
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get("room") || "default";
    const roleFromUrl = params.get("role");

    const channel = "BroadcastChannel" in window
        ? new BroadcastChannel(CHANNEL_NAME)
        : null;

    const playerSkins = {
        1: "none",
        2: "none"
    };

    function normalizeSkin(skinId) {
        return TABLE_SKINS[skinId] ? skinId : "none";
    }

    function getLocalPlayerNumber() {
        if (document.body.classList.contains("player-one-active")) return 1;
        if (document.body.classList.contains("player-two-active")) return 2;

        if (roleFromUrl === "player1" || roleFromUrl === "p1") return 1;
        if (roleFromUrl === "player2" || roleFromUrl === "p2") return 2;

        const playerFromUrl = params.get("player") || params.get("playerNumber");
        if (playerFromUrl === "1") return 1;
        if (playerFromUrl === "2") return 2;

        const activeLocalCard = document.querySelector(".camera-card.local-player");
        if (activeLocalCard?.classList.contains("camera-player-1")) return 1;
        if (activeLocalCard?.classList.contains("camera-player-2")) return 2;

        return 1;
    }

    function getRoomStorageKey(playerNumber) {
        return `${BASE_STORAGE_KEY}:${roomId}:player-${playerNumber}`;
    }

    function getCameraCardByPlayer(playerNumber) {
        return (
            document.querySelector(`.camera-player-${playerNumber}`) ||
            document.querySelector(`#player${playerNumber}Card`) ||
            document.querySelector(`[data-player="${playerNumber}"]`) ||
            null
        );
    }

    function removeSkinFromPlayer(playerNumber) {
        const card = getCameraCardByPlayer(playerNumber);
        if (!card) return;

        card.querySelectorAll(".table-skin-layer").forEach(layer => layer.remove());
        card.classList.remove("table-skin-active");
    }

    function appendFrame(layer, src) {
        const frame = document.createElement("img");

        frame.className = "table-skin-frame";
        frame.src = src;
        frame.alt = "";
        frame.draggable = false;

        frame.onerror = () => {
            console.error("[SKIN] erro ao carregar:", src);
            layer.remove();
        };

        layer.appendChild(frame);
    }

    function applySkinToPlayer(playerNumber, skinId, options = {}) {
        const normalizedSkinId = normalizeSkin(skinId);
        const skin = TABLE_SKINS[normalizedSkinId];

        playerSkins[playerNumber] = normalizedSkinId;

        removeSkinFromPlayer(playerNumber);

        if (!skin.frame) return;

        const card = getCameraCardByPlayer(playerNumber);

        if (!card) {
            console.warn("[SKIN] card não encontrado para player:", playerNumber);
            return;
        }

        const layer = document.createElement("div");
        layer.className = "table-skin-layer";
        layer.setAttribute("aria-hidden", "true");

        appendFrame(layer, skin.frame);

        card.classList.add("table-skin-active");
        card.appendChild(layer);

        if (!options.silent) {
            console.log("[SKIN] aplicada:", { playerNumber, skinId: normalizedSkinId });
        }
    }

    function broadcastSkin(playerNumber, skinId) {
        const payload = {
            roomId,
            playerNumber,
            skinId: normalizeSkin(skinId)
        };

        if (channel) {
            channel.postMessage({
                type: "table-skin-update",
                payload
            });
        }

        if (window.socket && typeof window.socket.emit === "function") {
            window.socket.emit("table-skin-change", payload);
        }
    }

    function updateLocalSelect() {
        if (!skinSelect) return;

        const localPlayerNumber = getLocalPlayerNumber();
        const savedSkin = localStorage.getItem(getRoomStorageKey(localPlayerNumber)) || "none";

        skinSelect.value = normalizeSkin(savedSkin);

        const isSpectator =
            document.body.classList.contains("spectator-mode") ||
            roleFromUrl === "spectator";

        const isCamera =
            document.body.classList.contains("camera-mode") ||
            roleFromUrl === "camera";

        skinSelect.disabled = isSpectator || isCamera;
    }

    function setLocalPlayerSkin(skinId) {
        const localPlayerNumber = getLocalPlayerNumber();
        const normalizedSkinId = normalizeSkin(skinId);

        localStorage.setItem(getRoomStorageKey(localPlayerNumber), normalizedSkinId);

        applySkinToPlayer(localPlayerNumber, normalizedSkinId);
        broadcastSkin(localPlayerNumber, normalizedSkinId);

        if (skinSelect) {
            skinSelect.value = normalizedSkinId;
        }
    }

    function restoreLocalSkins() {
        [1, 2].forEach(playerNumber => {
            const savedSkin = localStorage.getItem(getRoomStorageKey(playerNumber));

            if (savedSkin) {
                applySkinToPlayer(playerNumber, savedSkin, { silent: true });
            }
        });

        updateLocalSelect();
    }

    if (skinSelect) {
        updateLocalSelect();

        skinSelect.addEventListener("change", () => {
            setLocalPlayerSkin(skinSelect.value);
        });
    }

    if (channel) {
        channel.onmessage = event => {
            const { type, payload } = event.data || {};

            if (type !== "table-skin-update") return;
            if (!payload || payload.roomId !== roomId) return;

            applySkinToPlayer(payload.playerNumber, payload.skinId);
        };
    }

    if (window.socket && typeof window.socket.on === "function") {
        window.socket.on("table-skin-update", payload => {
            if (!payload || payload.roomId !== roomId) return;
            applySkinToPlayer(payload.playerNumber, payload.skinId);
        });

        window.socket.on("table-skin-state", state => {
            if (!state) return;

            if (state[1]) applySkinToPlayer(1, state[1]);
            if (state[2]) applySkinToPlayer(2, state[2]);
        });
    }

    const observer = new MutationObserver(() => {
        setTimeout(restoreLocalSkins, 250);
    });

    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"]
    });

    window.resenhaApplySkinToPlayer = applySkinToPlayer;
    window.resenhaSetLocalPlayerSkin = setLocalPlayerSkin;
    window.resenhaRefreshSkins = restoreLocalSkins;

    setTimeout(restoreLocalSkins, 500);
    setTimeout(restoreLocalSkins, 1500);
})();