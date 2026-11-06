export type SportsMatch = {
  home: string;
  away: string;
  /** Team crest URL from the feed (SportScore / API-Football), when available. */
  home_logo?: string | null;
  away_logo?: string | null;
  home_score: number | null;
  away_score: number | null;
  status: string;
  status_text: string;
  time: string;
  slug: string;
  competition: string;
  source: "SportScore" | "BETKIING" | "AlphaBet" | "APIFootball";
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
  // Some feeds put the useful phrase in status_text and leave status vague
  // (or vice versa), so consider both instead of only the text field.
  const raw = `${statusTextRaw || ""} ${statusRaw || ""}`.trim().toLowerCase();
  if (
    raw.includes("full time") ||
    raw.includes("full-time") ||
    raw.includes("finished") ||
    raw.includes("completed") ||
    raw.includes("ended") ||
    /\bft\b/.test(raw) ||
    raw.includes("after extra time") ||
    /\baet\b/.test(raw)
  ) {
    return { status: "finished", status_text: "Full time" };
  }
  if (
    raw.includes("cancel") ||
    raw.includes("abandon") ||
    raw.includes("postpon") ||
    raw.includes("suspend")
  ) {
    return { status: "cancelled", status_text: "Cancelled" };
  }
  if (
    raw.includes("live") ||
    raw.includes("in play") ||
    raw.includes("in-play") ||
    raw.includes("half") ||
    raw.includes("extra time") ||
    raw.includes("penalt") ||
    raw.includes("shootout") ||
    raw.includes("quarter") ||
    /\bset\s*\d/.test(raw)
  ) {
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
 * True when a match should be shown on the customer site.
 * Finished/cancelled are hidden. A "scheduled" row whose kickoff has
 * already passed is a game that has started/been played — it must never
 * show as "Upcoming", so it is hidden as soon as kickoff is in the past
 * (small grace window for clock skew). A "live" row whose kickoff was
 * many hours ago is a stuck feed entry, so it is hidden too.
 */
export function isShownOnSite(status: string, status_text: string, kickoff?: string | null): boolean {
  const normalized = normalizeStatus(status, status_text).status;
  if (normalized !== "live" && normalized !== "scheduled") return false;
  if (kickoff) {
    const start = new Date(kickoff).getTime();
    if (!Number.isNaN(start)) {
      if (normalized === "scheduled" && Date.now() - start > 15 * 60 * 1000) return false;
      if (normalized === "live" && Date.now() - start > 4 * 60 * 60 * 1000) return false;
    }
  }
  return true;
}

/**
 * Big-match fixtures — the marquee games shown big on the homepage.
 * These are curated so the featured slider always shows the top leagues.
 * When a real odds/fixture provider is connected, these keywords match
 * against the feed's competition names.
 */
export const BIG_COMPETITIONS = [
  "premier league",
  "la liga",
  "serie a",
  "bundesliga",
  "ligue 1",
  "champions league",
  "europa league",
  "mls",
  "eredivisie",
  "liga mx",
  "nba",
  "atp",
  "wta",
  "wtt champions"
];

/** Score a match's "bigness" — big teams + big competitions rank highest. */
export function isBigMatch(match: { competition?: string; home?: string; away?: string }): boolean {
  const text = `${match.competition || ""} ${match.home || ""} ${match.away || ""}`.toLowerCase();
  return BIG_COMPETITIONS.some((keyword) => text.includes(keyword));
}

/**
 * Sort matches so manually created fixtures (AlphaBet / BETKIING) always
 * come first — staff-fixed matches are promoted above feed matches — then
 * big fixtures (then soonest kickoff). Live matches rank ahead of
 * scheduled ones within each group.
 */
export function sortByBigness<T extends { competition?: string; home?: string; away?: string; status?: string; status_text?: string; time?: string; source?: string }>(matches: T[]): T[] {
  const manualRank = (match: T) => (match.source === "AlphaBet" || match.source === "BETKIING" ? 0 : 1);
  return [...matches].sort((a, b) => {
    const manualDiff = manualRank(a) - manualRank(b);
    if (manualDiff !== 0) return manualDiff;
    const aLive = isLiveMatch(a.status || "", a.status_text || "") ? 0 : 1;
    const bLive = isLiveMatch(b.status || "", b.status_text || "") ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    const aBig = isBigMatch(a) ? 0 : 1;
    const bBig = isBigMatch(b) ? 0 : 1;
    if (aBig !== bBig) return aBig - bBig;
    return new Date(a.time || 0).getTime() - new Date(b.time || 0).getTime();
  });
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

/** Correct-score prices never go under 7.00 (including staff-entered odds). */
function floorCorrectScoreOdds(source: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [option, value] of Object.entries(source)) {
    const parsed = Number(value);
    out[option] = (Number.isFinite(parsed) ? Math.max(7, parsed) : 7).toFixed(2);
  }
  return out;
}

export function generateMarketOdds(input: MarketOddsInput, market: string): Record<string, string> {
  // Honour a manually-entered market map if one was saved.
  if (input.stored_market_odds?.[market]) {
    const stored = input.stored_market_odds[market];
    return market === "Correct Score" ? floorCorrectScoreOdds(stored) : stored;
  }

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
  else if (market === "Correct Score") {
    // Home 0–4 x away 0–4 = 25 exact scorelines, the detailed market real
    // betting apps offer (e.g. "2-1"), plus "any other" buckets for the
    // scorelines outside that grid.
    options = [];
    for (let h = 0; h <= 4; h++) for (let a = 0; a <= 4; a++) options.push(`${h}-${a}`);
    options.push("Any other home win", "Any other draw", "Any other away win");
  }
  else options = ["1", "X", "2"];

  const result: Record<string, string> = {};
  options.forEach((option, index) => {
    // Base implied probability varies by option position and market.
    let prob = 0.28 + rand(index) * 0.22;
    if (market === "O/U" || market === "Totals" || market === "Total Games" || market === "Total Sets") {
      prob = 0.5 + (rand(index) - 0.5) * 0.2;
    } else if (market === "Correct Score") {
      // Exact scorelines are long shots — low scores are the likeliest,
      // so price them off a crude Poisson shape (~2.6 total goals) the way
      // real correct-score markets do: 1-0/1-1/2-1 short, 4-4 very long.
      const m = option.match(/^(\d)-(\d)$/);
      if (m) {
        const total = Number(m[1]) + Number(m[2]);
        const lambda = 2.6;
        let fact = 1;
        for (let i = 2; i <= total; i++) fact *= i;
        prob = (Math.exp(-lambda) * lambda ** total) / fact;
        prob = prob * (1 + rand(index) * 0.35);
        // Home wins lean the scoreline grid one way, away wins the other.
        if (Number(m[1]) > Number(m[2])) prob *= 1 + homeEdge;
        if (Number(m[1]) < Number(m[2])) prob *= 1 - homeEdge;
      } else {
        // "Any other" buckets collect every scoreline outside 0–4.
        prob = 0.02 + rand(index) * 0.015;
      }
    } else if (market === "1X2") {
      if (option === "1") prob += homeEdge;
      if (option === "X") prob -= 0.08;
      if (option === "2") prob -= homeEdge;
    }
    // Live drift: a leading home side shortens, a trailing one lengthens.
    if (option === "1" || option === "Home" || option === "Player 1") prob *= drift;
    if (option === "2" || option === "Away" || option === "Player 2") prob /= drift;
    if (market === "Correct Score" && input.home_score != null && input.away_score != null) {
      // In play, the scoreline on the board shortens hard and every other
      // score lengthens — the live correct-score board bettors know.
      const live = `${input.home_score}-${input.away_score}`;
      prob = option === live ? prob * (1 + drift) : prob / (1 + drift * 0.75);
    }

    result[option] = market === "Correct Score"
      ? Math.max(7, Number(toOdds(prob))).toFixed(2)
      : toOdds(prob);
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
  // Correct score is a football-only market — scorelines don't apply to
  // tennis/basketball the way they do to a 90-minute football match.
  if ((input.sport || "football") === "football") markets.push("Correct Score");
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
