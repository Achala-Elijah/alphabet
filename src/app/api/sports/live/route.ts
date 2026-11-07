import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generatedMatches, normalizeStatus, isLiveMatch, isFinishedMatch, isShownOnSite, sortByBigness, generateAllMarketOdds, generateFeaturedOdds, type SportsMatch } from "@/lib/sports-data";
import { fetchApiFootballMatches } from "@/lib/api-football";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { settleOpenBets, FULL_TIME_MINUTE } from "@/lib/bets/settlement";
import { rememberFixtures } from "@/lib/live-feed-cache";

export const revalidate = 60;

const SUPPORTED_SPORTS = new Set(["football", "tennis", "basketball", "table-tennis"]);
const runtimeScheduledGoals = new Map<string, Array<{ minute: number; team: "home" | "away" }>>();

/**
 * matches has no INSERT policy for sub-admins (only admins can manage
 * matches), so a sub-admin create must go through the service-role client,
 * which bypasses RLS. Admins keep using their session client.
 */
function writerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Match creation is not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env and restart Next.js.");
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
type MatchOdds = string[] | { values: string[]; scheduled_goals: Array<{ minute: number; team: "home" | "away" }> };

function getOddsValues(odds: MatchOdds | null): string[] {
  return Array.isArray(odds) ? odds : odds?.values || ["1.90", "3.20", "2.10"];
}

function getScheduledGoals(odds: MatchOdds | null): Array<{ minute: number; team: "home" | "away" }> {
  return Array.isArray(odds) ? [] : odds?.scheduled_goals || [];
}

type SportScoreMatch = {
  home?: string;
  away?: string;
  home_logo?: string;
  away_logo?: string;
  home_score?: number | null;
  away_score?: number | null;
  status?: string;
  status_text?: string;
  time?: string;
  slug?: string;
  competition?: string;
};

