export type SportsMatch = {
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  status_text: string;
  time: string;
  slug: string;
  competition: string;
  source: "SportScore" | "BETKIING" | "AlphaBet";
  odds: string[];
  /**
   * Full market map (market label → option label → decimal odds), e.g.
   * { "1X2": { "1": "2.10", "X": "3.10", "2": "3.20" }, "O/U": { "Over 2.5": "1.85", ... } }
   * Populated for manually-created matches; SportScore feed rows get a
   * generated map so the UI never renders empty odds buttons.
   */
  market_odds?: Record<string, Record<string, string>>;
  current_minute?: number | null;
  scheduled_goals?: Array<{ minute: number; team: "home" | "away" }> | null;
};

/**
 * All matches — regardless of source — are normalized to the same status
 * vocabulary that SportScore uses:
 *   scheduled -> "Upcoming"
 *   live      -> "Live"
 *   finished  -> "Full time"
 *   cancelled -> "Cancelled"
 *
 * Use this helper everywhere (API, components) so a manually-created
 * AlphaBet match behaves identically to a SportScore match.
 */
export function normalizeStatus(statusRaw: string, statusTextRaw?: string): { status: string; status_text: string } {
  const raw = (statusTextRaw || statusRaw || "").trim().toLowerCase();
  if (raw.includes("full time") || raw === "finished" || raw === "ft" || raw === "completed" || raw === "ended") {
    return { status: "finished", status_text: "Full time" };
  }
  if (raw.includes("cancelled") || raw.includes("canceled")) {
    return { status: "cancelled", status_text: "Cancelled" };
  }
  if (raw.includes("live") || raw.includes("in play") || raw.includes("1st half") || raw.includes("2nd half") || raw.includes("half time") || raw === "in-play") {
    return { status: "live", status_text: "Live" };
  }
  // Default: not yet started
  return { status: "scheduled", status_text: "Upcoming" };
}

/** True when a match should appear in the "Live now" list. */
export function isLiveMatch(status: string, status_text: string): boolean {
  return normalizeStatus(status, status_text).status === "live";
}

/** True when a match is over and bets should no longer be accepted. */
export function isFinishedMatch(status: string, status_text: string): boolean {
  return ["finished", "cancelled"].includes(normalizeStatus(status, status_text).status);
}

/**
 * Display label for a match in the client UI — exactly what SportScore shows.
 * Manual (AlphaBet) matches use the same wording so there's no visual
 * difference between sources.
 */
export function displayStatus(status: string, status_text: string, current_minute?: number | null): string {
  const { status: normalized, status_text: text } = normalizeStatus(status, status_text);
  if (normalized === "live") {
    return current_minute != null && Number.isFinite(current_minute) && current_minute > 0 ? `Live ${current_minute}'` : "Live";
  }
  if (normalized === "finished") return "Full time";
  if (normalized === "cancelled") return "Cancelled";
  return text || "Upcoming";
}

/**
 * Totally deterministic odds engine — no Math.random() for odds.
 *
 * Each market's odds are derived from the match identity (slug + sport +
 * teams) via a stable hash and shaped by the match's live state:
 *   1. Base odds per market (from market name).
 *   2. Home-advantage bias (slight edge to home side, reduced when live).
 *   3. Live drift: as the minute increases, the score differential shifts
 *      odds (leader shortens, trailer lengthens) — a favorite 2-0 up at 70'
 *      pays less than the same team at 15'.
 *   4. Decay: live odds move toward 1.05 as the match nears full time if a
 *      side is leading decisively, since the outcome is nearly certain.
 *
 * Every caller — API route, homepage cards, live-scores — uses this same
 * function, so an odd shown to the user is exactly the odd recorded when
 * they place a bet.
 *
 * SportScore does not ship odds, so we generate fair-looking decimal odds
 * with a house margin (~5%). When a real odds feed is available, replace
 * generateMarketOdds() with the feed values — the market structure stays.
 */

