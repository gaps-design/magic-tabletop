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
            effects: []
        },

        "mono-blue": {
            label: "Mono Blue",
            frame: "/assets/skins/mono-blue/frame.png",
            effects: []
        },

        "mono-black": {
            label: "Mono Black",
            frame: "/assets/skins/mono-black/frame.png",
            effects: []
        },

        "mono-red": {
            label: "Mono Red",
            frame: "/assets/skins/mono-red/frame.png",
            effects: []
        },

        "mono-green": {
            label: "Mono Green",
            frame: "/assets/skins/mono-green/frame.png",
            effects: []
        }
    };

    const skinSelect = document.getElementById("tableSkinSelect");

    function normalizeSkin(skinId) {
        return TABLE_SKINS[skinId] ? skinId : "none";
    }

    function getLocalCameraCard() {
        const selectors = [
            ".camera-card.local-player",
            ".camera-card.local",
            ".camera-card.player-local",
            ".camera-player-1",
            ".camera-player-2",
            "#player1Card",
            "#player2Card",
            "[data-player='1']",
            "[data-player='2']"
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);

            if (element && element.offsetParent !== null) {
                console.log("[SKIN] câmera encontrada:", selector);
                return element;
            }
        }

        const cards = [...document.querySelectorAll(".camera-card")]
            .filter(card => card.offsetParent !== null);

        if (cards.length > 0) {
            console.log("[SKIN] usando primeiro camera-card visível");
            return cards[0];
        }

        console.warn("[SKIN] nenhuma câmera encontrada");
        return null;
    }

    function removeCurrentLayer() {
        document
            .querySelectorAll(".table-skin-layer")
            .forEach(layer => layer.remove());

        document
            .querySelectorAll(".table-skin-active")
            .forEach(card => card.classList.remove("table-skin-active"));
    }

    function appendFrame(layer, src) {
        const frame = document.createElement("img");

        frame.className = "table-skin-frame";
        frame.src = src;
        frame.alt = "";
        frame.draggable = false;

        frame.onload = () => {
            console.log("[SKIN] frame carregado:", src);
        };

        frame.onerror = () => {
            console.error("[SKIN] erro ao carregar:", src);
            layer.remove();
        };

        layer.appendChild(frame);
    }

    function updateControlState() {
        if (!skinSelect) return;

        const isPlayer =
            document.body.classList.contains("player-one-active") ||
            document.body.classList.contains("player-two-active");

        skinSelect.disabled = !isPlayer;
    }

    function applySelectedSkin(skinId) {
        const normalizedSkinId = normalizeSkin(skinId);
        const skin = TABLE_SKINS[normalizedSkinId];

        localStorage.setItem(STORAGE_KEY, normalizedSkinId);

        if (skinSelect) {
            skinSelect.value = normalizedSkinId;
        }

        removeCurrentLayer();

        updateControlState();

        if (!skin.frame) {
            console.log("[SKIN] removida");
            return;
        }

        const card = getLocalCameraCard();

        if (!card) {
            console.warn("[SKIN] câmera não encontrada");
            return;
        }

        const layer = document.createElement("div");
        layer.className = "table-skin-layer";
        layer.setAttribute("aria-hidden", "true");

        appendFrame(layer, skin.frame);

        card.classList.add("table-skin-active");
        card.appendChild(layer);

        console.log("[SKIN] aplicada:", normalizedSkinId);
    }

    function refreshSkin() {
        applySelectedSkin(
            localStorage.getItem(STORAGE_KEY) || "none"
        );
    }

    if (skinSelect) {
        skinSelect.value = normalizeSkin(
            localStorage.getItem(STORAGE_KEY) || "none"
        );

        skinSelect.addEventListener("change", () => {
            applySelectedSkin(skinSelect.value);
        });
    }

    const observer = new MutationObserver(() => {
        setTimeout(refreshSkin, 250);
    });

    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"]
    });

    window.resenhaApplySkin = applySelectedSkin;
    window.resenhaRefreshSkin = refreshSkin;

    setTimeout(refreshSkin, 500);
    setTimeout(refreshSkin, 1500);

})();