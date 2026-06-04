(() => {
  const apiBase = "/api/tournaments";
  let activeTournament = null;
  let authResolved = false;
  let loggedUser = null;

  const createForm = document.getElementById("createTournamentForm");
  const typeInput = document.getElementById("tournamentTypeInput");
  const swissSettings = document.getElementById("swissSettings");
  const submitBtn = createForm?.querySelector("button[type='submit']");
  const authNotice = document.getElementById("authNotice");
  const activeBox = document.getElementById("activeTournamentBox");
  const statusBadge = document.getElementById("tournamentStatusBadge");
  const ownerActions = document.getElementById("ownerActions");
  const playersList = document.getElementById("playersList");
  const championBox = document.getElementById("championBox");
  const standingsHead = document.getElementById("standingsHead");
  const standingsBody = document.getElementById("standingsBody");
  const roundsRoot = document.getElementById("roundsRoot");
  const joinBtn = document.getElementById("joinTournamentBtn");
  const refreshBtn = document.getElementById("refreshTournamentBtn");

  function waitForAuth() {
    return new Promise(resolve => {
      if (window.authHasResolved || window.currentUser) {
        resolve(window.currentUser || null);
        return;
      }

      if (window.onAuthStateChanged) {
        window.onAuthStateChanged(user => resolve(user || null));
        return;
      }

      window.addEventListener("firebase-auth-ready", () => {
        window.onAuthStateChanged?.(user => resolve(user || null));
      }, { once: true });

      setTimeout(() => resolve(window.currentUser || null), 2500);
    });
  }

  function getUserPayload() {
    const profile = window.getLoggedUserProfile?.();
    if (!profile) return null;

    return {
      id: profile.uid,
      uid: profile.uid,
      name: profile.name,
      email: profile.email,
      avatar: profile.photo,
      photo: profile.photo
    };
  }

  async function request(path, options = {}) {
    const response = await fetch(`${apiBase}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Erro ao acessar torneios.");
    return data;
  }

  async function mutate(path, body = {}) {
    const user = getUserPayload();
    if (!user) {
      alert("Entre com Google para executar esta acao.");
      throw new Error("Usuario nao autenticado.");
    }

    return request(path, {
      method: "POST",
      body: JSON.stringify({ ...body, user })
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function isRoundTable() {
    return activeTournament?.type === "round_table";
  }

  function typeLabel(type = activeTournament?.type) {
    return type === "round_table" ? "Mesa Redonda / Rei da Mesa" : "Torneio Suico";
  }

  function statusLabel(status) {
    const labels = {
      registration_open: "Inscricoes abertas",
      registration_closed: "Inscricoes encerradas",
      in_progress: "Em andamento",
      finished: "Finalizado"
    };
    return labels[status] || "---";
  }

  function isOwner() {
    return !!(activeTournament && loggedUser && activeTournament.ownerId === loggedUser.uid);
  }

  function ownPlayer() {
    const uid = loggedUser?.uid;
    return activeTournament?.players?.find(player => player.userId === uid) || null;
  }

  function isRegistered() {
    return !!ownPlayer();
  }

  function isTournamentBlockingCreation() {
    return ["registration_open", "registration_closed", "in_progress"].includes(activeTournament?.status);
  }

  function canReport(match) {
    if (!activeTournament || !loggedUser) return false;
    if (isOwner()) return true;
    return match.player1Id === loggedUser.uid || match.player2Id === loggedUser.uid;
  }

  function playerById(id) {
    return activeTournament?.players?.find(player => player.id === id || player.userId === id) || null;
  }

  function playerName(id) {
    return playerById(id)?.name || "BYE";
  }

  function formatPercent(value) {
    return `${((Number(value) || 0) * 100).toFixed(1)}%`;
  }

  function gameDifferentialLabel(player) {
    const diff = Number(player.gameDifferential) || 0;
    return diff > 0 ? `+${diff}` : String(diff);
  }

  function getScoreOptions(match) {
    const p1 = playerName(match.player1Id);
    const p2 = playerName(match.player2Id);
    const scores = activeTournament?.format === "BO1"
      ? [
          [1, 0, `Vitoria ${p1}`],
          [0, 1, `Vitoria ${p2}`],
          [0, 0, "Empate"]
        ]
      : [
          [2, 0, `${p1} 2x0 ${p2}`],
          [2, 1, `${p1} 2x1 ${p2}`],
          [1, 1, `${p1} 1x1 ${p2}`],
          [0, 2, `${p1} 0x2 ${p2}`],
          [1, 2, `${p1} 1x2 ${p2}`]
        ];

    return scores.map(([player1GameWins, player2GameWins, label]) => ({
      player1GameWins,
      player2GameWins,
      result: player1GameWins > player2GameWins ? "player1_win" : player2GameWins > player1GameWins ? "player2_win" : "draw",
      label
    }));
  }

  function updateCreateMode() {
    const roundTableSelected = typeInput?.value === "round_table";
    swissSettings?.classList.toggle("hidden", roundTableSelected);
    if (submitBtn) submitBtn.innerText = roundTableSelected ? "Criar Mesa Redonda" : "Criar torneio";
  }

  function renderTournament() {
    authNotice?.classList.toggle("hidden", !!loggedUser);
    if (submitBtn) submitBtn.disabled = !loggedUser || isTournamentBlockingCreation();

    if (!activeTournament) {
      statusBadge.innerText = "---";
      activeBox.className = "empty-state";
      activeBox.innerHTML = "Nenhum torneio ativo no momento.";
      ownerActions.classList.add("hidden");
      playersList.innerHTML = "";
      championBox?.classList.add("hidden");
      standingsBody.innerHTML = "";
      roundsRoot.innerHTML = "";
      joinBtn.disabled = true;
      joinBtn.innerText = "Entrar no torneio";
      return;
    }

    const roundTable = isRoundTable();
    statusBadge.innerText = statusLabel(activeTournament.status);
    activeBox.className = "";
    activeBox.innerHTML = `
      <h3>${escapeHtml(activeTournament.name)}</h3>
      <p class="muted">${escapeHtml(typeLabel())} • ${escapeHtml(activeTournament.format)}${roundTable ? " • BO1 continuo" : ` • ${activeTournament.roundsTotal} rodada(s) • limite ${activeTournament.maxPlayers} jogadores`}</p>
      <p><strong>Link compartilhavel:</strong> <code>${escapeHtml(location.origin + "/torneios.html?code=" + activeTournament.inviteCode)}</code></p>
      <p><strong>${roundTable ? "Partida atual" : "Rodada atual"}:</strong> ${roundTable ? activeTournament.roundTable?.currentMatch?.roundNumber || "aguardando desafiante" : activeTournament.currentRound || 0}</p>
    `;

    renderOwnerActions();
    renderPlayers();
    renderStandings();
    renderRounds();

    if (activeTournament.status === "finished") {
      joinBtn.disabled = true;
      joinBtn.innerText = roundTable ? "Mesa Redonda finalizada" : "Torneio finalizado";
      return;
    }

    joinBtn.disabled = !loggedUser || isRegistered() || (!roundTable && activeTournament.status !== "registration_open");
    if (roundTable) {
      joinBtn.innerText = isRegistered() ? "Voce ja esta na Mesa Redonda" : "Entrar na fila";
    } else {
      joinBtn.innerText = isRegistered() ? "Voce ja esta inscrito" : "Entrar no torneio";
    }
  }

  function renderOwnerActions() {
    ownerActions.innerHTML = "";
    ownerActions.classList.toggle("hidden", !isOwner());
    if (!isOwner()) return;

    const actions = [];
    if (isRoundTable()) {
      if (activeTournament.status !== "finished") {
        actions.push(["Encerrar Mesa Redonda", () => mutate(`/${activeTournament.id}/finish`)]);
      }
    } else {
      if (activeTournament.status === "registration_open") {
        actions.push(["Encerrar inscricoes", () => mutate(`/${activeTournament.id}/close-registration`)]);
        actions.push(["Lancar rodada 1", () => mutate(`/${activeTournament.id}/launch-round`)]);
      }
      if (["registration_closed", "in_progress"].includes(activeTournament.status)) {
        const currentRound = activeTournament.rounds?.find(round => round.roundNumber === activeTournament.currentRound);
        const canNext = !currentRound || currentRound.status === "completed";
        if (activeTournament.currentRound < activeTournament.roundsTotal) {
          actions.push(["Lancar proxima rodada", () => mutate(`/${activeTournament.id}/launch-round`), !canNext]);
        } else if (canNext) {
          actions.push(["Encerrar torneio", () => mutate(`/${activeTournament.id}/finish`)]);
        }
      }
      if (activeTournament.status !== "finished" && !actions.some(([label]) => label === "Encerrar torneio")) {
        actions.push(["Encerrar torneio", () => mutate(`/${activeTournament.id}/finish`)]);
      }
    }

    actions.forEach(([label, action, disabled]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.innerText = label;
      button.disabled = !!disabled;
      button.addEventListener("click", async () => {
        try {
          await action();
          await loadTournament();
        } catch (error) {
          alert(error.message);
        }
      });
      ownerActions.appendChild(button);
    });
  }

  function getRoundTablePlayerStatus(player) {
    if (!isRoundTable()) return player.dropped ? "Removido" : "Inscrito";
    if (player.dropped) return "Dropou";
    const match = activeTournament.roundTable?.currentMatch;
    if (player.id === activeTournament.currentChampionId) return "Campeao atual";
    if (match && (match.player1Id === player.id || match.player2Id === player.id)) return "Na mesa";
    const queueIndex = (activeTournament.queue || []).indexOf(player.id);
    if (queueIndex >= 0) return `Fila #${queueIndex + 1}`;
    return "Aguardando";
  }

  function renderPlayers() {
    if (!activeTournament.players.length) {
      playersList.innerHTML = '<p class="empty-state">Nenhum jogador inscrito.</p>';
      return;
    }

    playersList.innerHTML = activeTournament.players.map(player => {
      const canRemove = isOwner() && !isRoundTable() && activeTournament.status === "registration_open" && player.userId !== activeTournament.ownerId;
      const canDrop = isRoundTable() && activeTournament.status !== "finished" && !player.dropped && (isOwner() || player.userId === loggedUser?.uid);
      return `
        <article class="player-card">
          <img src="${escapeHtml(player.avatar || "/assets/default-avatar.png")}" alt="">
          <div>
            <strong>${escapeHtml(player.name)}</strong>
            <span>${escapeHtml(getRoundTablePlayerStatus(player))} • ${player.matchPoints ?? player.points ?? 0} ponto(s)</span>
          </div>
          ${canRemove ? `<button type="button" class="danger" data-remove-player="${escapeHtml(player.id)}">Remover</button>` : ""}
          ${canDrop ? `<button type="button" class="danger" data-drop-player="${escapeHtml(player.id)}">Dropar</button>` : ""}
        </article>
      `;
    }).join("");

    playersList.querySelectorAll("[data-remove-player]").forEach(button => {
      button.addEventListener("click", async () => {
        try {
          await mutate(`/${activeTournament.id}/remove-player`, { playerId: button.dataset.removePlayer });
          await loadTournament();
        } catch (error) {
          alert(error.message);
        }
      });
    });
    playersList.querySelectorAll("[data-drop-player]").forEach(button => {
      button.addEventListener("click", async () => {
        try {
          await mutate(`/${activeTournament.id}/drop`, { playerId: button.dataset.dropPlayer });
          await loadTournament();
        } catch (error) {
          alert(error.message);
        }
      });
    });
  }

  function renderStandings() {
    const standings = activeTournament.standings?.length ? activeTournament.standings : [...activeTournament.players];

    if (standingsHead) {
      standingsHead.innerHTML = isRoundTable()
        ? `<tr><th>#</th><th>Jogador</th><th>Pts</th><th>V</th><th>E</th><th>D</th><th>Seq.</th><th>Maior seq.</th><th>Status</th></tr>`
        : `<tr><th>#</th><th>Jogador</th><th>Pts</th><th>V</th><th>E</th><th>D</th><th>GW</th><th>GL</th><th>SG</th><th>OMW%</th></tr>`;
    }

    if (championBox) {
      const champion = activeTournament.champion || (activeTournament.status === "finished" ? standings[0] : null);
      championBox.classList.toggle("hidden", !champion);
      if (champion) {
        championBox.innerHTML = `
          <img src="${escapeHtml(champion.avatar || "/assets/default-avatar.png")}" alt="">
          <div>
            <span>${isRoundTable() ? "Campeao da noite" : "Campeao do torneio"}</span>
            <strong>${escapeHtml(champion.name)}</strong>
            <p>${champion.matchPoints ?? champion.points ?? 0} pontos</p>
            <small>${champion.matchWins ?? champion.wins ?? 0}V - ${champion.matchDraws ?? champion.draws ?? 0}E - ${champion.matchLosses ?? champion.losses ?? 0}D</small>
          </div>
        `;
      }
    }

    standingsBody.innerHTML = standings.map((player, index) => isRoundTable()
      ? `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(player.name)}</td>
          <td>${player.matchPoints ?? player.points ?? 0}</td>
          <td>${player.matchWins ?? player.wins ?? 0}</td>
          <td>${player.matchDraws ?? player.draws ?? 0}</td>
          <td>${player.matchLosses ?? player.losses ?? 0}</td>
          <td>${player.currentStreak ?? 0}</td>
          <td>${player.bestStreak ?? 0}</td>
          <td>${escapeHtml(getRoundTablePlayerStatus(player))}</td>
        </tr>
      `
      : `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(player.name)}</td>
          <td>${player.matchPoints ?? player.points ?? 0}</td>
          <td>${player.matchWins ?? player.wins ?? 0}</td>
          <td>${player.matchDraws ?? player.draws ?? 0}</td>
          <td>${player.matchLosses ?? player.losses ?? 0}</td>
          <td>${player.gameWins ?? 0}</td>
          <td>${player.gameLosses ?? 0}</td>
          <td>${gameDifferentialLabel(player)}</td>
          <td>${formatPercent(player.opponentMatchWinPercentage)}</td>
        </tr>
      `).join("");
  }

  function renderRounds() {
    roundsRoot.innerHTML = "";
    if (isRoundTable()) {
      renderRoundTable();
      return;
    }
    if (!activeTournament.rounds?.length) return;

    activeTournament.rounds.forEach(round => {
      const section = document.createElement("section");
      section.className = "round-card";
      const matches = activeTournament.matches.filter(match => match.roundId === round.id);
      section.innerHTML = `
        <div class="panel-header">
          <h2>Rodada ${round.roundNumber}</h2>
          <span class="badge">${escapeHtml(round.status)}</span>
        </div>
        <div class="matches-grid"></div>
      `;
      const grid = section.querySelector(".matches-grid");
      matches.forEach(match => grid.appendChild(renderMatch(match)));
      roundsRoot.appendChild(section);
    });
  }

  function renderRoundTable() {
    const summary = activeTournament.roundTable || {};
    const currentMatch = summary.currentMatch;
    const section = document.createElement("section");
    section.className = "round-card round-table-card";
    const champion = summary.currentChampion;
    const best = summary.bestStreakPlayer;
    section.innerHTML = `
      <div class="round-table-summary">
        <article><span>Campeao atual</span><strong>${escapeHtml(champion?.name || "Aguardando")}</strong></article>
        <article><span>Sequencia atual</span><strong>${champion?.currentStreak || 0}</strong></article>
        <article><span>Maior sequencia</span><strong>${escapeHtml(best?.name || "-")} ${best?.bestStreak || 0}</strong></article>
        <article><span>Partidas jogadas</span><strong>${summary.totalMatches || 0}</strong></article>
      </div>
      <div class="panel-header">
        <h2>Partida atual</h2>
        <span class="badge">Mesa destaque</span>
      </div>
      <div class="matches-grid current-match-grid"></div>
      <div class="round-table-lists">
        <div>
          <h3>Fila</h3>
          <ol class="queue-list">
            ${(summary.queue || []).map(player => `<li>${escapeHtml(player.name)}</li>`).join("") || "<li class='muted'>Fila vazia.</li>"}
          </ol>
        </div>
        <div>
          <h3>Historico</h3>
          <div class="history-list">
            ${(activeTournament.roundTableHistory || []).slice(0, 8).map(item => `<p>${escapeHtml(item.label)}</p>`).join("") || "<p class='muted'>Nenhuma partida finalizada.</p>"}
          </div>
        </div>
      </div>
    `;
    const grid = section.querySelector(".current-match-grid");
    if (currentMatch) {
      grid.appendChild(renderMatch(currentMatch));
    } else {
      grid.innerHTML = '<p class="empty-state">Aguardando pelo menos dois jogadores ativos.</p>';
    }
    roundsRoot.appendChild(section);
  }

  function renderMatch(match) {
    const card = document.createElement("article");
    card.className = "match-card";
    const p1 = playerName(match.player1Id);
    const p2 = playerName(match.player2Id);
    const roomUrl = match.roomUrl || `/sala.html?room=${encodeURIComponent(match.roomId)}`;
    const resultLabel = match.resultLabel || {
      player1_win: `Vitoria ${p1}`,
      player2_win: `Vitoria ${p2}`,
      draw: "Empate",
      bye: "BYE",
      drop: "Drop"
    }[match.result] || "Sem resultado";
    const scoreOptions = getScoreOptions(match);
    const matchLabel = isRoundTable() ? `Partida ${match.roundNumber || "-"}` : `Mesa ${match.tableNumber}`;

    card.innerHTML = `
      <div class="match-title">
        <span>${escapeHtml(matchLabel)}</span>
        <span>${escapeHtml(match.status)}</span>
      </div>
      <div class="versus">
        <span>${escapeHtml(p1)}</span>
        <span>x</span>
        <span>${escapeHtml(p2)}</span>
      </div>
      <p class="${match.result ? "ok" : "muted"}">Resultado: ${escapeHtml(resultLabel)}</p>
      ${match.externalPlay ? `<p class="notice">Esta mesa esta jogando externamente. O resultado ainda deve ser lancado no ResenhaON.</p>` : ""}
      <div class="match-actions">
        <button type="button" data-open-room="${escapeHtml(roomUrl)}">Entrar na mesa ResenhaON</button>
        ${match.externalUrl ? `<button type="button" data-open-external="${escapeHtml(match.externalUrl)}">Abrir link externo</button>` : ""}
      </div>
      ${isRoundTable() ? "" : `
        <div class="external-box">
          <input type="url" placeholder="Link externo Meet/Discord/WhatsApp" value="${escapeHtml(match.externalUrl || "")}" data-external-url>
          <button type="button" data-external-match>Marcar como jogando externamente</button>
        </div>
      `}
      <div class="result-row">
        ${scoreOptions.map(option => `
          <button type="button"
            data-p1-games="${option.player1GameWins}"
            data-p2-games="${option.player2GameWins}"
            data-result="${option.result}"
            ${canReport(match) && !match.isBye && !match.result ? "" : "disabled"}>
            ${escapeHtml(option.label)}
          </button>
        `).join("")}
      </div>
    `;

    card.querySelectorAll("[data-open-room]").forEach(button => {
      button.addEventListener("click", () => window.open(button.dataset.openRoom, "_blank", "noopener,noreferrer"));
    });
    card.querySelectorAll("[data-open-external]").forEach(button => {
      button.addEventListener("click", () => window.open(button.dataset.openExternal, "_blank", "noopener,noreferrer"));
    });
    card.querySelector("[data-external-match]")?.addEventListener("click", async () => {
      try {
        const externalUrl = card.querySelector("[data-external-url]").value.trim();
        await mutate(`/${activeTournament.id}/matches/${match.id}/external`, { externalUrl });
        await loadTournament();
      } catch (error) {
        alert(error.message);
      }
    });
    card.querySelectorAll("[data-p1-games]").forEach(button => {
      button.addEventListener("click", async () => {
        try {
          await mutate(`/${activeTournament.id}/matches/${match.id}/result`, {
            player1GameWins: Number(button.dataset.p1Games),
            player2GameWins: Number(button.dataset.p2Games),
            result: button.dataset.result
          });
          await loadTournament();
        } catch (error) {
          alert(error.message);
        }
      });
    });

    return card;
  }

  async function loadTournament() {
    try {
      const payload = await request("/active");
      activeTournament = payload.tournament || null;
      renderTournament();
    } catch (error) {
      alert(error.message);
    }
  }

  createForm?.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      const type = typeInput?.value === "round_table" ? "round_table" : "swiss";
      await mutate("", {
        type,
        name: document.getElementById("tournamentNameInput").value.trim(),
        maxPlayers: Number(document.getElementById("maxPlayersInput").value),
        roundsTotal: Number(document.getElementById("roundsInput").value),
        format: document.getElementById("formatInput").value
      });
      createForm.reset();
      updateCreateMode();
      await loadTournament();
    } catch (error) {
      alert(error.message);
    }
  });

  joinBtn?.addEventListener("click", async () => {
    try {
      await mutate(`/${activeTournament.id}/join`);
      await loadTournament();
    } catch (error) {
      alert(error.message);
    }
  });

  refreshBtn?.addEventListener("click", loadTournament);
  typeInput?.addEventListener("change", updateCreateMode);
  updateCreateMode();

  waitForAuth().then(user => {
    loggedUser = user;
    authResolved = true;
    renderTournament();
    loadTournament();
  });

  setInterval(() => {
    if (authResolved) loadTournament();
  }, 10000);
})();