function normalizeMatch(match: SportScoreMatch, sport: string): SportsMatch {
  // Every match — SportScore or manually created — goes through the same
  // status normalizer so the UI always sees the same vocabulary.
  const { status, status_text } = normalizeStatus(match.status || "", match.status_text || "");
  const slug = match.slug || `${sport}-${match.home}-${match.away}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const base = {
    home: match.home || "Home team",
    away: match.away || "Away team",
    home_logo: match.home_logo || null,
    away_logo: match.away_logo || null,
    home_score: typeof match.home_score === "number" ? match.home_score : null,
    away_score: typeof match.away_score === "number" ? match.away_score : null,
    status,
    status_text,
    time: match.time || new Date().toISOString(),
    slug,
    competition: match.competition || sport,
    source: "SportScore" as const,
    current_minute: null
  };
  // Odds are generated deterministically from the match identity + live
  // state by generateAllMarketOdds, so every surface shows the same prices.
  const marketOdds = generateAllMarketOdds({ ...base, sport });
  return {
    ...base,
    odds: Object.values(marketOdds["1X2"]),
    market_odds: marketOdds
  };
}

function normalizeDatabaseMatch(match: {
  id: string;
  sport: string;
  competition: string;
  home: string;
  away: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  kickoff: string;
  source: "SportScore" | "BETKIING" | "AlphaBet";
  odds: MatchOdds | null;
  current_minute?: number | null;
  scheduled_goals?: Array<{ minute: number; team: "home" | "away" }> | null;
}): SportsMatch {
  const scheduledGoals = match.scheduled_goals || getScheduledGoals(match.odds);
  // Manual-match crests ride along in the odds JSONB (no schema change):
  // odds = { values, scheduled_goals, logos: { home, away } }
  const storedLogos = (!Array.isArray(match.odds) ? (match.odds as { logos?: { home?: string; away?: string } } | null)?.logos : undefined);
  const homeLogo = storedLogos?.home || null;
  const awayLogo = storedLogos?.away || null;
  const kickoffMs = new Date(match.kickoff).getTime();
  const nowMs = Date.now();
  const isStarted = !Number.isNaN(kickoffMs) && nowMs >= kickoffMs;
  const elapsed = isStarted ? Math.floor((nowMs - kickoffMs) / 60000) : -1;
  const isOver =
    match.status === "finished" ||
    match.status === "cancelled" ||
    Number(match.current_minute || 0) >= FULL_TIME_MINUTE ||
    (isStarted && elapsed >= FULL_TIME_MINUTE);

  if (isOver) {
    const goals = scheduledGoals.filter((goal) => goal.minute <= FULL_TIME_MINUTE);
    const finalMinute = Math.max(Number(match.current_minute || 0), FULL_TIME_MINUTE);
    const homeScore = (match.home_score || 0) + goals.filter((goal) => goal.team === "home").length;
    const awayScore = (match.away_score || 0) + goals.filter((goal) => goal.team === "away").length;
    const base = {
      home: match.home,
      away: match.away,
      home_logo: homeLogo,
      away_logo: awayLogo,
      home_score: homeScore,
      away_score: awayScore,
      status: match.status === "cancelled" ? "cancelled" : "finished",
      status_text: match.status === "cancelled" ? "Cancelled" : "Full time",
      time: match.kickoff,
      slug: match.id,
      competition: match.competition,
      source: match.source,
      current_minute: finalMinute,
      scheduled_goals: scheduledGoals
    };
    const storedOdds = getOddsValues(match.odds) as string[] | null;
    const storedMarketOdds = (Array.isArray(match.odds) ? null : (match.odds as { market_odds?: Record<string, Record<string, string>> } | null)?.market_odds) || null;
    const marketOdds = generateAllMarketOdds({ ...base, sport: match.sport, stored_odds: storedOdds, stored_market_odds: storedMarketOdds });
    return {
      ...base,
      odds: Object.values(marketOdds["1X2"]),
      market_odds: marketOdds
    };
  }

  // Not due yet (kickoff is in the future) — respect the DB status so a
  // manually "started" match shows as live even before kickoff time.
  if (!isStarted) {
    const { status, status_text } = normalizeStatus(match.status);
    // DB explicitly says live even though clock hasn't hit kickoff yet.
    if (status === "live") {
      const base = {
        home: match.home,
        away: match.away,
        home_logo: homeLogo,
        away_logo: awayLogo,
        home_score: match.home_score || 0,
        away_score: match.away_score || 0,
        status: "live",
        status_text: "Live",
        time: match.kickoff,
        slug: match.id,
        competition: match.competition,
        source: match.source,
        current_minute: Math.max(Number(match.current_minute || 0), 1),
        scheduled_goals: scheduledGoals
      };
      const storedOdds = getOddsValues(match.odds) as string[] | null;
      const marketOdds = generateAllMarketOdds({ ...base, sport: match.sport, stored_odds: storedOdds });
      return { ...base, odds: Object.values(marketOdds["1X2"]), market_odds: marketOdds };
    }
    const scheduledBase = {
      home: match.home,
      away: match.away,
      home_logo: homeLogo,
      away_logo: awayLogo,
      home_score: null,
      away_score: null,
      status: "scheduled",
      status_text: "Upcoming",
      time: match.kickoff,
      slug: match.id,
      competition: match.competition,
      source: match.source,
      current_minute: 0,
      scheduled_goals: scheduledGoals
    };
    const storedOdds = getOddsValues(match.odds) as string[] | null;
    const marketOdds = generateAllMarketOdds({ ...scheduledBase, sport: match.sport, stored_odds: storedOdds });
    return { ...scheduledBase, odds: Object.values(marketOdds["1X2"]), market_odds: marketOdds };
  }

  // Match is due, kicked off, and not over yet -> live
  const currentMinute = Math.max(Number(match.current_minute || 0), Math.min(Math.max(elapsed, 1), FULL_TIME_MINUTE - 1));
  const goals = scheduledGoals.filter((goal) => goal.minute <= currentMinute);
  const homeScore = (match.home_score || 0) + goals.filter((goal) => goal.team === "home").length;
  const awayScore = (match.away_score || 0) + goals.filter((goal) => goal.team === "away").length;
  const liveBase = {
    home: match.home,
    away: match.away,
    home_logo: homeLogo,
    away_logo: awayLogo,
    home_score: homeScore,
    away_score: awayScore,
    status: "live",
    status_text: "Live",
    time: match.kickoff,
    slug: match.id,
    competition: match.competition,
    source: match.source,
    current_minute: currentMinute,
    scheduled_goals: scheduledGoals
  };
  const storedOdds = getOddsValues(match.odds) as string[] | null;
  const marketOdds = generateAllMarketOdds({ ...liveBase, sport: match.sport, stored_odds: storedOdds });
  return { ...liveBase, odds: Object.values(marketOdds["1X2"]), market_odds: marketOdds };
}

function normalizeFallbackMatch(match: SportsMatch): SportsMatch {
  const kickoffMs = new Date(match.time).getTime();
  const nowMs = Date.now();
  const withOdds = (base: SportsMatch): SportsMatch => {
    const marketOdds = generateAllMarketOdds({ ...base, sport: "football" });
    return { ...base, odds: Object.values(marketOdds["1X2"]), market_odds: marketOdds };
  };
  if (Number.isNaN(kickoffMs)) {
    const { status, status_text } = normalizeStatus(match.status, match.status_text);
    return withOdds({ ...match, status, status_text });
  }
  const isStarted = nowMs >= kickoffMs;
  const elapsed = isStarted ? Math.floor((nowMs - kickoffMs) / 60000) : -1;
  const isOver = match.status === "finished" || match.status === "cancelled" || (isStarted && elapsed >= FULL_TIME_MINUTE);
  if (isOver) {
    return withOdds({
      ...match,
      status: match.status === "cancelled" ? "cancelled" : "finished",
      status_text: match.status === "cancelled" ? "Cancelled" : "Full time",
      current_minute: FULL_TIME_MINUTE
    });
  }
  if (!isStarted) {
    return withOdds({
      ...match,
      status: "scheduled",
      status_text: "Upcoming",
      current_minute: 0
    });
  }
  return withOdds({
    ...match,
    status: "live",
    status_text: "Live",
    current_minute: Math.min(Math.max(elapsed, 1), FULL_TIME_MINUTE - 1)
  });
}

function mergeAndDedupe(lists: SportsMatch[][]) {
  const seen = new Set<string>();
  const merged: SportsMatch[] = [];
  for (const list of lists) {
    for (const match of list) {
      const kickoff = new Date(match.time || 0);
      const dateKey = Number.isNaN(kickoff.getTime()) ? "unknown" : kickoff.toISOString().slice(0, 10);
      const home = (match.home || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      const away = (match.away || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (!home || !away) continue;
      const key = `${home}|${away}|${dateKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(match);
    }
  }
  return merged;
}

