(() => {
  const apiBase = "/api/tournaments";
  let activeTournament = null;
  let authResolved = false;
  let loggedUser = null;

  const createForm = document.getElementById("createTournamentForm");
  const authNotice = document.getElementById("authNotice");
  const activeBox = document.getElementById("activeTournamentBox");
  const statusBadge = document.getElementById("tournamentStatusBadge");
  const ownerActions = document.getElementById("ownerActions");
  const playersList = document.getElementById("playersList");
  const championBox = document.getElementById("championBox");
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
    if (!response.ok) {
      throw new Error(data.error || "Erro ao acessar torneios.");
    }

    return data;
  }

  async function mutate(path, body = {}) {
    const user = getUserPayload();
    if (!user) {
      alert("Entre com Google para executar esta ação.");
      throw new Error("Usuário não autenticado.");
    }

    return request(path, {
      method: "POST",
      body: JSON.stringify({ ...body, user })
    });
  }

  function statusLabel(status) {
    const labels = {
      registration_open: "Inscrições abertas",
      registration_closed: "Inscrições encerradas",
      in_progress: "Em andamento",
      finished: "Finalizado"
    };
    return labels[status] || "---";
  }

  function isOwner() {
    return !!(activeTournament && loggedUser && activeTournament.ownerId === loggedUser.uid);
  }

  function isRegistered() {
    const uid = loggedUser?.uid;
    return !!activeTournament?.players?.some(player => player.userId === uid);
  }

  function isTournamentBlockingCreation() {
    return ["registration_open", "registration_closed", "in_progress"].includes(activeTournament?.status);
  }

  function canReport(match) {
    if (!activeTournament || !loggedUser) return false;
    if (isOwner()) return true;
    return match.player1Id === loggedUser.uid || match.player2Id === loggedUser.uid;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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
          [1, 0, `${p1} 1x0 ${p2}`],
          [0, 1, `${p1} 0x1 ${p2}`],
          [0, 0, "Empate 0x0"]
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
      label
    }));
  }

  function renderTournament() {
    authNotice.classList.toggle("hidden", !!loggedUser);
    createForm.querySelector("button[type='submit']").disabled = !loggedUser || isTournamentBlockingCreation();

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
      return;
    }

    statusBadge.innerText = statusLabel(activeTournament.status);
    activeBox.className = "";
    activeBox.innerHTML = `
      <h3>${escapeHtml(activeTournament.name)}</h3>
      <p class="muted">${escapeHtml(activeTournament.format)} • ${activeTournament.roundsTotal} rodada(s) • limite ${activeTournament.maxPlayers} jogadores</p>
      <p><strong>Link compartilhável:</strong> <code>${escapeHtml(location.origin + "/torneios.html?code=" + activeTournament.inviteCode)}</code></p>
      <p><strong>Rodada atual:</strong> ${activeTournament.currentRound || 0}</p>
    `;

    renderOwnerActions();
    renderPlayers();
    renderStandings();
    renderRounds();

    joinBtn.disabled = !loggedUser || activeTournament.status !== "registration_open" || isRegistered();
    if (activeTournament.status === "finished") {
      joinBtn.innerText = "Torneio finalizado";
      return;
    }
    joinBtn.innerText = isRegistered() ? "Você já está inscrito" : "Entrar no torneio";
  }

  function renderOwnerActions() {
    ownerActions.innerHTML = "";
    ownerActions.classList.toggle("hidden", !isOwner());
    if (!isOwner()) return;

    const actions = [];
    if (activeTournament.status === "registration_open") {
      actions.push(["Encerrar inscrições", () => mutate(`/${activeTournament.id}/close-registration`)]);
      actions.push(["Lançar rodada 1", () => mutate(`/${activeTournament.id}/launch-round`)]);
    }
    if (["registration_closed", "in_progress"].includes(activeTournament.status)) {
      const currentRound = activeTournament.rounds?.find(round => round.roundNumber === activeTournament.currentRound);
      const canNext = !currentRound || currentRound.status === "completed";
      if (activeTournament.currentRound < activeTournament.roundsTotal) {
        actions.push(["Lançar próxima rodada", () => mutate(`/${activeTournament.id}/launch-round`), !canNext]);
      } else if (canNext) {
        actions.push(["Encerrar torneio", () => mutate(`/${activeTournament.id}/finish`)]);
      }
    }
    if (activeTournament.status !== "finished" && !actions.some(([label]) => label === "Encerrar torneio")) {
      actions.push(["Encerrar torneio", () => mutate(`/${activeTournament.id}/finish`)]);
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

  function renderPlayers() {
    if (!activeTournament.players.length) {
      playersList.innerHTML = '<p class="empty-state">Nenhum jogador inscrito.</p>';
      return;
    }

    playersList.innerHTML = activeTournament.players.map(player => `
      <article class="player-card">
        <img src="${escapeHtml(player.avatar || "/assets/default-avatar.png")}" alt="">
        <div>
          <strong>${escapeHtml(player.name)}</strong>
          <span>${player.dropped ? "Removido" : "Inscrito"} • ${player.points} ponto(s)</span>
        </div>
        ${isOwner() && activeTournament.status === "registration_open" && player.userId !== activeTournament.ownerId
          ? `<button type="button" class="danger" data-remove-player="${escapeHtml(player.id)}">Remover</button>`
          : ""}
      </article>
    `).join("");

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
  }

  function renderStandings() {
    const standings = activeTournament.standings?.length ? activeTournament.standings : [...activeTournament.players];

    if (championBox) {
      const champion = activeTournament.champion || (activeTournament.status === "finished" ? standings[0] : null);
      championBox.classList.toggle("hidden", !champion);
      if (champion) {
        championBox.innerHTML = `
          <img src="${escapeHtml(champion.avatar || "/assets/default-avatar.png")}" alt="">
          <div>
            <span>🏆 Campeão do torneio</span>
            <strong>${escapeHtml(champion.name)}</strong>
            <p>${champion.matchPoints ?? champion.points ?? 0} pontos</p>
            <small>${champion.matchWins ?? champion.wins ?? 0}V - ${champion.matchDraws ?? champion.draws ?? 0}E - ${champion.matchLosses ?? champion.losses ?? 0}D</small>
          </div>
        `;
      }
    }

    standingsBody.innerHTML = standings.map((player, index) => `
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

  function renderMatch(match) {
    const card = document.createElement("article");
    card.className = "match-card";
    const p1 = playerName(match.player1Id);
    const p2 = playerName(match.player2Id);
    const roomUrl = match.roomUrl || `/sala.html?room=${encodeURIComponent(match.roomId)}`;
    const resultLabel = match.resultLabel || {
      player1_win: `Vitória ${p1}`,
      player2_win: `Vitória ${p2}`,
      draw: "Empate",
      bye: "BYE"
    }[match.result] || "Sem resultado";
    const scoreOptions = getScoreOptions(match);

    card.innerHTML = `
      <div class="match-title">
        <span>Mesa ${match.tableNumber}</span>
        <span>${escapeHtml(match.status)}</span>
      </div>
      <div class="versus">
        <span>${escapeHtml(p1)}</span>
        <span>x</span>
        <span>${escapeHtml(p2)}</span>
      </div>
      <p class="${match.result ? "ok" : "muted"}">Resultado: ${escapeHtml(resultLabel)}</p>
      ${match.externalPlay ? `<p class="notice">Esta mesa está jogando externamente. O resultado ainda deve ser lançado no ResenhaON.</p>` : ""}
      <div class="match-actions">
        <button type="button" data-open-room="${escapeHtml(roomUrl)}">Entrar na mesa ResenhaON</button>
        ${match.externalUrl ? `<button type="button" data-open-external="${escapeHtml(match.externalUrl)}">Abrir link externo</button>` : ""}
      </div>
      <div class="external-box">
        <input type="url" placeholder="Link externo Meet/Discord/WhatsApp" value="${escapeHtml(match.externalUrl || "")}" data-external-url>
        <button type="button" data-external-match>Marcar como jogando externamente</button>
      </div>
      <div class="result-row">
        <button type="button" data-result="player1_win" ${canReport(match) && !match.isBye ? "" : "disabled"}>Vitória ${escapeHtml(p1)}</button>
        <button type="button" data-result="player2_win" ${canReport(match) && !match.isBye ? "" : "disabled"}>Vitória ${escapeHtml(p2)}</button>
        <button type="button" data-result="draw" ${canReport(match) && !match.isBye ? "" : "disabled"}>Empate</button>
      </div>
    `;

    const resultRow = card.querySelector(".result-row");
    if (resultRow) {
      resultRow.innerHTML = scoreOptions.map(option => `
        <button type="button"
          data-p1-games="${option.player1GameWins}"
          data-p2-games="${option.player2GameWins}"
          ${canReport(match) && !match.isBye ? "" : "disabled"}>
          ${escapeHtml(option.label)}
        </button>
      `).join("");
    }

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
            player2GameWins: Number(button.dataset.p2Games)
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

  createForm.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await mutate("", {
        name: document.getElementById("tournamentNameInput").value.trim(),
        maxPlayers: Number(document.getElementById("maxPlayersInput").value),
        roundsTotal: Number(document.getElementById("roundsInput").value),
        format: document.getElementById("formatInput").value
      });
      createForm.reset();
      await loadTournament();
    } catch (error) {
      alert(error.message);
    }
  });

  joinBtn.addEventListener("click", async () => {
    try {
      await mutate(`/${activeTournament.id}/join`);
      await loadTournament();
    } catch (error) {
      alert(error.message);
    }
  });

  refreshBtn.addEventListener("click", loadTournament);

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
