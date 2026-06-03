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

  function renderTournament() {
    authNotice.classList.toggle("hidden", !!loggedUser);
    createForm.querySelector("button[type='submit']").disabled = !loggedUser || !!activeTournament;

    if (!activeTournament) {
      statusBadge.innerText = "---";
      activeBox.className = "empty-state";
      activeBox.innerHTML = "Nenhum torneio ativo no momento.";
      ownerActions.classList.add("hidden");
      playersList.innerHTML = "";
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
    const standings = [...activeTournament.players].sort((a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      a.name.localeCompare(b.name)
    );

    standingsBody.innerHTML = standings.map((player, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(player.name)}</td>
        <td>${player.points}</td>
        <td>${player.wins}</td>
        <td>${player.draws}</td>
        <td>${player.losses}</td>
        <td>${player.byes}</td>
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
    const resultLabel = {
      player1_win: `Vitória ${p1}`,
      player2_win: `Vitória ${p2}`,
      draw: "Empate",
      bye: "BYE"
    }[match.result] || "Sem resultado";

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
    card.querySelectorAll("[data-result]").forEach(button => {
      button.addEventListener("click", async () => {
        try {
          await mutate(`/${activeTournament.id}/matches/${match.id}/result`, { result: button.dataset.result });
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
