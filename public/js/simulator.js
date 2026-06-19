(function () {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room") || localStorage.getItem("resenhaon-last-simulator-room") || "mtg-1002";
  const savedPlayerId = localStorage.getItem("resenhaon-simulator-player-id") || `sim-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const savedName = localStorage.getItem("resenhaon-simulator-name") || "";
  const socket = io();

  let playerId = savedPlayerId;
  let state = null;

  localStorage.setItem("resenhaon-simulator-player-id", playerId);
  localStorage.setItem("resenhaon-last-simulator-room", roomId);

  const el = id => document.getElementById(id);
  const zoneLabels = {
    hand: "Mao",
    battlefield: "Campo",
    graveyard: "Cemiterio",
    exile: "Exilio",
    commandZone: "Comando",
    library: "Grimorio"
  };
  const phaseLabels = {
    untap: "Untap",
    upkeep: "Upkeep / Manutencao",
    draw: "Draw",
    main1: "Main Phase 1",
    beginCombat: "Beginning of Combat",
    attackers: "Declare Attackers",
    blockers: "Declare Blockers",
    damage: "Combat Damage",
    endCombat: "End of Combat",
    main2: "Main Phase 2",
    end: "End Step",
    cleanup: "Cleanup"
  };

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function playerName() {
    return el("playerNameInput")?.value.trim() || savedName || "Jogador";
  }

  function joinSimulator() {
    const name = playerName();
    localStorage.setItem("resenhaon-simulator-name", name);
    socket.emit("simulator-join", { roomId, playerId, name });
  }

  function sendAction(action) {
    socket.emit("simulator-action", { roomId, playerId, action });
  }

  function selfPlayer() {
    return state?.players?.[playerId] || null;
  }

  function render() {
    const self = selfPlayer();
    const players = Object.values(state?.players || {});
    const currentPhase = state?.currentPhase || "main1";

    el("roomTitle").textContent = `Sala ${roomId}`;
    el("currentPhaseLabel").textContent = phaseLabels[currentPhase] || currentPhase;
    el("playerCount").textContent = String(players.length);
    el("activePlayerLabel").textContent = state?.activePlayerId
      ? `${state.players[state.activePlayerId]?.name || "Jogador"} em ${phaseLabels[currentPhase] || currentPhase}`
      : "Aguardando jogador";

    document.querySelectorAll(".phase-bar button").forEach(button => {
      button.classList.toggle("active", button.dataset.phase === currentPhase);
    });

    if (!self) {
      renderEmpty();
      return;
    }

    el("selfName").textContent = self.name || "Jogador";
    el("selfLife").textContent = String(self.life ?? 40);
    el("libraryCount").textContent = String(self.libraryCount || 0);
    el("handCount").textContent = `${self.handCount || 0} carta${self.handCount === 1 ? "" : "s"}`;
    el("graveyardCount").textContent = String(self.graveyard?.length || 0);
    el("exileCount").textContent = String(self.exile?.length || 0);
    el("commandCount").textContent = String(self.commandZone?.length || 0);

    renderCards(el("handZone"), self.hand || [], "hand");
    renderCards(el("battlefieldZone"), self.battlefield || [], "battlefield");
    renderMiniZone(el("graveyardZone"), self.graveyard || [], "graveyard");
    renderMiniZone(el("exileZone"), self.exile || [], "exile");
    renderMiniZone(el("commandZone"), self.commandZone || [], "commandZone");
    renderLog();
  }

  function renderEmpty() {
    ["handZone", "battlefieldZone", "graveyardZone", "exileZone", "commandZone", "actionLog"].forEach(id => {
      el(id).innerHTML = `<div class="empty-zone">Entre no Simulator para carregar seu deck de teste.</div>`;
    });
    el("selfName").textContent = "Jogador";
    el("selfLife").textContent = "40";
    el("libraryCount").textContent = "0";
    el("handCount").textContent = "0 cartas";
  }

  function renderCards(container, cards, zone) {
    if (!cards.length) {
      container.innerHTML = `<div class="empty-zone">Nenhuma carta em ${zoneLabels[zone] || zone}.</div>`;
      return;
    }

    container.innerHTML = cards.map(card => `
      <article class="sim-card ${card.tapped ? "tapped" : ""} ${card.attacking ? "attacking" : ""} ${card.blocking ? "blocking" : ""}" data-card-id="${escapeHtml(card.id)}">
        <span class="cost">${escapeHtml(card.cost || "-")}</span>
        <div>
          ${card.token ? `<span class="token-tag">Token</span>` : ""}
          <h3>${escapeHtml(card.name)}</h3>
          <p>${escapeHtml(card.type)}</p>
          <p>+1/+1: ${Number(card.counters?.p1p1 || 0)} | Marcador: ${Number(card.counters?.generic || 0)}</p>
        </div>
        <div class="card-actions">
          ${cardActions(card, zone)}
        </div>
      </article>
    `).join("");
  }

  function cardActions(card, zone) {
    if (zone === "hand") {
      return `
        <button data-action="moveCard" data-card-id="${escapeHtml(card.id)}" data-zone="battlefield">Jogar</button>
        <button data-action="moveCard" data-card-id="${escapeHtml(card.id)}" data-zone="graveyard">Descartar</button>
        <button data-action="moveCard" data-card-id="${escapeHtml(card.id)}" data-zone="exile">Exilar</button>
        <button data-action="moveCard" data-card-id="${escapeHtml(card.id)}" data-zone="library" data-position="top">Topo</button>
        <button data-action="moveCard" data-card-id="${escapeHtml(card.id)}" data-zone="library" data-position="bottom">Fundo</button>
      `;
    }

    if (zone === "battlefield") {
      return `
        <button data-action="toggleTap" data-card-id="${escapeHtml(card.id)}">${card.tapped ? "Desvirar" : "Virar"}</button>
        <button data-action="counter" data-card-id="${escapeHtml(card.id)}" data-counter="p1p1" data-value="1">+1/+1</button>
        <button data-action="counter" data-card-id="${escapeHtml(card.id)}" data-counter="p1p1" data-value="-1">-1/-1</button>
        <button data-action="counter" data-card-id="${escapeHtml(card.id)}" data-counter="generic" data-value="1">Marcador</button>
        <button data-action="counter" data-card-id="${escapeHtml(card.id)}" data-counter="generic" data-value="-1">- Marcador</button>
        <button data-action="combatFlag" data-card-id="${escapeHtml(card.id)}" data-flag="attacking" data-enabled="${!card.attacking}">${card.attacking ? "Remover atacante" : "Atacar"}</button>
        <button data-action="combatFlag" data-card-id="${escapeHtml(card.id)}" data-flag="blocking" data-enabled="${!card.blocking}">${card.blocking ? "Remover bloqueio" : "Bloquear"}</button>
        <button data-action="moveCard" data-card-id="${escapeHtml(card.id)}" data-zone="graveyard">Cemiterio</button>
        <button data-action="moveCard" data-card-id="${escapeHtml(card.id)}" data-zone="exile">Exilio</button>
        <button data-action="moveCard" data-card-id="${escapeHtml(card.id)}" data-zone="hand">Mao</button>
      `;
    }

    return "";
  }

  function renderMiniZone(container, cards, zone) {
    if (!cards.length) {
      container.innerHTML = `<div class="empty-zone">Vazio</div>`;
      return;
    }

    container.innerHTML = cards.map(card => `
      <article class="mini-card">
        <strong>${escapeHtml(card.name)}</strong>
        <small>${escapeHtml(card.type)}</small>
        <div>
          <button data-action="moveCard" data-card-id="${escapeHtml(card.id)}" data-zone="hand">Mao</button>
          <button data-action="moveCard" data-card-id="${escapeHtml(card.id)}" data-zone="battlefield">Campo</button>
          <button data-action="moveCard" data-card-id="${escapeHtml(card.id)}" data-zone="library" data-position="top">Topo</button>
          <button data-action="moveCard" data-card-id="${escapeHtml(card.id)}" data-zone="library" data-position="bottom">Fundo</button>
        </div>
      </article>
    `).join("");
  }

  function renderLog() {
    const log = state?.log || [];
    el("actionLog").innerHTML = log.length
      ? log.slice(0, 30).map(item => `<div class="log-item">${escapeHtml(item.message)}</div>`).join("")
      : `<div class="empty-zone">Nenhuma acao registrada.</div>`;
  }

  function handleCardClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    if (action === "moveCard") {
      sendAction({
        type: "moveCard",
        cardId: button.dataset.cardId,
        toZone: button.dataset.zone,
        position: button.dataset.position || "top"
      });
    } else if (action === "toggleTap") {
      sendAction({ type: "toggleTap", cardId: button.dataset.cardId });
    } else if (action === "counter") {
      sendAction({
        type: "counter",
        cardId: button.dataset.cardId,
        counterType: button.dataset.counter,
        value: Number(button.dataset.value || 0)
      });
    } else if (action === "combatFlag") {
      sendAction({
        type: "combatFlag",
        cardId: button.dataset.cardId,
        flag: button.dataset.flag,
        enabled: button.dataset.enabled === "true"
      });
    }
  }

  function bindEvents() {
    el("playerNameInput").value = savedName;
    el("joinSimulatorBtn").addEventListener("click", joinSimulator);
    el("playerNameInput").addEventListener("keydown", event => {
      if (event.key === "Enter") joinSimulator();
    });

    document.querySelectorAll("[data-life]").forEach(button => {
      button.addEventListener("click", () => sendAction({ type: "life", value: Number(button.dataset.life || 0) }));
    });

    el("libraryButton").addEventListener("click", () => {
      el("libraryMenu").classList.toggle("hidden");
    });

    document.querySelectorAll("[data-library-action]").forEach(button => {
      button.addEventListener("click", () => {
        const action = button.dataset.libraryAction;
        if (action === "drawX") {
          sendAction({ type: "draw", value: Number(el("drawXInput").value || 1) });
        } else if (action === "scry") {
          sendAction({ type: "scry", value: Number(el("scryInput").value || 1) });
        } else {
          sendAction({ type: action });
        }
      });
    });

    document.querySelectorAll(".phase-bar button").forEach(button => {
      button.addEventListener("click", () => sendAction({ type: "phase", value: button.dataset.phase }));
    });

    el("createTokenBtn").addEventListener("click", () => {
      sendAction({ type: "token", value: el("tokenSelect").value });
    });

    el("resetPlayerBtn").addEventListener("click", () => {
      if (confirm("Resetar seu estado do Simulator MVP?")) {
        sendAction({ type: "reset" });
      }
    });

    document.body.addEventListener("click", handleCardClick);
  }

  socket.on("connect", () => {
    if (savedName || el("playerNameInput").value.trim()) {
      joinSimulator();
    }
  });

  socket.on("simulator-state", payload => {
    state = payload;
    render();
  });

  bindEvents();
  renderEmpty();
})();
