(() => {
  let hall = null;
  let activeTab = "general";

  const summaryRoot = document.getElementById("hallSummary");
  const head = document.getElementById("hallHead");
  const body = document.getElementById("hallBody");
  const refreshBtn = document.getElementById("refreshHallBtn");
  const tabs = document.querySelectorAll("[data-tab]");

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function pct(value) {
    return `${((Number(value) || 0) * 100).toFixed(1)}%`;
  }

  function dateLabel(value) {
    if (!value) return "-";
    return new Date(value).toLocaleDateString("pt-BR");
  }

  function renderSummary() {
    const summary = hall?.summary || {};
    const best = summary.bestStreakPlayer;
    const champion = summary.biggestChampion;
    const matches = summary.mostMatchesPlayer;
    summaryRoot.innerHTML = `
      <article><span>Campeao atual da Mesa</span><strong>${escapeHtml(summary.currentRoundTableChampion || "-")}</strong></article>
      <article><span>Maior sequencia</span><strong>${escapeHtml(best ? `${best.name} ${best.bestStreak}` : "-")}</strong></article>
      <article><span>Maior campeao</span><strong>${escapeHtml(champion ? `${champion.name} ${champion.titles}` : "-")}</strong></article>
      <article><span>Mais partidas</span><strong>${escapeHtml(matches ? `${matches.name} ${matches.totalMatches}` : "-")}</strong></article>
    `;
  }

  function playerCell(player) {
    return `
      <span class="hall-player-cell">
        <img src="${escapeHtml(player.avatar || "/assets/default-avatar.png")}" alt="">
        <strong>${escapeHtml(player.name)}</strong>
      </span>
    `;
  }

  function renderRows() {
    const rows = hall?.[activeTab] || [];
    if (activeTab === "general") {
      head.innerHTML = "<tr><th>#</th><th>Jogador</th><th>Pontos</th><th>Titulos</th><th>Partidas</th><th>V</th><th>E</th><th>D</th><th>Aproveitamento</th></tr>";
      body.innerHTML = rows.map((player, index) => `
        <tr><td>${index + 1}</td><td>${playerCell(player)}</td><td>${player.totalPoints}</td><td>${player.titles}</td><td>${player.totalMatches}</td><td>${player.totalWins}</td><td>${player.totalDraws}</td><td>${player.totalLosses}</td><td>${pct(player.winRate)}</td></tr>
      `).join("") || "<tr><td colspan='9'>Nenhum resultado ranqueado ainda.</td></tr>";
      return;
    }

    if (activeTab === "roundTable") {
      head.innerHTML = "<tr><th>#</th><th>Jogador</th><th>Pontos</th><th>Titulos</th><th>Maior seq.</th><th>Seq. atual</th><th>Vitorias</th><th>Partidas</th></tr>";
      body.innerHTML = rows.map((player, index) => `
        <tr><td>${index + 1}</td><td>${playerCell(player)}</td><td>${player.roundTablePoints}</td><td>${player.roundTableTitles}</td><td>${player.bestStreak}</td><td>${player.currentStreak}</td><td>${player.roundTableWins}</td><td>${player.roundTableMatches}</td></tr>
      `).join("") || "<tr><td colspan='8'>Nenhuma Mesa Redonda ranqueada ainda.</td></tr>";
      return;
    }

    if (activeTab === "tournaments") {
      head.innerHTML = "<tr><th>#</th><th>Jogador</th><th>Titulos</th><th>Top 3</th><th>Pontos</th><th>Torneios</th><th>Vitorias</th></tr>";
      body.innerHTML = rows.map((player, index) => `
        <tr><td>${index + 1}</td><td>${playerCell(player)}</td><td>${player.tournamentTitles}</td><td>${player.tournamentTop3}</td><td>${player.tournamentPoints}</td><td>${player.swissTournamentsPlayed}</td><td>${player.tournamentWins}</td></tr>
      `).join("") || "<tr><td colspan='7'>Nenhum torneio ranqueado ainda.</td></tr>";
      return;
    }

    if (activeTab === "players") {
      head.innerHTML = "<tr><th>Jogador</th><th>Pontos</th><th>Partidas</th><th>Mesa Redonda</th><th>Torneios</th><th>Ultimo jogo</th></tr>";
      body.innerHTML = rows.map(player => `
        <tr><td>${playerCell(player)}</td><td>${player.totalPoints}</td><td>${player.totalMatches}</td><td>${player.roundTablesPlayed}</td><td>${player.tournamentsPlayed}</td><td>${dateLabel(player.lastPlayedAt)}</td></tr>
      `).join("") || "<tr><td colspan='6'>Nenhum jogador no Hall da Fama ainda.</td></tr>";
      return;
    }

    const events = hall?.events || [];
    head.innerHTML = "<tr><th>Evento</th><th>Tipo</th><th>Campeao</th><th>Jogadores</th><th>Data</th><th>Status</th></tr>";
    body.innerHTML = events.map(event => `
      <tr>
        <td>${escapeHtml(event.name)}</td>
        <td>${event.type === "round_table" ? "Mesa Redonda" : "Torneio Suico"}</td>
        <td>${escapeHtml(event.championName || "-")}</td>
        <td>${event.playerCount}</td>
        <td>${dateLabel(event.finishedAt)}</td>
        <td>${event.isRanked ? "ranked" : `unranked: ${escapeHtml(event.reasonUnranked)}`}</td>
      </tr>
    `).join("") || "<tr><td colspan='6'>Nenhum evento registrado ainda.</td></tr>";
  }

  function render() {
    renderSummary();
    renderRows();
    tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.tab === activeTab));
  }

  async function loadHall() {
    const response = await fetch("/api/hall-of-fame");
    hall = await response.json();
    render();
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      activeTab = tab.dataset.tab;
      render();
    });
  });

  refreshBtn?.addEventListener("click", loadHall);
  loadHall().catch(error => {
    body.innerHTML = `<tr><td>Erro ao carregar Hall da Fama: ${escapeHtml(error.message)}</td></tr>`;
  });
})();
