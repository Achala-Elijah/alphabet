import { generateAllMarketOdds, type SportsMatch } from "./sports-data";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_LEAGUES = [
  "eng.1", // England Premier League
  "esp.1", // Spain La Liga
  "ita.1", // Italy Serie A
  "ger.1", // Germany Bundesliga
  "fra.1", // France Ligue 1
  "uefa.champions", // UEFA Champions League
  "uefa.europa", // UEFA Europa League
  "usa.1" // Major League Soccer
];

const ESPN_BASE = "https://site.web.api.espn.com/apis/site/v2/sports/soccer";

// Hard-coded TTLs (per product decision — not configurable via env):
// today's fixtures go stale fast, tomorrow's changes slowly.
const DATE_TTL_MS = 16 * 60 * 1000;
const NEXT_TTL_MS = 6 * 60 * 60 * 1000;

let cacheClientInstance: SupabaseClient | null | undefined;

/** Service-role client for the shared football cache (single source of truth). */
function cacheClient(): SupabaseClient | null {
  if (cacheClientInstance) return cacheClientInstance;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Only cache a real client — caching null would disable the cache for
  // the life of the process if env is not ready on the first call.
  if (!url || !serviceKey) return null;
  cacheClientInstance = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return cacheClientInstance;
}

function configuredLeagues() {
  const raw = process.env.FOOTBALL_API_LEAGUES;
  if (!raw) return DEFAULT_LEAGUES;
  const parsed = raw
    .split(",")
    .map((part) => part.trim())
    .filter((code) => code.length > 0);
  return parsed.length ? parsed : DEFAULT_LEAGUES;
}

type EspnEvent = {
  id?: string;
  date?: string;
  competitions?: Array<{
    status?: { clock?: number; type?: { name?: string; state?: string; completed?: boolean; detail?: string } };
    competitors?: Array<{
      homeAway?: string;
      score?: string;
      team?: { displayName?: string; logo?: string };
    }>;
  }>;
};

function espnStatus(event: EspnEvent): { status: string; statusText: string; minute: number | null } {
  const status = event.competitions?.[0]?.status;
  const state = status?.type?.state || "pre";
  const name = (status?.type?.name || "").toUpperCase();
  if (state === "post" || status?.type?.completed) return { status: "finished", statusText: "Full time", minute: 90 };
  if (name.includes("CANCEL") || name.includes("POSTPON")) return { status: "cancelled", statusText: "Cancelled", minute: null };
  if (state === "in") {
    const minute = typeof status?.clock === "number" ? Math.max(1, Math.floor(status.clock / 60)) : null;
    return { status: "live", statusText: "Live", minute };
  }
  return { status: "scheduled", statusText: "Upcoming", minute: null };
}

function espnEventToMatch(event: EspnEvent, leagueName: string): SportsMatch | null {
  const comp = event.competitions?.[0];
  if (!event.id || !comp?.competitors?.length) return null;
  const home = comp.competitors.find((c) => c.homeAway === "home");
  const away = comp.competitors.find((c) => c.homeAway === "away");
  const homeName = home?.team?.displayName?.trim();
  const awayName = away?.team?.displayName?.trim();
  if (!homeName || !awayName) return null;
  const parsed = espnStatus(event);
  const when = event.date && !Number.isNaN(new Date(event.date).getTime()) ? new Date(event.date).toISOString() : new Date().toISOString();
  const score = (value?: string) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const isScheduled = parsed.status === "scheduled";
  const base = {
    home: homeName,
    away: awayName,
    home_logo: home?.team?.logo || null,
    away_logo: away?.team?.logo || null,
    home_score: isScheduled ? null : score(home?.score),
    away_score: isScheduled ? null : score(away?.score),
    status: parsed.status,
    status_text: parsed.statusText,
    time: when,
    slug: `espn-${event.id}`,
    competition: leagueName,
    source: "APIFootball" as const,
    current_minute: parsed.minute
  };
  const marketOdds = generateAllMarketOdds({ ...base, sport: "football" });
  return { ...base, odds: Object.values(marketOdds["1X2"]), market_odds: marketOdds };
}

