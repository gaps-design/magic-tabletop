const { createClient } = require("@supabase/supabase-js");

let client = null;
let warned = false;

function hasSupabaseConfig() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabaseClient() {
  if (!hasSupabaseConfig()) {
    if (!warned) {
      console.warn("[SUPABASE] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured. Persistence fallback is active.");
      warned = true;
    }
    return null;
  }

  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  return client;
}

async function safeSupabase(label, operation, fallback = null) {
  const supabase = getSupabaseClient();
  if (!supabase) return fallback;

  try {
    return await operation(supabase);
  } catch (error) {
    console.error(`[SUPABASE] ${label} failed:`, error.message);
    return fallback;
  }
}

module.exports = {
  getSupabaseClient,
  hasSupabaseConfig,
  safeSupabase
};
