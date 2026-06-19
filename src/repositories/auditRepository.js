const { safeSupabase } = require("../db/supabase");

async function logAudit(action, metadata = {}) {
  return safeSupabase("logAudit", async supabase => {
    const row = {
      actor_id: metadata.actorId || metadata.user?.id || metadata.user?.uid || "",
      actor_name: metadata.actorName || metadata.user?.name || "",
      action,
      entity_type: metadata.entityType || "system",
      entity_id: metadata.entityId || "",
      tournament_id: metadata.tournamentId || "",
      match_id: metadata.matchId || "",
      metadata,
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from("audit_logs").insert(row).select().single();
    if (error) throw error;
    return data;
  }, null);
}

module.exports = {
  logAudit
};