async function fetchEspnLeagueDate(league: string, date: string): Promise<SportsMatch[]> {
  // ESPN scoreboard dates are YYYYMMDD (no dashes) — YYYY-MM-DD gets a 400.
  const compactDate = date.replaceAll("-", "");
  const response = await fetch(`${ESPN_BASE}/${league}/scoreboard?dates=${compactDate}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      Referer: "https://www.espn.com/"
    },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`ESPN ${league} returned HTTP ${response.status}`);
  const payload = await response.json() as { events?: EspnEvent[]; leagues?: Array<{ name?: string }> };
  const leagueName = payload.leagues?.[0]?.name || league;
  return (payload.events || []).map((event) => espnEventToMatch(event, leagueName)).filter((match): match is SportsMatch => Boolean(match));
}

/**
 * Read-through TTL cache, stored in Supabase (`football_api_cache`):
 *
 *   request → read the cached row
 *     · fresh (expires_at in the future) → serve it, no API call
 *     · expired / missing → fetch from ESPN, then rewrite the row with a
 *       new expiry (the TTL restarts only when someone asks after it lapsed)
 *   · provider error → serve the last data fetched (the expired row for
 *     this key, else the newest row of any key) — the feed never goes
 *     blank when the provider fails.
 *
 * ESPN's public API needs no key and has no quota, so there is no budget
 * counter here — the cache exists purely to keep the feed cheap and fast.
 * Deliberately no process-memory or Next Data Cache layer: neither is
 * shared across instances/deploys, so the database is the single source
 * of truth.
 */
async function cachedFetch(cacheKey: string, league: string, date: string, ttlMs: number): Promise<SportsMatch[]> {
  const db = cacheClient();
  if (!db) return [];

  const { data: row, error: readError } = await db
    .from("football_api_cache")
    .select("data, expires_at")
    .eq("key", cacheKey)
    .maybeSingle();

  if (readError) {
    // Table missing (migration not run) — serve nothing this cycle.
    console.warn("Match cache unavailable:", readError.message);
    return [];
  }

  const stale = row ? (row.data as SportsMatch[]) : [];
  if (row && new Date(row.expires_at).getTime() > Date.now()) return stale;

  try {
    const data = await fetchEspnLeagueDate(league, date);
    const now = new Date();
    const { error: writeError } = await db.from("football_api_cache").upsert({
      key: cacheKey,
      data,
      fetched_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlMs).toISOString()
    });
    if (writeError) console.warn("Match cache write failed:", writeError.message);
    return data;
  } catch (error) {
    // Keep the UI honest by using stale data.
    console.warn("ESPN matches unavailable:", error instanceof Error ? error.message : "unknown error");
    return stale.length ? stale : await lastFetchedData(db);
  }
}

/**
 * The most recently fetched payload of any key, expiry ignored. Used when the
 * daily quota is exhausted (or the provider fails) so users always see the
 * last data we managed to pull — e.g. yesterday's fixtures after the date
 * key rolls over at midnight.
 */
async function lastFetchedData(db: SupabaseClient): Promise<SportsMatch[]> {
  const { data } = await db
    .from("football_api_cache")
    .select("data")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? (data.data as SportsMatch[]) : [];
}

/**
 * Today's fixtures refresh every 16 minutes, tomorrow's every 6 hours —
 * both lazily, only when a request arrives after the TTL has lapsed.
 * ESPN's public API needs no key, so there is no quota to guard.
 */
export async function fetchApiFootballMatches(): Promise<SportsMatch[]> {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const leagues = configuredLeagues();
  // Fetch in small sequential batches — ESPN blocks bursts of parallel
  // scoreboard calls from one IP.
  const jobs: Array<Promise<SportsMatch[]>> = [];
  for (const league of leagues) {
    jobs.push(cachedFetch(`espn:${league}:${today}`, league, today, DATE_TTL_MS));
    jobs.push(cachedFetch(`espn:${league}:${tomorrow}`, league, tomorrow, NEXT_TTL_MS));
  }
  const results: SportsMatch[][] = [];
  for (let i = 0; i < jobs.length; i += 4) {
    results.push(...await Promise.all(jobs.slice(i, i + 4)));
  }
  const seen = new Set<string>();
  return results.flat().filter((match) => {
    if (seen.has(match.slug)) return false;
    seen.add(match.slug);
    return true;
  });
}
