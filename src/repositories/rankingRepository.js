const { safeSupabase } = require("../db/supabase");

function rankingRowFromProfile(profile = {}) {
  const playerId = profile.id || profile.userId || profile.googleId || "";
  if (!playerId) return null;

  return {
    player_id: playerId,
    name: profile.name || "Jogador",
    avatar: profile.avatar || "/assets/default-avatar.png",
    total_points: Number(profile.totalPoints) || 0,
    total_matches: Number(profile.totalMatches) || 0,
    total_wins: Number(profile.totalWins) || 0,
    total_draws: Number(profile.totalDraws) || 0,
    total_losses: Number(profile.totalLosses) || 0,
    win_rate: Number(profile.winRate) || 0,
    titles: Number(profile.titles) || 0,
    runner_ups: Number(profile.runnerUps) || 0,
    participations: Number(profile.tournamentsPlayed || 0) + Number(profile.roundTablesPlayed || 0),
    stats: profile,
    updated_at: new Date().toISOString()
  };
}

async function upsertRankingProfiles(profiles = []) {
  const rows = profiles.map(rankingRowFromProfile).filter(Boolean);
  if (!rows.length) return [];

  return safeSupabase("upsertRankingProfiles", async supabase => {
    const { data, error } = await supabase
      .from("ranking")
      .upsert(rows, { onConflict: "player_id" })
      .select();
    if (error) throw error;
    return data || [];
  }, []);
}

async function listRanking() {
  return safeSupabase("listRanking", async supabase => {
    const { data, error } = await supabase
      .from("ranking")
      .select("*")
      .order("total_points", { ascending: false })
      .order("titles", { ascending: false });
    if (error) throw error;
    return data || [];
  }, []);
}

module.exports = {
  upsertRankingProfiles,
  listRanking
};
