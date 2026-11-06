import { generateAllMarketOdds, type SportsMatch } from "./sports-data";
import { consumeFootballApiCall } from "./api-football-budget";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ApiFootballFixture = {
  fixture?: {
    id?: number;
    date?: string;
    status?: { short?: string; long?: string; elapsed?: number | null };
  };
  league?: { id?: number; name?: string; country?: string };
  teams?: {
    home?: { id?: number; name?: string };
    away?: { id?: number; name?: string };
  };
  goals?: { home?: number | null; away?: number | null };
};

type ApiFootballResponse = {
  response?: ApiFootballFixture[];
  errors?: Record<string, string> | string[] | null;
};

const DEFAULT_LEAGUES = [
  39, // England Premier League
  140, // Spain La Liga
  135, // Italy Serie A
  78, // Germany Bundesliga
  61, // France Ligue 1
  2, // UEFA Champions League
  3, // UEFA Europa League
  253, // Major League Soccer
  88, // Eredivisie
  94, // Primeira Liga
  203, // Süper Lig
  71 // Brazil Serie A
];

const DEFAULT_HOST = "https://v3.football.api-sports.io";
// Hard-coded TTLs (per product decision — not configurable via env):
// today's fixtures go stale fast, next-100 changes slowly.
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
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
  return parsed.length ? parsed : DEFAULT_LEAGUES;
}

const LEAGUE_IDS = new Set(configuredLeagues());
const HOST = (process.env.FOOTBALL_API_HOST || DEFAULT_HOST).replace(/\/+$/, "");