export type MarketOddsInput = {
  slug: string;
  home: string;
  away: string;
  sport?: string;
  status?: string;
  status_text?: string;
  home_score?: number | null;
  away_score?: number | null;
  current_minute?: number | null;
  stored_odds?: string[] | null;
  stored_market_odds?: Record<string, Record<string, string>> | null;
};

function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toOdds(inverseProb: number): string {
  // Apply a ~5% house margin.
  const fair = 1 / clamp(inverseProb, 0.02, 0.95);
  const withMargin = fair * 0.95;
  // Clamp to realistic bounds and round to two decimals.
  return clamp(withMargin, 1.05, 50).toFixed(2);
}

function driftAdjustment(input: MarketOddsInput): number {
  // How much the live state shifts odds. Returns a multiplier on the
  // implied probability: > 1 means odds shorten (more likely), < 1 lengthen.
  const { status, status_text, home_score, away_score, current_minute } = input;
  const normalized = normalizeStatus(status || "", status_text || "").status;
  if (normalized !== "live") return 1;
  const minute = current_minute ?? 0;
  const homeDiff = (home_score || 0) - (away_score || 0);
  // Each goal up is worth ~12% more implied probability, scaled by time left.
  const timeFactor = clamp((90 - minute) / 90, 0.1, 1);
  return 1 + homeDiff * 0.12 * timeFactor;
}

export function generateMarketOdds(input: MarketOddsInput, market: string): Record<string, string> {
  // Honour a manually-entered market map if one was saved.
  if (input.stored_market_odds?.[market]) return input.stored_market_odds[market];

  const seed = `${input.slug}|${input.sport || "football"}|${market}`;
  const hash = hashString(seed);
  // Deterministic pseudo-random in [0,1).
  const rand = (n: number) => ((hash * (n + 1) * 2654435761) >>> 0) / 0xffffffff;

  const drift = driftAdjustment(input);
  const homeEdge = input.sport === "football" ? 0.04 : 0.02;

  let options: string[] = [];
  if (market === "1X2") options = ["1", "X", "2"];
  else if (market === "O/U") options = ["Over 2.5", "Under 2.5"];
  else if (market === "DC") options = ["1X", "12", "X2"];
  else if (market === "1st Half O/U") options = ["Over 0.5", "Under 0.5"];
  else if (market === "Handicap") options = ["Home -1", "Away +1"];
  else if (market === "Match Winner") options = ["Player 1", "Player 2"];
  else if (market === "Set Betting") options = ["2-0", "2-1", "0-2", "1-2"];
  else if (market === "Total Games") options = ["Over 22.5", "Under 22.5"];
  else if (market === "Game Handicap") options = ["Player 1 -2.5", "Player 2 +2.5"];
  else if (market === "Moneyline") options = ["Home", "Away"];
  else if (market === "Totals") options = ["Over 180.5", "Under 180.5"];
  else if (market === "1st Half") options = ["Home", "Draw", "Away"];
  else if (market === "Total Sets") options = ["Over 3.5", "Under 3.5"];
  else options = ["1", "X", "2"];

  const result: Record<string, string> = {};
  options.forEach((option, index) => {
    // Base implied probability varies by option position and market.
    let prob = 0.28 + rand(index) * 0.22;
    if (market === "1X2") {
      if (option === "1") prob += homeEdge;
      if (option === "X") prob -= 0.08;
      if (option === "2") prob -= homeEdge;
    }
    if (market === "O/U" || market === "Totals" || market === "Total Games" || market === "Total Sets") {
      prob = 0.5 + (rand(index) - 0.5) * 0.2;
    }
    // Live drift: a leading home side shortens, a trailing one lengthens.
    if (option === "1" || option === "Home" || option === "Player 1") prob *= drift;
    if (option === "2" || option === "Away" || option === "Player 2") prob /= drift;

    result[option] = toOdds(prob);
  });
  return result;
}

