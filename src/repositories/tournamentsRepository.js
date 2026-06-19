const { safeSupabase } = require("../db/supabase");
const { upsertPlayers } = require("./playersRepository");

function iso(value) {
  if (!value) return null;
  if (typeof value === "number") return new Date(value).toISOString();
  return new Date(value).toISOString();
}

function getChampionId(tournament = {}) {
  return tournament.champion?.id ||
    tournament.currentChampionId ||
    tournament.standings?.[0]?.id ||
    "";
}

function tournamentRow(tournament = {}) {
  return {
    id: tournament.id,
    type: tournament.type || "swiss",
    name: tournament.name || "Torneio ResenhaON",
    owner_id: tournament.ownerId || "",
    status: tournament.status || "registration_open",
    format: tournament.format || "BO3",
    invite_code: tournament.inviteCode || "",
    max_players: Number(tournament.maxPlayers) || 8,
    rounds_total: Number(tournament.roundsTotal) || 0,
    current_round: Number(tournament.currentRound) || 0,
    current_champion_id: tournament.currentChampionId || "",
    current_match_id: tournament.currentMatchId || "",
    champion_id: tournament.status === "finished" ? getChampionId(tournament) : "",
    is_ranked_requested: tournament.isRankedRequested !== false,
    hall_of_fame_status: tournament.hallOfFameStatus || {},
    state: tournament,
    created_at: iso(tournament.createdAt) || new Date().toISOString(),
    updated_at: iso(tournament.updatedAt) || new Date().toISOString(),
    finished_at: tournament.status === "finished" ? iso(tournament.updatedAt) : null
  };
}

function tournamentPlayerRows(tournament = {}) {
  return (tournament.players || []).map(player => ({
    tournament_id: tournament.id,
    player_id: player.userId || player.id,
    name: player.name || "Jogador",
    email: player.email || "",
    avatar: player.avatar || player.photo || "/assets/default-avatar.png",
    status: player.dropped ? "dropped" : "active",
    points: Number(player.points || player.matchPoints) || 0,
    match_points: Number(player.matchPoints || player.points) || 0,
    wins: Number(player.matchWins || player.wins) || 0,
    draws: Number(player.matchDraws || player.draws) || 0,
    losses: Number(player.matchLosses || player.losses) || 0,
    current_streak: Number(player.currentStreak) || 0,
    best_streak: Number(player.bestStreak) || 0,
    stats: player,
    joined_at: iso(player.joinedAt) || new Date().toISOString(),
    updated_at: new Date().toISOString()
  })).filter(row => row.player_id);
}

function matchRows(tournament = {}) {
  return (tournament.matches || []).map(match => ({
    id: match.id,
    tournament_id: tournament.id,
    room_id: match.roomId || "",
    round_id: match.roundId || "",
    round_number: Number(match.roundNumber) || null,
    table_number: Number(match.tableNumber) || null,
    player1_id: match.player1Id || "",
    player2_id: match.player2Id || "",
    winner_id: match.winnerId || "",
    status: match.status || "pending",
    result: match.result || "",
    player1_game_wins: Number.isFinite(Number(match.player1GameWins)) ? Number(match.player1GameWins) : null,
    player2_game_wins: Number.isFinite(Number(match.player2GameWins)) ? Number(match.player2GameWins) : null,
    result_label: match.resultLabel || "",
    is_draw: match.isDraw === true,
    is_bye: match.isBye === true,
    reported_by: match.reportedBy || "",
    reported_at: iso(match.reportedAt),
    payload: match,
    created_at: iso(match.createdAt) || new Date().toISOString(),
    updated_at: iso(match.updatedAt) || new Date().toISOString()
  })).filter(row => row.id);
}

async function saveTournamentSnapshot(tournament, reason = "snapshot") {
  if (!tournament?.id) return null;

  return safeSupabase("saveTournamentSnapshot", async supabase => {
    const { data, error } = await supabase.from("tournament_snapshots").insert({
      tournament_id: tournament.id,
      status: tournament.status || "",
      reason,
      snapshot: tournament
    }).select().single();
    if (error) throw error;
    return data;
  }, null);
}

async function saveTournament(tournament, reason = "save") {
  if (!tournament?.id) return null;
  await upsertPlayers(tournament.players || []);

  return safeSupabase("saveTournament", async supabase => {
    const { data, error } = await supabase
      .from("tournaments")
      .upsert(tournamentRow(tournament), { onConflict: "id" })
      .select()
      .single();
    if (error) throw error;

    const players = tournamentPlayerRows(tournament);
    if (players.length) {
      const { error: playersError } = await supabase
        .from("tournament_players")
        .upsert(players, { onConflict: "tournament_id,player_id" });
      if (playersError) throw playersError;
    }

    const matches = matchRows(tournament);
    if (matches.length) {
      const { error: matchesError } = await supabase
        .from("matches")
        .upsert(matches, { onConflict: "id" });
      if (matchesError) throw matchesError;
    }

    await saveTournamentSnapshot(tournament, reason);
    return data;
  }, null);
}

async function saveTournamentResult(tournament, match, userId = "") {
  if (!tournament?.id || !match?.id || !match.result) return null;

  return safeSupabase("saveTournamentResult", async supabase => {
    const { data, error } = await supabase.from("tournament_results").insert({
      tournament_id: tournament.id,
      match_id: match.id,
      result: match.result,
      player1_game_wins: match.player1GameWins,
      player2_game_wins: match.player2GameWins,
      winner_id: match.winnerId || "",
      reported_by: userId || match.reportedBy || "",
      payload: match
    }).select().single();
    if (error) throw error;
    return data;
  }, null);
}

async function loadActiveTournamentSnapshot() {
  return safeSupabase("loadActiveTournamentSnapshot", async supabase => {
    const { data, error } = await supabase
      .from("tournaments")
      .select("state")
      .in("status", ["registration_open", "registration_closed", "in_progress"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.state || null;
  }, null);
}

module.exports = {
  saveTournament,
  saveTournamentResult,
  saveTournamentSnapshot,
  loadActiveTournamentSnapshot
};