function providerHeaders(): Record<string, string> | null {
  const key = process.env.API_FOOTBALL_KEY || process.env.FOOTBALL_API_KEY;
  if (!key) return null;
  if (/rapidapi\.com/i.test(HOST)) {
    return {
      Accept: "application/json",
      "x-rapidapi-key": key,
      "x-rapidapi-host": HOST.replace(/^https?:\/\//, "")
    };
  }
  return { Accept: "application/json", "x-apisports-key": key };
}

function parseStatus(fixture: ApiFootballFixture) {
  const short = (fixture.fixture?.status?.short || "NS").toUpperCase();
  const long = (fixture.fixture?.status?.long || "").toLowerCase();
  if (["PST", "CANC", "ABD", "AWD", "WO"].includes(short) || /postpon|cancel|abandon|awarded|walk/.test(long)) {
    return { status: "cancelled", statusText: "Cancelled" };
  }
  if (["FT", "AET", "PEN"].includes(short) || /full.?time|after full|penalties/.test(long)) {
    return { status: "finished", statusText: "Full time" };
  }
  if (["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"].includes(short) || /live|half|in.?play|extra|break|suspended|interrupt/.test(long)) {
    return { status: "live", statusText: "Live" };
  }
  return { status: "scheduled", statusText: "Upcoming" };
}

function scoreValue(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toAllCapsMinute(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

function fixtureToMatch(fixture: ApiFootballFixture): SportsMatch | null {
  const id = fixture.fixture?.id;
  const home = fixture.teams?.home?.name?.trim();
  const away = fixture.teams?.away?.name?.trim();
  if (!id || !home || !away) return null;
  const leagueName = fixture.league?.name || "Football";
  const competition = fixture.league?.country ? `${fixture.league.country} · ${leagueName}` : leagueName;
  const when = fixture.fixture?.date;
  const kickoff = when && !Number.isNaN(new Date(when).getTime()) ? new Date(when).toISOString() : new Date().toISOString();
  const resolved = parseStatus(fixture);
  const isScheduled = resolved.status === "scheduled";
  const base = {
    home,
    away,
    home_score: isScheduled ? null : scoreValue(fixture.goals?.home),
    away_score: isScheduled ? null : scoreValue(fixture.goals?.away),
    status: resolved.status,
    status_text: resolved.statusText,
    time: kickoff,
    slug: `apifootball-${id}`,
    competition,
    source: "APIFootball" as const,
    current_minute: resolved.status === "live" ? toAllCapsMinute(fixture.fixture?.status?.elapsed) : resolved.status === "finished" ? 90 : null
  };
  const marketOdds = generateAllMarketOdds({ ...base, sport: "football" });
  return { ...base, odds: Object.values(marketOdds["1X2"]), market_odds: marketOdds };
}

function normalizeAndFilter(fixtures: ApiFootballFixture[]) {
  return fixtures
    .filter((fixture) => LEAGUE_IDS.has(fixture.league?.id || 0))
    .map(fixtureToMatch)
    .filter((match): match is SportsMatch => Boolean(match));
}

/**
 * Read-through TTL cache, stored in Supabase (`football_api_cache`):
 *
 *   request → read the cached row
 *     · fresh (expires_at in the future) → serve it, no API call, no quota
 *     · expired / missing → consume one unit of the shared daily quota,
 *       fetch from API-Football, then rewrite the row with a new expiry
 *       (the TTL restarts only when someone asks after it lapsed)
 *   · quota exhausted / provider error → serve the last data fetched (the
 *     expired row for this key, else the newest row of any key) — the feed
 *     never goes blank when the daily limit runs out
 *   · cache unreadable → deny the call, never risk the shared quota.
 *
 * Deliberately no process-memory or Next Data Cache layer: neither is shared
 * across instances/deploys, so the database is the single source of truth.
 */
async function cachedFetch(cacheKey: string, requestUrl: string, ttlMs: number): Promise<SportsMatch[]> {
  const db = cacheClient();
  if (!db) return [];

  const { data: row, error: readError } = await db
    .from("football_api_cache")
    .select("data, expires_at")
    .eq("key", cacheKey)
    .maybeSingle();

  if (readError) {
    // Table missing (migration not run) — do not burn quota on an uncached path.
    console.warn("API-Football cache unavailable:", readError.message);
    return [];
  }

  const stale = row ? (row.data as SportsMatch[]) : [];
  if (row && new Date(row.expires_at).getTime() > Date.now()) return stale;

  const headers = providerHeaders();
  if (!headers) return stale;
  // Hard shared quota across every process and user. When it is exhausted (or
  // the guard is unavailable) we never go to the provider — the last data we
  // fetched is served instead, so the feed never goes blank on a zero-balance
  // day.
  if (!(await consumeFootballApiCall())) return stale.length ? stale : await lastFetchedData(db);

  try {
    const response = await fetch(requestUrl, { headers, cache: "no-store" });
    if (!response.ok) throw new Error(`API-Football returned HTTP ${response.status}`);
    const payload = await response.json() as ApiFootballResponse;
    if (payload.errors && Object.keys(payload.errors).length) {
      throw new Error(typeof payload.errors === "string" ? payload.errors : JSON.stringify(payload.errors));
    }
    const data = normalizeAndFilter(Array.isArray(payload.response) ? payload.response : []);
    const now = new Date();
    const { error: writeError } = await db.from("football_api_cache").upsert({
      key: cacheKey,
      data,
      fetched_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlMs).toISOString()
    });
    if (writeError) console.warn("API-Football cache write failed:", writeError.message);
    return data;
  } catch (error) {
    // Key details stay server-side; keep the UI honest by using stale data.
    console.warn("API-Football unavailable:", error instanceof Error ? error.message : "unknown error");
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
 * Today's fixtures refresh every 16 minutes, next-100 every 6 hours — both
 * lazily, only when a request arrives after the TTL has lapsed. That keeps
 * usage inside the shared 94-calls/day database cap.
 */
export async function fetchApiFootballMatches(): Promise<SportsMatch[]> {
  if (!process.env.API_FOOTBALL_KEY && !process.env.FOOTBALL_API_KEY) return [];
  const today = new Date().toISOString().slice(0, 10);
  // NOTE: the free API-Football plan rejects ?next=100 ("Free plans do not
  // have access to the Next parameter"), so upcoming fixtures are fetched
  // by tomorrow's date instead — a permanently failing fetch would retry
  // on every request and burn the daily quota without ever caching.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [todayMatches, tomorrowMatches] = await Promise.all([
    cachedFetch(`date:${today}`, `${HOST}/fixtures?date=${today}`, DATE_TTL_MS),
    cachedFetch(`date:${tomorrow}`, `${HOST}/fixtures?date=${tomorrow}`, NEXT_TTL_MS)
  ]);
  const seen = new Set<string>();
  return [...todayMatches, ...tomorrowMatches].filter((match) => {
    if (seen.has(match.slug)) return false;
    seen.add(match.slug);
    return true;
  });
}
