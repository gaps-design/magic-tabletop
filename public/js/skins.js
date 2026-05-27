(() => {
    const STORAGE_KEY = "resenhaon:selectedTableSkin";

    const TABLE_SKINS = {
        none: {
            label: "Sem skin",
            frame: null,
            effects: []
        },
        "mono-white": {
            label: "Mono White",
            frame: "/assets/skins/mono-white/frame.png",
            effects: [
                "/assets/skins/mono-white/birds.webm",
                "/assets/skins/mono-white/sand.webm",
                "/assets/skins/mono-white/horses.webm"
            ]
        },
        "mono-blue": {
            label: "Mono Blue",
            frame: "/assets/skins/mono-blue/frame.png",
            effects: [
                "/assets/skins/mono-blue/waves.webm",
                "/assets/skins/mono-blue/clouds.webm",
                "/assets/skins/mono-blue/whales.webm"
            ]
        },
        "mono-black": {
            label: "Mono Black",
            frame: "/assets/skins/mono-black/frame.png",
            effects: [
                "/assets/skins/mono-black/fog.webm",
                "/assets/skins/mono-black/souls.webm"
            ]
        },
        "mono-red": {
            label: "Mono Red",
            frame: "/assets/skins/mono-red/frame.png",
            effects: [
                "/assets/skins/mono-red/fire.webm",
                "/assets/skins/mono-red/smoke.webm",
                "/assets/skins/mono-red/lightning.webm"
            ]
        },
        "mono-green": {
            label: "Mono Green",
            frame: "/assets/skins/mono-green/frame.png",
            effects: [
                "/assets/skins/mono-green/leaves.webm",
                "/assets/skins/mono-green/birds.webm",
                "/assets/skins/mono-green/wind.webm"
            ]
        }
    };

    const skinSelect = document.getElementById("tableSkinSelect");

    function normalizeSkin(skinId) {
        return TABLE_SKINS[skinId] ? skinId : "none";
    }

    function getLocalCameraCard() {
        if (document.body.classList.contains("player-one-active")) {
            return document.querySelector(".camera-player-1");
        }

        if (document.body.classList.contains("player-two-active")) {
            return document.querySelector(".camera-player-2");
        }

        if (
            document.body.classList.contains("spectator-mode") ||
            document.body.classList.contains("camera-mode")
        ) {
            return null;
        }

        return document.querySelector(".camera-player-1");
    }

    function removeCurrentLayer() {
        document
            .querySelectorAll(".table-skin-layer")
            .forEach(layer => layer.remove());

        document
            .querySelectorAll(".camera-card.table-skin-active")
            .forEach(card => card.classList.remove("table-skin-active"));
    }

    async function assetExists(src) {
        try {
            const response = await fetch(src, {
                method: "HEAD",
                cache: "force-cache"
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    function appendFrame(layer, src) {
        const frame = document.createElement("img");
        frame.className = "table-skin-frame";
        frame.alt = "";
        frame.decoding = "async";
        frame.draggable = false;
        frame.src = src;
        frame.addEventListener("error", () => {
            layer.remove();
        }, { once: true });
        layer.appendChild(frame);
    }

    async function appendOptionalEffects(layer, effects = []) {
        for (const src of effects) {
            if (!await assetExists(src)) continue;

            const effect = document.createElement("video");
            effect.className = "table-skin-effect";
            effect.autoplay = true;
            effect.muted = true;
            effect.loop = true;
            effect.playsInline = true;
            effect.src = src;
            effect.addEventListener("error", () => {
                effect.remove();
            }, { once: true });
            layer.appendChild(effect);
        }
    }

    function updateControlState() {
        if (!skinSelect) return;

        const isPlayer = document.body.classList.contains("player-one-active") ||
            document.body.classList.contains("player-two-active");
        const isNonPlayerMode = document.body.classList.contains("spectator-mode") ||
            document.body.classList.contains("camera-mode");
        skinSelect.disabled = !isPlayer && isNonPlayerMode;
    }

    async function applySelectedSkin(skinId) {
        const normalizedSkinId = normalizeSkin(skinId);
        const skin = TABLE_SKINS[normalizedSkinId];

        localStorage.setItem(STORAGE_KEY, normalizedSkinId);
        if (skinSelect) skinSelect.value = normalizedSkinId;

        removeCurrentLayer();
        updateControlState();

        if (!skin.frame) return;

        const card = getLocalCameraCard();
        if (!card) return;

        const layer = document.createElement("div");
        layer.className = "table-skin-layer";
        layer.setAttribute("aria-hidden", "true");

        appendFrame(layer, skin.frame);
        card.classList.add("table-skin-active");
        card.appendChild(layer);
        appendOptionalEffects(layer, skin.effects);
    }

    function refreshSkin() {
        applySelectedSkin(localStorage.getItem(STORAGE_KEY) || "none");
    }

    if (skinSelect) {
        skinSelect.value = normalizeSkin(localStorage.getItem(STORAGE_KEY) || "none");
        skinSelect.addEventListener("change", () => {
            applySelectedSkin(skinSelect.value);
        });
    }

    const bodyObserver = new MutationObserver(() => {
        refreshSkin();
    });

    bodyObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"]
    });

    updateControlState();
    refreshSkin();
})();
