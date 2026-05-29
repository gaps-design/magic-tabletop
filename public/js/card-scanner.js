(() => {
    const SCRYFALL_NAMED_URL = "https://api.scryfall.com/cards/named?fuzzy=";
    const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    const ORACLE_LIMIT = 360;

    const button = document.getElementById("cardScannerBtn");
    const modal = document.getElementById("cardScannerModal");
    const closeBtn = document.getElementById("cardScannerCloseBtn");
    const captureBtn = document.getElementById("cardScannerCaptureBtn");
    const manualInput = document.getElementById("cardScannerManualInput");
    const manualBtn = document.getElementById("cardScannerManualBtn");
    const retryBtn = document.getElementById("cardScannerRetryBtn");
    const statusEl = document.getElementById("cardScannerStatus");
    const canvas = document.getElementById("cardScannerCanvas");
    const resultEl = document.getElementById("cardScannerResult");
    const publicLayer = document.getElementById("cardScanPublicLayer");
    const ctx = canvas?.getContext?.("2d");

    let currentCard = null;
    let isBusy = false;
    let tesseractLoader = null;
    let previewLoopId = null;

    function getRoomState() {
        return window.ResenhaONRoom?.getState?.() || {};
    }

    function getSocket() {
        if (typeof socket !== "undefined") return socket;
        return window.socket || null;
    }

    function isPlayer() {
        const state = getRoomState();
        return state.selectedRole === "player" && [1, 2].includes(Number(state.myPlayerNumber));
    }

    function updateButtonVisibility() {
        if (!button) return;
        button.classList.toggle("hidden", !isPlayer());
    }

    function setStatus(message, tone = "") {
        if (!statusEl) return;
        statusEl.innerText = message;
        statusEl.dataset.tone = tone;
    }

    function setBusy(nextBusy) {
        isBusy = nextBusy;
        [captureBtn, manualBtn, retryBtn].forEach(item => {
            if (item) item.disabled = nextBusy;
        });
    }

    function getScannerVideo() {
        const localVideo = document.getElementById("localVideo");

        if (
            localVideo &&
            localVideo.srcObject &&
            localVideo.readyState >= 2 &&
            localVideo.videoWidth > 0 &&
            localVideo.videoHeight > 0
        ) {
            return localVideo;
        }

        return Array.from(document.querySelectorAll("video"))
            .find(video =>
                video.srcObject &&
                video.readyState >= 2 &&
                video.videoWidth > 0 &&
                video.videoHeight > 0
            ) || null;
    }

    function drawVideoFrame() {
        const video = getScannerVideo();
        if (!canvas || !ctx) return false;

        const width = video?.videoWidth || 640;
        const height = video?.videoHeight || 420;

        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;

        ctx.fillStyle = "#06101d";
        ctx.fillRect(0, 0, width, height);

        if (!video) {
            ctx.fillStyle = "#9cc7e7";
            ctx.font = "24px Arial";
            ctx.textAlign = "center";
            ctx.fillText("Prévia da câmera indisponível", width / 2, height / 2);
            return false;
        }

        try {
            ctx.drawImage(video, 0, 0, width, height);
            drawScannerGuide(width, height);
            return true;
        } catch (error) {
            console.warn("Falha ao desenhar frame da câmera:", error);
            return false;
        }
    }

    function drawScannerGuide(width, height) {
        const crop = getNameCropArea(width, height);

        ctx.save();
        ctx.strokeStyle = "rgba(103, 232, 249, 0.95)";
        ctx.lineWidth = Math.max(3, Math.round(width * 0.006));
        ctx.setLineDash([12, 8]);
        ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);

        ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
        ctx.font = `${Math.max(14, Math.round(width * 0.03))}px Arial`;
        ctx.textAlign = "center";
        ctx.fillText("Nome da carta aqui", crop.x + crop.w / 2, crop.y - 10);
        ctx.restore();
    }

    function getNameCropArea(width, height) {
        return {
            x: width * 0.18,
            y: height * 0.18,
            w: width * 0.64,
            h: height * 0.22
        };
    }

    function prepareNameAreaForOcr() {
        const source = canvas;
        const ocrCanvas = document.createElement("canvas");
        const ocrCtx = ocrCanvas.getContext("2d");

        const crop = getNameCropArea(source.width, source.height);

        ocrCanvas.width = 1200;
        ocrCanvas.height = 300;

        ocrCtx.fillStyle = "#ffffff";
        ocrCtx.fillRect(0, 0, ocrCanvas.width, ocrCanvas.height);

        ocrCtx.drawImage(
            source,
            crop.x,
            crop.y,
            crop.w,
            crop.h,
            0,
            0,
            ocrCanvas.width,
            ocrCanvas.height
        );

        const imageData = ocrCtx.getImageData(0, 0, ocrCanvas.width, ocrCanvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const gray = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
            const contrast = gray > 145 ? 255 : 0;

            data[i] = contrast;
            data[i + 1] = contrast;
            data[i + 2] = contrast;
        }

        ocrCtx.putImageData(imageData, 0, 0);

        return ocrCanvas;
    }

    function startPreviewLoop() {
        stopPreviewLoop();

        const loop = () => {
            if (!modal || modal.classList.contains("hidden")) {
                stopPreviewLoop();
                return;
            }

            drawVideoFrame();
            previewLoopId = requestAnimationFrame(loop);
        };

        loop();
    }

    function stopPreviewLoop() {
        if (previewLoopId) {
            cancelAnimationFrame(previewLoopId);
            previewLoopId = null;
        }
    }

    function openModal() {
        if (!isPlayer()) return;
        modal?.classList.remove("hidden");
        currentCard = null;
        renderResult(null);
        setStatus("Aponte a câmera para a carta ou digite o nome manualmente.");
        startPreviewLoop();
        manualInput?.focus();
    }

    function closeModal() {
        stopPreviewLoop();
        modal?.classList.add("hidden");
    }

    function loadTesseract() {
        if (window.Tesseract) return Promise.resolve(window.Tesseract);
        if (tesseractLoader) return tesseractLoader;

        tesseractLoader = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = TESSERACT_CDN;
            script.async = true;
            script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error("Tesseract não carregou."));
            script.onerror = () => reject(new Error("Falha ao carregar OCR."));
            document.head.appendChild(script);
        });

        return tesseractLoader;
    }

    function cleanOcrText(text) {
        const ignore = /^(creature|instant|sorcery|artifact|enchantment|planeswalker|land|battle|legendary|basic|token|mana|tap|flying|trample|haste|when|whenever|at|draw|target)\b/i;
        const lines = String(text || "")
            .split(/\r?\n/)
            .map(line => line.replace(/[^A-Za-z0-9,'’\-: ]/g, " ").replace(/\s+/g, " ").trim())
            .filter(line => line.length >= 3 && line.length <= 42)
            .filter(line => !ignore.test(line));

        lines.sort((a, b) => scoreNameLine(b) - scoreNameLine(a));

        return lines[0] || "";
    }

    function scoreNameLine(line) {
        const words = line.split(/\s+/);
        let score = 0;

        if (words.length <= 5) score += 3;
        if (/^[A-Z0-9]/.test(line)) score += 2;
        score += words.filter(word => /^[A-Z0-9]/.test(word)).length;
        score -= (line.match(/\d/g) || []).length;

        return score;
    }

    async function captureAndScan() {
        if (isBusy) return;
        setBusy(true);
        renderResult(null);
        setStatus("Escaneando carta...");

        try {
            const hasFrame = drawVideoFrame();

            if (!hasFrame) {
                setStatus("Não consegui acessar a câmera principal. Digite o nome da carta manualmente.", "warn");
                return;
            }

            const ocrCanvas = prepareNameAreaForOcr();
            const Tesseract = await loadTesseract();

            const { data } = await Tesseract.recognize(ocrCanvas, "eng", {
                tessedit_pageseg_mode: "7",
                tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789,'’- "
            });

            const probableName = cleanOcrText(data?.text);

            if (!probableName) {
                setStatus("Não consegui identificar a carta. Aproxime o topo da carta da área marcada, evite reflexo e tente novamente.", "warn");
                return;
            }

            if (manualInput) manualInput.value = probableName;
            await searchCard(probableName);
        } catch (error) {
            console.warn("Falha no scanner de carta:", error);
            setStatus("Não consegui identificar a carta. Aproxime a carta da câmera, evite reflexo e tente novamente.", "warn");
        } finally {
            setBusy(false);
        }
    }

    async function searchCard(rawName) {
        const query = String(rawName || "").trim();

        if (!query) {
            setStatus("Digite o nome da carta para buscar.", "warn");
            return;
        }

        setBusy(true);
        setStatus("Buscando carta no Scryfall...");

        try {
            const response = await fetch(`${SCRYFALL_NAMED_URL}${encodeURIComponent(query)}`);

            if (!response.ok) {
                setStatus("Carta não encontrada. Tente aproximar mais o nome da carta da câmera.", "warn");
                renderResult(null);
                return;
            }

            const data = await response.json();
            currentCard = normalizeScryfallCard(data);
            renderResult(currentCard);
            setStatus("Carta encontrada. Confira os dados antes de mostrar para a mesa.", "ok");
        } catch (error) {
            console.warn("Falha ao buscar carta:", error);
            setStatus("Não foi possível buscar a carta agora. Tente novamente em instantes.", "warn");
        } finally {
            setBusy(false);
        }
    }

    function normalizeScryfallCard(card) {
        const face = Array.isArray(card.card_faces) ? card.card_faces[0] : null;
        const imageUris = card.image_uris || face?.image_uris || {};
        const oracleText = card.oracle_text || face?.oracle_text || "";

        return {
            id: String(card.id || ""),
            name: String(card.name || face?.name || "Carta"),
            manaCost: String(card.mana_cost || face?.mana_cost || ""),
            typeLine: String(card.type_line || face?.type_line || ""),
            oracleText: String(oracleText || ""),
            imageUrl: String(imageUris.normal || imageUris.large || imageUris.small || "")
        };
    }

    function summarizeOracle(text, limit = ORACLE_LIMIT) {
        const clean = String(text || "").replace(/\s+/g, " ").trim();
        if (clean.length <= limit) return clean;
        return `${clean.slice(0, limit - 1).trim()}…`;
    }

    function renderResult(card) {
        if (!resultEl) return;

        resultEl.innerHTML = "";
        resultEl.classList.toggle("hidden", !card);

        if (!card) return;

        const image = document.createElement("img");
        image.src = card.imageUrl || "/assets/default-avatar.png";
        image.alt = card.name;

        const details = document.createElement("div");
        details.className = "card-scanner-result-details";

        const name = document.createElement("h3");
        name.innerText = card.name;

        const meta = document.createElement("p");
        meta.className = "card-scanner-meta";
        meta.innerText = [card.manaCost, card.typeLine].filter(Boolean).join(" • ");

        const oracle = document.createElement("p");
        oracle.className = "card-scanner-oracle";
        oracle.innerText = summarizeOracle(card.oracleText);

        const actions = document.createElement("div");
        actions.className = "card-scanner-actions";

        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.innerText = "Confirmar e mostrar para mesa";
        confirm.addEventListener("click", confirmCard);

        actions.appendChild(confirm);
        details.append(name, meta, oracle, actions);
        resultEl.append(image, details);
    }

    function confirmCard() {
        const roomSocket = getSocket();
        if (!currentCard || !roomSocket) return;

        const state = getRoomState();

        roomSocket.emit("card-scan-confirmed", {
            roomId: state.roomId,
            card: currentCard
        });

        closeModal();
    }

    function makePublicCardInteractive(card, resizeHandle) {
        let dragging = false;
        let resizing = false;

        let startX = 0;
        let startY = 0;

        let startLeft = 0;
        let startTop = 0;

        let startWidth = 0;
        let startHeight = 0;

        function clamp(value, min, max) {
            return Math.min(Math.max(value, min), max);
        }

        function updateScale(width) {
            const scale = clamp(width / 430, 0.85, 2.4);
            card.style.setProperty("--scan-scale", scale.toFixed(2));

            const imageColumn = Math.round(120 * scale);
            card.style.gridTemplateColumns = `${imageColumn}px 1fr`;
        }

        card.addEventListener("mousedown", event => {
            if (
                event.target === resizeHandle ||
                event.target.closest(".card-scan-public-close") ||
                event.target.closest(".card-scan-resize-handle")
            ) {
                return;
            }

            dragging = true;

            const rect = card.getBoundingClientRect();

            startX = event.clientX;
            startY = event.clientY;
            startLeft = rect.left;
            startTop = rect.top;

            card.style.left = `${rect.left}px`;
            card.style.top = `${rect.top}px`;
            card.style.right = "auto";
            card.style.bottom = "auto";

            event.preventDefault();
        });

        resizeHandle.addEventListener("mousedown", event => {
            event.stopPropagation();
            event.preventDefault();

            resizing = true;

            const rect = card.getBoundingClientRect();

            startX = event.clientX;
            startY = event.clientY;
            startWidth = rect.width;
            startHeight = rect.height;

            card.style.left = `${rect.left}px`;
            card.style.top = `${rect.top}px`;
            card.style.right = "auto";
            card.style.bottom = "auto";
        });

        document.addEventListener("mousemove", event => {
            if (dragging) {
                const maxLeft = window.innerWidth - card.offsetWidth - 8;
                const maxTop = window.innerHeight - card.offsetHeight - 8;

                const nextLeft = clamp(startLeft + event.clientX - startX, 8, Math.max(8, maxLeft));
                const nextTop = clamp(startTop + event.clientY - startY, 8, Math.max(8, maxTop));

                card.style.left = `${nextLeft}px`;
                card.style.top = `${nextTop}px`;
            }

            if (resizing) {
                const maxWidth = Math.max(360, window.innerWidth - card.getBoundingClientRect().left - 8);
                const maxHeight = Math.max(220, window.innerHeight - card.getBoundingClientRect().top - 8);

                const nextWidth = clamp(startWidth + event.clientX - startX, 360, maxWidth);
                const nextHeight = clamp(startHeight + event.clientY - startY, 220, maxHeight);

                card.style.width = `${nextWidth}px`;
                card.style.minHeight = `${nextHeight}px`;

                updateScale(nextWidth);
            }
        });

        document.addEventListener("mouseup", () => {
            dragging = false;
            resizing = false;
        });

        updateScale(card.getBoundingClientRect().width || 430);
    }

    function renderPublicCard(payload) {
        if (!publicLayer || !payload?.card) return;

        const card = payload.card;
        const wrapper = document.createElement("article");
        wrapper.className = "card-scan-public-card";

        const close = document.createElement("button");
        close.type = "button";
        close.className = "card-scan-public-close";
        close.innerText = "×";
        close.setAttribute("aria-label", "Fechar carta escaneada");
        close.addEventListener("click", () => wrapper.remove());

        const image = document.createElement("img");
        image.src = card.imageUrl || "/assets/default-avatar.png";
        image.alt = card.name || "Carta escaneada";

        const content = document.createElement("div");
        content.className = "card-scan-public-content";

        const author = document.createElement("span");
        author.className = "card-scan-public-author";
        author.innerText = `${payload.playerName || "Jogador"} escaneou`;

        const title = document.createElement("h3");
        title.innerText = card.name || "Carta";

        const type = document.createElement("p");
        type.className = "card-scan-public-type";
        type.innerText = card.typeLine || "";

        const oracle = document.createElement("p");
        oracle.className = "card-scan-public-oracle";
        oracle.innerText = summarizeOracle(card.oracleText, 260);

        const resizeHandle = document.createElement("div");
        resizeHandle.className = "card-scan-resize-handle";
        resizeHandle.innerText = "↘";

        content.append(author, title, type, oracle);
        wrapper.append(close, image, content, resizeHandle);

        publicLayer.prepend(wrapper);
        makePublicCardInteractive(wrapper, resizeHandle);

        while (publicLayer.children.length > 2) {
            publicLayer.lastElementChild?.remove();
        }
    }

    button?.addEventListener("click", openModal);
    closeBtn?.addEventListener("click", closeModal);
    captureBtn?.addEventListener("click", captureAndScan);

    retryBtn?.addEventListener("click", () => {
        currentCard = null;
        renderResult(null);
        setStatus("Aponte a câmera para a carta ou digite o nome manualmente.");
        startPreviewLoop();
    });

    manualBtn?.addEventListener("click", () => searchCard(manualInput?.value));

    manualInput?.addEventListener("keydown", event => {
        if (event.key === "Enter") searchCard(manualInput.value);
    });

    window.addEventListener("resenhaon-room-state", updateButtonVisibility);
    getSocket()?.on?.("card-scan-shown", renderPublicCard);

    updateButtonVisibility();
})();