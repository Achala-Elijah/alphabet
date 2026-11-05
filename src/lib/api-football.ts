import { generateAllMarketOdds, type SportsMatch } from "./sports-data";

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
const DAILY_LIMIT = 98;
const DATE_TTL_MS = 16 * 60 * 1000;
const NEXT_TTL_MS = 6 * 60 * 60 * 1000;

type CacheEntry = { at: number; data: SportsMatch[] };
const cache = new Map<string, CacheEntry>();

let budgetDay = new Date().toISOString().slice(0, 10);
let requestCount = 0;

function resetBudgetIfNewDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== budgetDay) {
    budgetDay = today;
    requestCount = 0;
  }
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
 * Two-layer cache:
 * 1. Next's persistent Data Cache (`fetch next.revalidate` + tags) so repeated
 *    requests across pages and server invocations do not re-hit the provider.
 * 2. A process-local backup for stale-on-error, plus a daily invocation cap.
 * The route is read-only, so cached data is safe to share.
 */
async function cachedFetch(cacheKey: string, requestUrl: string, ttlMs: number): Promise<SportsMatch[]> {
  resetBudgetIfNewDay();
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.at < ttlMs) return cached.data;

  const headers = providerHeaders();
  if (!headers) {
    if (!cache.has(cacheKey)) cache.set(cacheKey, { at: 0, data: [] });
    return cache.get(cacheKey)?.data || [];
  }
  if (requestCount >= DAILY_LIMIT) return cached?.data || [];

  const revalidateSeconds = Math.max(60, Math.floor(ttlMs / 1000));
  try {
    const response = await fetch(requestUrl, {
      headers,
      next: {
        revalidate: revalidateSeconds,
        tags: ["api-football", cacheKey.split(":")[0]]
      }
    });
    requestCount += 1;
    if (!response.ok) throw new Error(`API-Football returned HTTP ${response.status}`);
    const payload = await response.json() as ApiFootballResponse;
    if (payload.errors && Object.keys(payload.errors).length) {
      throw new Error(typeof payload.errors === "string" ? payload.errors : JSON.stringify(payload.errors));
    }
    const data = normalizeAndFilter(Array.isArray(payload.response) ? payload.response : []);
    cache.set(cacheKey, { at: now, data });
    return data;
  } catch (error) {
    // Key details stay server-side; keep the UI honest by using stale data.
    console.warn("API-Football unavailable:", error instanceof Error ? error.message : "unknown error");
    return cached?.data || [];
  }
}

/**
 * One date response every 16 minutes (≈90 calls/day) + next-100 every 6 hours.
 * About 94 calls/day by design, with a hard in-app cap at 98.
 */
export async function fetchApiFootballMatches(): Promise<SportsMatch[]> {
  if (!process.env.API_FOOTBALL_KEY && !process.env.FOOTBALL_API_KEY) return [];
  const dateKey = `date:${new Date().toISOString().slice(0, 10)}`;
  const [today, upcoming] = await Promise.all([
    cachedFetch(dateKey, `${HOST}/fixtures?date=${new Date().toISOString().slice(0, 10)}`, DATE_TTL_MS),
    cachedFetch("next:100", `${HOST}/fixtures?next=100`, NEXT_TTL_MS)
  ]);
  const seen = new Set<string>();
  return [...today, ...upcoming].filter((match) => {
    if (seen.has(match.slug)) return false;
    seen.add(match.slug);
    return true;
  });
}
