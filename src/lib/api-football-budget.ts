import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DAILY_LIMIT = 94; // Hard cap: leaves free allowance under 100/day.

let client: SupabaseClient | undefined;

function budgetClient(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Only cache a real client — never cache a missing-env null.
  if (!url || !serviceKey) return null;
  client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return client;
}

/**
 * Consume one API-Football request. Returns true when the call is allowed.
 * Failures deny only this call — the guard must not stay locked for the
 * life of the process after a single transient error, or the cache can
 * never be populated again.
 */
export async function consumeFootballApiCall(): Promise<boolean> {
  const supabase = budgetClient();
  if (!supabase) return false;

  const { data, error } = await supabase.rpc("consume_football_api", {
    p_day: new Date().toISOString().slice(0, 10),
    p_limit: DAILY_LIMIT
  });
  if (error) {
    console.warn("API-Football quota guard unavailable:", error.message);
    return false;
  }
  return data === true;
}