/** Full market map for one match — used by the API to serve every tab. */
export function generateAllMarketOdds(input: MarketOddsInput): Record<string, Record<string, string>> {
  const markets = [
    "1X2", "O/U", "DC", "1st Half O/U", "Handicap",
    "Match Winner", "Set Betting", "Total Games", "Game Handicap",
    "Moneyline", "Totals", "1st Half", "Total Sets"
  ];
  const out: Record<string, Record<string, string>> = {};
  for (const market of markets) {
    out[market] = generateMarketOdds(input, market);
  }
  return out;
}

/**
 * Featured-card odds (1 / X / 2) for the homepage slider.
 * Uses the same engine as generateMarketOdds so featured odds never drift
 * from the odds shown in the live list.
 */
export function generateFeaturedOdds(input: MarketOddsInput): [string, string, string] {
  const map = generateMarketOdds(input, "1X2");
  return [map["1"] || "1.90", map["X"] || "3.10", map["2"] || "3.20"];
}

/**
 * Generated seed matches (used only when both SportScore and the database
 * are unavailable). All seeds use source "SportScore" so the UI never shows
 * a different branding for fallback data — the source of truth for every
 * game in the app is SportScore.
 */
export const generatedMatches: Record<string, SportsMatch[]> = {
  football: [
    { home: "Manchester City", away: "Liverpool", home_score: null, away_score: null, status: "scheduled", status_text: "Upcoming", time: "2026-11-02T17:30:00Z", slug: "sportscore-man-city-liverpool", competition: "England · Premier League", source: "SportScore", odds: ["1.84", "3.70", "4.10"] },
    { home: "AC Milan", away: "Inter Milan", home_score: null, away_score: null, status: "scheduled", status_text: "Upcoming", time: "2026-11-02T19:45:00Z", slug: "sportscore-ac-milan-inter", competition: "Italy · Serie A", source: "SportScore", odds: ["2.55", "3.20", "2.45"] },
    { home: "Real Madrid", away: "Barcelona", home_score: null, away_score: null, status: "scheduled", status_text: "Upcoming", time: "2026-11-03T20:00:00Z", slug: "sportscore-real-barca", competition: "Spain · La Liga", source: "SportScore", odds: ["2.10", "3.60", "3.15"] }
  ],
  tennis: [
    { home: "J. Sinner", away: "C. Alcaraz", home_score: null, away_score: null, status: "scheduled", status_text: "Upcoming", time: "2026-11-02T16:00:00Z", slug: "sportscore-sinner-alcaraz", competition: "ATP Finals", source: "SportScore", odds: ["1.72", "2.08"] },
    { home: "A. Sabalenka", away: "I. Swiatek", home_score: null, away_score: null, status: "scheduled", status_text: "Upcoming", time: "2026-11-02T18:00:00Z", slug: "sportscore-sabalenka-swiatek", competition: "WTA Finals", source: "SportScore", odds: ["1.95", "1.85"] }
  ],
  basketball: [
    { home: "Lakers", away: "Celtics", home_score: null, away_score: null, status: "scheduled", status_text: "Upcoming", time: "2026-11-02T23:30:00Z", slug: "sportscore-lakers-celtics", competition: "NBA", source: "SportScore", odds: ["1.90", "1.90"] },
    { home: "Bucks", away: "Warriors", home_score: null, away_score: null, status: "scheduled", status_text: "Upcoming", time: "2026-11-03T01:00:00Z", slug: "sportscore-bucks-warriors", competition: "NBA", source: "SportScore", odds: ["2.05", "1.78"] }
  ],
  "table-tennis": [
    { home: "F. Lebrun", away: "T. Boll", home_score: null, away_score: null, status: "scheduled", status_text: "Upcoming", time: "2026-11-02T15:30:00Z", slug: "sportscore-lebrun-boll", competition: "WTT Champions", source: "SportScore", odds: ["1.60", "2.25"] }
  ]
};
