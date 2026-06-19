const { safeSupabase } = require("../db/supabase");

function normalizePlayer(player = {}) {
  const id = player.userId || player.uid || player.id || player.email || "";
  if (!id) return null;

  return {
    id,
    google_id: player.userId || player.uid || player.id || id,
    name: player.name || "Jogador",
    email: player.email || "",
    avatar: player.avatar || player.photo || "/assets/default-avatar.png",
    updated_at: new Date().toISOString(),
    metadata: player
  };
}

async function upsertPlayer(player) {
  const row = normalizePlayer(player);
  if (!row) return null;

  return safeSupabase("upsertPlayer", async supabase => {
    const { data, error } = await supabase
      .from("players")
      .upsert(row, { onConflict: "id" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }, null);
}

async function upsertPlayers(players = []) {
  const rows = players.map(normalizePlayer).filter(Boolean);
  if (!rows.length) return [];

  return safeSupabase("upsertPlayers", async supabase => {
    const { data, error } = await supabase
      .from("players")
      .upsert(rows, { onConflict: "id" })
      .select();
    if (error) throw error;
    return data || [];
  }, []);
}

module.exports = {
  upsertPlayer,
  upsertPlayers
};
