import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DAILY_LIMIT = 94; // Hard cap: leaves free allowance under 100/day.

let client: SupabaseClient | undefined;

function budgetClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    client = undefined;
    return null;
  }
  client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return client;
}

let budgetUnavailable = false;

/**
 * Consume one API-Football request. Returns true when the call is allowed.
 * On any database error the call is denied rather than allowed — we will not
 * guess-risk the user's shared quota.
 */
export async function consumeFootballApiCall(): Promise<boolean> {
  if (budgetUnavailable) return false;
  const supabase = budgetClient();
  if (!supabase) {
    budgetUnavailable = true;
    return false;
  }
  const { data, error } = await supabase.rpc("consume_football_api", {
    p_day: new Date().toISOString().slice(0, 10),
    p_limit: DAILY_LIMIT
  });
  if (error) {
    budgetUnavailable = true;
    console.warn("API-Football quota guard unavailable:", error.message);
    return false;
  }
  return data === true;
}