export async function GET(request: Request) {
  const requestedSport = new URL(request.url).searchParams.get("sport")?.toLowerCase() || "football";
  const sport = requestedSport === "table_tennis" ? "table-tennis" : requestedSport;

  if (!SUPPORTED_SPORTS.has(sport)) {
    return NextResponse.json(
      { error: "That sport is not available in the live feed." },
      { status: 400 }
    );
  }

  // Admin panel view (?admin=true): staff-only, returns every fixture
  // including finished/cancelled/stale ones that the customer site hides.
  const isAdminView = new URL(request.url).searchParams.get("admin") === "true";
  if (isAdminView) {
    const authClient = await createSupabaseServerClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const { data: profile } = await authClient.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || !["admin", "sub_admin"].includes(profile.role)) {
      return NextResponse.json({ error: "Only staff can view all matches." }, { status: 403 });
    }
  }

  // Leg-state lookup (open-bets detail ticks) — `?matchIds=a,b,c` returns
  // JUST those fixtures (id + score + status), including finished ones,
  // without the site-wide feed filter that hides decided matches.
  const matchIdsParam = new URL(request.url).searchParams.get("matchIds");
  const requestedIds = matchIdsParam ? matchIdsParam.split(",").map((id) => id.trim()).filter(Boolean).slice(0, 100) : null;

  try {
    // Settle first: matches that ran out of time go to full time here (instead
    // of staying "live" forever) and their bets are decided in the same pass,
    // so the response below already reflects the final result.
    await settleOpenBets();

    // Leg-state lookup by id (open-bets detail) — query across every sport,
    // not just the requested one, so a settled tennis/basketball leg still
    // reports its final score.
    let requestedFixtures: SportsMatch[] = [];
    if (requestedIds && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      const lookup = await createSupabaseServerClient();
      const { data, error } = await lookup
        .from("matches")
        .select("id,sport,competition,home,away,home_score,away_score,status,kickoff,source,odds,current_minute")
        .in("id", requestedIds);
      if (!error) {
        requestedFixtures = (data || []).map((match) => normalizeDatabaseMatch({
          ...match,
          scheduled_goals: runtimeScheduledGoals.get(match.id) || getScheduledGoals(match.odds)
        }));
      }
    }

    let databaseMatches: SportsMatch[] = [];
    let databaseReady = false;
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      const supabase = await createSupabaseServerClient();
      // Admin view: every sport, newest kickoffs first, larger cap so
      // recently created fixtures are never pushed out by old rows.
      const baseQuery = supabase
        .from("matches")
        .select("id,sport,competition,home,away,home_score,away_score,status,kickoff,source,odds,current_minute");
      const { data, error } = isAdminView
        ? await baseQuery.order("kickoff", { ascending: false }).limit(200)
        : await baseQuery.eq("sport", sport).order("kickoff", { ascending: true }).limit(50);
      if (error) {
        const missingTable = error.message.includes("Could not find the table") || error.code === "42P01";
        if (!missingTable) console.error("Supabase matches query failed:", error.message);
      } else {
        databaseReady = true;
        databaseMatches = (data || []).map((match) => normalizeDatabaseMatch({
          ...match,
          scheduled_goals: runtimeScheduledGoals.get(match.id) || getScheduledGoals(match.odds)
        }));
      }
    }

    // ESPN is the primary football source (free, no key, with logos).
    const apiFootballMatches = sport === "football" ? await fetchApiFootballMatches() : [];

    const sportScoreUrl =
      `https://sportscore.com/api/widget/matches/?sport=${encodeURIComponent(sport)}&limit=50&src=betkiing`;
    const response = await fetch(sportScoreUrl, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 }
    });

    const payload: { matches?: SportScoreMatch[]; updated?: string } = response.ok
      ? await response.json()
      : {};
    const upstreamMatches = Array.isArray(payload.matches)
      ? payload.matches.map((match) => normalizeMatch(match, sport))
      : [];
    const fallbackMatches = (generatedMatches[sport] || []).map(normalizeFallbackMatch);
    const mergedFixtures = mergeAndDedupe([databaseMatches, apiFootballMatches, upstreamMatches, fallbackMatches]);
    // Keep the last-seen version of every fixture so settlement can still
    // grade a bet after the feed drops the finished match.
    rememberFixtures(mergedFixtures);
    // Leg-state lookups bypass the hard rule below — the open-bets detail
    // screen needs finished fixtures to show won/lost ticks on legs.
    if (requestedIds) {
      const wanted = new Set(requestedIds);
      const footballLookupMatches = sport === "football" ? apiFootballMatches : await fetchApiFootballMatches();
      const bySlug = new Map<string, SportsMatch>();
      for (const match of [...requestedFixtures, ...footballLookupMatches, ...databaseMatches, ...apiFootballMatches, ...upstreamMatches, ...fallbackMatches]) {
        if (match.slug) bySlug.set(match.slug, match);
      }
      const fixtures = [...wanted].map((id) => bySlug.get(id)).filter((match): match is SportsMatch => Boolean(match));
      return NextResponse.json({ matches: fixtures.map((match) => ({
        slug: match.slug,
        home_score: match.home_score,
        away_score: match.away_score,
        status: match.status,
        status_text: match.status_text,
        current_minute: match.current_minute
      })), sport });
    }
    // Customer site: finished and cancelled matches are NEVER shown.
    // Admin view: show everything, soonest kickoff first, so staff can
    // see and manage finished/stale fixtures too.
    const allMatches = isAdminView
      ? [...mergedFixtures].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
      : sortByBigness(
        mergedFixtures.filter((match) => isShownOnSite(match.status, match.status_text, match.time))
      );
    const featured = new URL(request.url).searchParams.get("featured") === "true";
    const liveOnly = new URL(request.url).searchParams.get("live") === "true";

    // Featured picks exclude anything currently live. Live filter keeps only
    // matches whose normalized status is exactly "live".
    let matches = allMatches;
    if (featured) {
      matches = matches.filter((match) => !isLiveMatch(match.status, match.status_text));
    }
    if (liveOnly) {
      matches = matches.filter((match) => isLiveMatch(match.status, match.status_text));
    }
    if (!isAdminView) matches = sortByBigness(matches);

    return NextResponse.json({
      matches: featured ? matches.slice(0, 3) : matches,
      updated: payload.updated ?? null,
      sport,
      source: databaseMatches.length > 0
        ? "ESPN + SportScore (incl. manually fixed)"
        : apiFootballMatches.length > 0
          ? upstreamMatches.length > 0 ? "ESPN + SportScore" : "ESPN"
          : upstreamMatches.length > 0 ? "SportScore" : "SportScore fallback",
      fallback: databaseMatches.length === 0 && apiFootballMatches.length === 0 && upstreamMatches.length === 0,
      databaseReady,
      setupRequired: !databaseReady
    });
  } catch {
    const fallback = (generatedMatches[sport] || [])
      .map(normalizeFallbackMatch)
      .filter((match) => isShownOnSite(match.status, match.status_text, match.time));
    return NextResponse.json({ matches: fallback, updated: null, sport, source: "AlphaBet fallback", fallback: true, databaseReady: false, setupRequired: true });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: string; home?: string; away?: string; competition?: string; kickoff?: string; home_score?: number; away_score?: number; status?: string; current_minute?: number; scheduled_goals?: Array<{ minute: number; team: "home" | "away" }> };
    if (!body.id) return NextResponse.json({ error: "Match id is required." }, { status: 400 });
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "You must be signed in to operate a match." }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") return NextResponse.json({ error: "Only admins can manage matches." }, { status: 403 });

    const updates: Record<string, number | string | MatchOdds> = {};
    if (typeof body.home === "string" && body.home.trim()) updates.home = body.home.trim();
    if (typeof body.away === "string" && body.away.trim()) updates.away = body.away.trim();
    if (typeof body.competition === "string" && body.competition.trim()) updates.competition = body.competition.trim();
    if (typeof body.kickoff === "string" && !Number.isNaN(new Date(body.kickoff).getTime())) updates.kickoff = body.kickoff;
    const homeScore = body.home_score;
    const awayScore = body.away_score;
    const currentMinute = body.current_minute;
    if (typeof homeScore === "number" && Number.isInteger(homeScore) && homeScore >= 0) updates.home_score = homeScore;
    if (typeof awayScore === "number" && Number.isInteger(awayScore) && awayScore >= 0) updates.away_score = awayScore;
    if (typeof currentMinute === "number" && Number.isInteger(currentMinute) && currentMinute >= 0) updates.current_minute = currentMinute;
    if (typeof currentMinute === "number" && currentMinute >= FULL_TIME_MINUTE && !body.status) updates.status = "finished";
    if (body.status && ["scheduled", "live", "finished", "cancelled"].includes(body.status)) updates.status = body.status;
    if (updates.status === "finished" && typeof currentMinute !== "number") {
      // Finishing a match means full time: pin the clock at 90 so every
      // scripted goal counts and the match stops behaving like it is live.
      const { data: existing } = await supabase.from("matches").select("current_minute").eq("id", body.id).maybeSingle();
      updates.current_minute = Math.max(Number(existing?.current_minute || 0), FULL_TIME_MINUTE);
    }
    const validGoals = Array.isArray(body.scheduled_goals) && body.scheduled_goals.every((goal) => Number.isInteger(goal.minute) && goal.minute >= 0 && goal.minute <= 120 && (goal.team === "home" || goal.team === "away"))
      ? body.scheduled_goals : null;
    if (Object.keys(updates).length === 0 && !validGoals) return NextResponse.json({ error: "No valid match changes supplied." }, { status: 400 });
    const matchQuery = Object.keys(updates).length
      ? supabase.from("matches").update(updates).eq("id", body.id).select("id,sport,competition,home,away,home_score,away_score,status,kickoff,source,odds,current_minute").single()
      : supabase.from("matches").select("id,sport,competition,home,away,home_score,away_score,status,kickoff,source,odds,current_minute").eq("id", body.id).single();
    const { data, error } = await matchQuery;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (updates.status === "finished" || updates.status === "cancelled") {
      // The match is decided — settle every bet that referenced it now.
      await settleOpenBets();
    }
    if (validGoals) {
      const currentOdds = data.odds;
      updates.odds = { values: getOddsValues(currentOdds), scheduled_goals: validGoals };
      const { data: updated, error: updateError } = await supabase.from("matches").update(updates).eq("id", body.id).select("id,sport,competition,home,away,home_score,away_score,status,kickoff,source,odds,current_minute").single();
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 });
      runtimeScheduledGoals.delete(body.id);
      return NextResponse.json({ match: normalizeDatabaseMatch({ ...updated, scheduled_goals: validGoals }) });
    }
    return NextResponse.json({ match: normalizeDatabaseMatch({ ...data, scheduled_goals: runtimeScheduledGoals.get(body.id) || getScheduledGoals(data.odds) }) });
  } catch (error) {
    console.error("Match update failed:", error);
    return NextResponse.json({ error: "Could not update the match." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Match id is required." }, { status: 400 });
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "You must be signed in to delete a match." }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Only admins can delete matches." }, { status: 403 });
    }
    const { data: match, error: lookupError } = await supabase.from("matches").select("id,source").eq("id", id).single();
    if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 400 });
    if (match.source !== "BETKIING" && match.source !== "AlphaBet") return NextResponse.json({ error: "External feed matches cannot be deleted." }, { status: 403 });
    const { error } = await supabase.from("matches").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    runtimeScheduledGoals.delete(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Match deletion failed:", error);
    return NextResponse.json({ error: "Could not delete the match." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Partial<SportsMatch>;
    const scheduledGoals = Array.isArray(body.scheduled_goals)
      ? body.scheduled_goals.filter((goal) =>
        Number.isInteger(goal.minute) &&
        goal.minute >= 0 &&
        goal.minute <= 120 &&
        (goal.team === "home" || goal.team === "away")
      )
      : [];
    const sport = body.competition?.toLowerCase().includes("tennis")
      ? "tennis"
      : body.competition?.toLowerCase().includes("basket")
        ? "basketball"
        : "football";

    if (!body.home?.trim() || !body.away?.trim() || !body.time) {
      return NextResponse.json({ error: "Home team, away team, and kickoff are required." }, { status: 400 });
    }

    const match: SportsMatch = {
      home: body.home.trim(),
      away: body.away.trim(),
      home_logo: body.home_logo?.trim() || null,
      away_logo: body.away_logo?.trim() || null,
      home_score: null,
      away_score: null,
      status: "scheduled",
      status_text: "Upcoming",
      time: body.time,
      slug: `alphabet-${Date.now()}`,
      competition: body.competition?.trim() || `${sport} · AlphaBet`,
      source: "AlphaBet",
      odds: body.odds?.length ? body.odds : ["1.90", "3.20", "2.10"],
      scheduled_goals: scheduledGoals
    };

    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      const supabase = await createSupabaseServerClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "You must be signed in to create a match." }, { status: 401 });

      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (!profile || !["admin", "sub_admin"].includes(profile.role)) {
        return NextResponse.json({ error: "Only staff can create matches." }, { status: 403 });
      }
      // Sub-admins have no INSERT policy on matches — write via service role.
      const db = profile.role === "sub_admin" ? writerClient() : supabase;

      const { data: existingMatch } = await db
        .from("matches")
        .select("id,sport,competition,home,away,home_score,away_score,status,kickoff,source,odds,current_minute")
        .eq("sport", sport)
        .eq("home", match.home)
        .eq("away", match.away)
        .eq("kickoff", match.time)
        .maybeSingle();
      if (existingMatch) {
        return NextResponse.json({ match: normalizeDatabaseMatch({ ...existingMatch, scheduled_goals: getScheduledGoals(existingMatch.odds) }), source: "Supabase", duplicate: true }, { status: 200 });
      }

      const { data, error } = await db.from("matches").insert({
        sport,
        competition: match.competition,
        home: match.home,
        away: match.away,
        kickoff: match.time,
        source: "AlphaBet",
        odds: { values: match.odds, scheduled_goals: scheduledGoals, logos: { home: match.home_logo || null, away: match.away_logo || null } },
        created_by: user.id,
      }).select("id,sport,competition,home,away,home_score,away_score,status,kickoff,source,odds,current_minute").single();
      if (error) {
        console.error("Supabase match insert failed:", error.message);
        return NextResponse.json({ error: `Could not save the match to Supabase: ${error.message}` }, { status: 502 });
      }
      return NextResponse.json({ match: normalizeDatabaseMatch({ ...data, scheduled_goals: scheduledGoals }), source: "Supabase" }, { status: 201 });
    }

    generatedMatches[sport] = [match, ...(generatedMatches[sport] || [])];
    return NextResponse.json({ match, source: "AlphaBet fallback" }, { status: 201 });
  } catch (error) {
    console.error("Match creation failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create the match." }, { status: 400 });
  }
}
