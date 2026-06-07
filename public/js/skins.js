(() => {
    const BASE_STORAGE_KEY = "resenhaon:selectedTableSkin";
    const CUSTOM_TEXT_STORAGE_KEY = "resenhaon:customTableSkinText";
    const CHANNEL_NAME = "resenhaon:table-skins";
    const CUSTOM_SKIN_ID = "custom";
    const CUSTOM_TEXT_MAX_LENGTH = 80;
    const PROFANITY_WORDS = ["porra", "caralho", "puta", "fdp", "viado", "merda"];

    const TABLE_SKINS = {
        none: { label: "Sem skin", frame: null, effects: [] },
        "mono-white": { label: "Mono White", frame: "/assets/skins/mono-white/frame.png", effects: [] },
        "mono-blue": { label: "Mono Blue", frame: "/assets/skins/mono-blue/frame.png", effects: [] },
        "mono-black": { label: "Mono Black", frame: "/assets/skins/mono-black/frame.png", effects: [] },
        "mono-red": { label: "Mono Red", frame: "/assets/skins/mono-red/frame.png", effects: [] },
        "mono-green": { label: "Mono Green", frame: "/assets/skins/mono-green/frame.png", effects: [] },
        custom: { label: "Custom", frame: "/assets/skins/custom/frame.png", effects: [], customText: true }
    };

    const skinSelect = document.getElementById("tableSkinSelect");
    const customTextControl = document.getElementById("customSkinTextControl");
    const customTextInput = document.getElementById("customSkinTextInput");
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
    const playerCustomTexts = {
        1: "",
        2: ""
    };
    let hasServerSkinState = false;

    function normalizeSkin(skinId) {
        return TABLE_SKINS[skinId] ? skinId : "none";
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function sanitizeCustomText(value = "") {
        let text = String(value || "")
            .replace(/[\u0000-\u001F\u007F]/g, "")
            .replace(/[<>]/g, "")
            .replace(/\s+/g, " ")
            .slice(0, CUSTOM_TEXT_MAX_LENGTH);

        PROFANITY_WORDS.forEach(word => {
            const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi");
            text = text.replace(pattern, "****");
        });

        return text;
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

    function getCustomTextStorageKey(playerNumber) {
        return `${CUSTOM_TEXT_STORAGE_KEY}:${roomId}:player-${playerNumber}`;
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
        card.removeAttribute("data-table-skin");
    }

    function appendFrame(layer, src, skinId) {
        const frame = document.createElement("img");

        frame.className = "table-skin-frame";
        frame.src = src;
        frame.alt = "";
        frame.draggable = false;
        frame.dataset.skinId = skinId;

        frame.onerror = () => {
            console.error("[SKIN] erro ao carregar:", src);
            layer.remove();
        };

        layer.appendChild(frame);
    }

    function appendCustomText(layer, playerNumber) {
        const text = sanitizeCustomText(playerCustomTexts[playerNumber] || "");
        const textEl = document.createElement("div");

        textEl.className = "table-skin-custom-text";
        textEl.textContent = text;
        textEl.hidden = !text;

        layer.appendChild(textEl);
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
        layer.className = `table-skin-layer table-skin-${normalizedSkinId}`;
        layer.setAttribute("aria-hidden", "true");
        layer.dataset.skinId = normalizedSkinId;

        appendFrame(layer, skin.frame, normalizedSkinId);
        if (skin.customText) {
            appendCustomText(layer, playerNumber);
        }

        card.classList.add("table-skin-active");
        card.dataset.tableSkin = normalizedSkinId;
        card.appendChild(layer);

        if (!options.silent) {
            console.log("[SKIN] aplicada:", { playerNumber, skinId: normalizedSkinId });
        }
    }

    function applyCustomTextToPlayer(playerNumber, text, options = {}) {
        const sanitizedText = sanitizeCustomText(text);
        playerCustomTexts[playerNumber] = sanitizedText;

        const card = getCameraCardByPlayer(playerNumber);
        const textEl = card?.querySelector(".table-skin-custom-text");
        if (textEl) {
            textEl.textContent = sanitizedText;
            textEl.hidden = !sanitizedText;
        }

        if (!options.silent) {
            console.log("[SKIN] texto custom atualizado:", { playerNumber, text: sanitizedText });
        }
    }

    function broadcastSkin(playerNumber, skinId, text = playerCustomTexts[playerNumber] || "") {
        const payload = {
            roomId,
            playerNumber,
            skinId: normalizeSkin(skinId),
            customText: sanitizeCustomText(text)
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

    function broadcastCustomText(playerNumber, text) {
        const payload = {
            roomId,
            playerNumber,
            customText: sanitizeCustomText(text)
        };

        if (channel) {
            channel.postMessage({
                type: "table-skin-text-update",
                payload
            });
        }

        if (window.socket && typeof window.socket.emit === "function") {
            window.socket.emit("table-skin-text-change", payload);
        }
    }

    function updateCustomTextControl() {
        if (!customTextControl || !customTextInput) return;

        const localPlayerNumber = getLocalPlayerNumber();
        const localSkin = normalizeSkin(playerSkins[localPlayerNumber] || skinSelect?.value || "none");
        const isCustom = localSkin === CUSTOM_SKIN_ID;

        customTextControl.classList.toggle("hidden", !isCustom);
        customTextInput.disabled = !isCustom || skinSelect?.disabled;

        if (isCustom) {
            customTextInput.value = playerCustomTexts[localPlayerNumber] || "";
        }
    }

    function updateLocalSelect() {
        if (!skinSelect) return;

        const localPlayerNumber = getLocalPlayerNumber();
        const savedSkin = hasServerSkinState
            ? playerSkins[localPlayerNumber] || "none"
            : localStorage.getItem(getRoomStorageKey(localPlayerNumber)) || "none";
        const savedCustomText = hasServerSkinState
            ? playerCustomTexts[localPlayerNumber] || ""
            : localStorage.getItem(getCustomTextStorageKey(localPlayerNumber)) || "";
        playerCustomTexts[localPlayerNumber] = sanitizeCustomText(savedCustomText);

        skinSelect.value = normalizeSkin(savedSkin);

        const isSpectator =
            document.body.classList.contains("spectator-mode") ||
            roleFromUrl === "spectator";

        const isCamera =
            document.body.classList.contains("camera-mode") ||
            roleFromUrl === "camera";

        skinSelect.disabled = isSpectator || isCamera;
        updateCustomTextControl();
    }

    function setLocalPlayerSkin(skinId) {
        const localPlayerNumber = getLocalPlayerNumber();
        const normalizedSkinId = normalizeSkin(skinId);
        const customText = playerCustomTexts[localPlayerNumber] || "";

        localStorage.setItem(getRoomStorageKey(localPlayerNumber), normalizedSkinId);

        applySkinToPlayer(localPlayerNumber, normalizedSkinId);
        broadcastSkin(localPlayerNumber, normalizedSkinId, customText);

        if (skinSelect) {
            skinSelect.value = normalizedSkinId;
        }

        updateCustomTextControl();
    }

    function restoreLocalSkins() {
        if (hasServerSkinState) {
            updateLocalSelect();
            return;
        }

        const localPlayerNumber = getLocalPlayerNumber();
        const savedSkin = localStorage.getItem(getRoomStorageKey(localPlayerNumber));
        const savedCustomText = localStorage.getItem(getCustomTextStorageKey(localPlayerNumber));

        if (savedCustomText !== null) {
            applyCustomTextToPlayer(localPlayerNumber, savedCustomText, { silent: true });
        }

        if (savedSkin) {
            applySkinToPlayer(localPlayerNumber, savedSkin, { silent: true });
        }

        updateLocalSelect();
    }

    function applyTableSkinState(state) {
        if (!state) return;
        hasServerSkinState = true;

        [1, 2].forEach(playerNumber => {
            const playerState = state[playerNumber] || state[String(playerNumber)];
            if (!playerState) return;

            if (typeof playerState === "string") {
                applySkinToPlayer(playerNumber, playerState);
                return;
            }

            applyCustomTextToPlayer(playerNumber, playerState.customText || "", { silent: true });
            applySkinToPlayer(playerNumber, playerState.skinId || "none");
        });

        updateCustomTextControl();
    }

    if (skinSelect) {
        updateLocalSelect();

        skinSelect.addEventListener("change", () => {
            setLocalPlayerSkin(skinSelect.value);
        });
    }

    if (customTextInput) {
        customTextInput.maxLength = CUSTOM_TEXT_MAX_LENGTH;
        customTextInput.addEventListener("input", () => {
            const localPlayerNumber = getLocalPlayerNumber();
            const sanitizedText = sanitizeCustomText(customTextInput.value);

            if (customTextInput.value !== sanitizedText) {
                const selection = customTextInput.selectionStart;
                customTextInput.value = sanitizedText;
                const nextSelection = Math.min(selection, sanitizedText.length);
                customTextInput.setSelectionRange(nextSelection, nextSelection);
            }

            localStorage.setItem(getCustomTextStorageKey(localPlayerNumber), sanitizedText);
            applyCustomTextToPlayer(localPlayerNumber, sanitizedText);
            broadcastCustomText(localPlayerNumber, sanitizedText);
        });
    }

    if (channel) {
        channel.onmessage = event => {
            const { type, payload } = event.data || {};

            if (!payload || payload.roomId !== roomId) return;

            if (type === "table-skin-update") {
                applyCustomTextToPlayer(payload.playerNumber, payload.customText || "", { silent: true });
                applySkinToPlayer(payload.playerNumber, payload.skinId);
            }

            if (type === "table-skin-text-update") {
                applyCustomTextToPlayer(payload.playerNumber, payload.customText || "");
                if (playerSkins[payload.playerNumber] === CUSTOM_SKIN_ID) {
                    applySkinToPlayer(payload.playerNumber, CUSTOM_SKIN_ID, { silent: true });
                }
            }
        };
    }

    if (window.socket && typeof window.socket.on === "function") {
        window.socket.on("table-skin-update", payload => {
            if (!payload || payload.roomId !== roomId) return;
            applyCustomTextToPlayer(payload.playerNumber, payload.customText || "", { silent: true });
            applySkinToPlayer(payload.playerNumber, payload.skinId);
            updateCustomTextControl();
        });

        window.socket.on("table-skin-text-update", payload => {
            if (!payload || payload.roomId !== roomId) return;
            applyCustomTextToPlayer(payload.playerNumber, payload.customText || "");
            if (playerSkins[payload.playerNumber] === CUSTOM_SKIN_ID) {
                applySkinToPlayer(payload.playerNumber, CUSTOM_SKIN_ID, { silent: true });
            }
            updateCustomTextControl();
        });

        window.socket.on("table-skin-state", state => {
            applyTableSkinState(state);
        });

        window.socket.on("room-state", state => {
            if (state?.tableSkins) {
                applyTableSkinState(state.tableSkins);
            }
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
    window.resenhaSetCustomSkinText = applyCustomTextToPlayer;
    window.resenhaRefreshSkins = restoreLocalSkins;

    setTimeout(restoreLocalSkins, 500);
    setTimeout(restoreLocalSkins, 1500);
})();
