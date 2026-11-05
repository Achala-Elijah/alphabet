import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cachedFixtures } from "@/lib/live-feed-cache";

/**
 * Bet settlement.
 *
 * A match is over after FULL_TIME_MINUTES of play (or when an admin finishes
 * it). Once every selection of a bet refers to a decided match, the bet is
 * settled here: winners are credited into the wallet with a `payout` ledger
 * row, losers simply lose, and void legs (cancelled matches, markets we cannot
 * judge) refund their share of the stake.
 *
 * Everything runs with the service role because bet status is never writable
 * by the people who bet on it.
 */

/** A match reaches full time after this many minutes. */
export const FULL_TIME_MINUTE = 90;
/** Fallback used only when the feed drops a fixture before reporting a final
 *  status. Wall-clock time is generous because stoppage, breaks and overtime
 *  all run longer than 90 minutes of play. */
const AUTO_FINISH_MINUTES = 180;

type Goal = { minute: number; team: "home" | "away" };
type Selection = { matchId?: string; option?: string; odds?: number | string; market?: string };

type MatchRow = {
  id: string;
  status: string;
  kickoff: string;
  current_minute?: number | null;
  home_score?: number | null;
  away_score?: number | null;
  odds?: unknown;
};

type BetRow = {
  id: string;
  stake: number;
  potential_return: number;
  selections: Selection[] | null;
  account_id?: string;
  user_id?: string;
};

export type SettledBet = {
  id: string;
  kind: "customer" | "staff";
  status: "won" | "lost" | "void";
  payout: number;
  stake: number;
  potential_return: number;
  /** Owner of the bet — callers must filter on this before responding. */
  accountId?: string;
  userId?: string;
};

type LegResult = "won" | "lost" | "void";

/** Settlement always needs the service role; returns null when it is not configured. */
function settlementClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function scheduledGoals(match: MatchRow): Goal[] {
  const odds = match.odds as { scheduled_goals?: Goal[] } | Goal[] | null | undefined;
  if (!odds || Array.isArray(odds)) return [];
  return Array.isArray(odds.scheduled_goals) ? odds.scheduled_goals : [];
}

/**
 * True when a match is decided — either explicitly finished/cancelled, or
 * it has run out of time (90' elapsed). Used to block betting on decided
 * matches and to trigger settlement. Returns true for already-finished
 * matches so callers can treat them as over.
 */
export function isMatchOver(match: Pick<MatchRow, "status" | "kickoff" | "current_minute">, now = new Date()) {
  if (match.status === "finished" || match.status === "cancelled") return true;
  const elapsed = (now.getTime() - new Date(match.kickoff).getTime()) / 60000;
  return elapsed >= FULL_TIME_MINUTE || Number(match.current_minute || 0) >= FULL_TIME_MINUTE;
}

/**
 * Final score of a decided match: the stored score plus every scripted goal
 * up to full time — exactly what the match list displays, so what users saw
 * and what they are paid on can never disagree.
 */
function finalScore(match: MatchRow) {
  const minute = Math.max(Number(match.current_minute || 0), FULL_TIME_MINUTE);
  const goals = scheduledGoals(match).filter((goal) => goal.minute <= minute);
  const home = Number(match.home_score || 0) + goals.filter((goal) => goal.team === "home").length;
  const away = Number(match.away_score || 0) + goals.filter((goal) => goal.team === "away").length;
  const firstHalf = goals.filter((goal) => goal.minute <= 45);
  return {
    home,
    away,
    firstHalfHome: firstHalf.filter((goal) => goal.team === "home").length,
    firstHalfAway: firstHalf.filter((goal) => goal.team === "away").length
  };
}

/** Judge one selection against the final score. Markets we cannot judge are void (stake back). */
function evaluateLeg(selection: Selection, match: MatchRow): LegResult {
  if (match.status === "cancelled") return "void";

  const market = String(selection.market || "").trim().toLowerCase();
  const option = String(selection.option || "").trim();
  const optionLower = option.toLowerCase();
  const score = finalScore(match);
  const total = score.home + score.away;
  const firstHalfTotal = score.firstHalfHome + score.firstHalfAway;
  const thresholdMatch = option.match(/(\d+(?:\.\d+)?)/);
  const threshold = thresholdMatch ? Number(thresholdMatch[1]) : null;

  const over = (value: number): LegResult => (threshold === null ? "void" : value > threshold ? "won" : "lost");
  const under = (value: number): LegResult => (threshold === null ? "void" : value < threshold ? "won" : "lost");
  const homeWin = (): LegResult => (score.home > score.away ? "won" : "lost");
  const awayWin = (): LegResult => (score.away > score.home ? "won" : "lost");

  switch (market) {
    case "1x2":
      return option === "1" ? homeWin() : option === "2" ? awayWin() : score.home === score.away ? "won" : "lost";
    case "dc":
      return option === "1x"
        ? (score.home >= score.away ? "won" : "lost")
        : option === "x2"
          ? (score.away >= score.home ? "won" : "lost")
          : score.home !== score.away ? "won" : "lost";
    case "o/u":
      return optionLower.startsWith("over") ? over(total) : under(total);
    case "1st half o/u":
      return optionLower.startsWith("over") ? over(firstHalfTotal) : under(firstHalfTotal);
    case "1st half": {
      if (optionLower === "home") return score.firstHalfHome > score.firstHalfAway ? "won" : "lost";
      if (optionLower === "away") return score.firstHalfAway > score.firstHalfHome ? "won" : "lost";
      return score.firstHalfHome === score.firstHalfAway ? "won" : "lost";
    }
    case "handicap":
    case "game handicap": {
      // "Home -1", "Away +1", "Player 1 -2.5" … the named side gets the line.
      const parsed = option.match(/^(home|away|player\s*1|player\s*2)\s*([+-]\d+(?:\.\d+)?)$/i);
      if (!parsed) return "void";
      const line = Number(parsed[2]);
      const named = /home|player\s*1/i.test(parsed[1]);
      const adjustedNamed = (named ? score.home : score.away) + line;
      const adjustedOther = named ? score.away : score.home;
      if (Math.abs(adjustedNamed - adjustedOther) < 0.001) return "void"; // handicap push -> stake back
      return adjustedNamed > adjustedOther ? "won" : "lost";
    }
    case "match winner":
      return optionLower.includes("1") || optionLower.includes("p1") ? homeWin() : awayWin();
    case "moneyline":
      return optionLower === "home" || optionLower === "player 1" ? homeWin() : awayWin();
    case "correct score": {
      // Exact scoreline: "2-1" wins only if the match ends 2-1. The
      // "Any other …" buckets catch every scoreline outside the 0–4 grid.
      const inGrid = score.home <= 4 && score.away <= 4;
      const exact = option.match(/^(\d+)\s*-\s*(\d+)$/);
      if (exact) {
        return score.home === Number(exact[1]) && score.away === Number(exact[2]) ? "won" : "lost";
      }
      if (optionLower === "any other home win") return !inGrid && score.home > score.away ? "won" : "lost";
      if (optionLower === "any other away win") return !inGrid && score.away > score.home ? "won" : "lost";
      if (optionLower === "any other draw") return !inGrid && score.home === score.away ? "won" : "lost";
      return "void";
    }
    case "set betting": {
      const parsed = option.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!parsed) return "void";
      return score.home === Number(parsed[1]) && score.away === Number(parsed[2]) ? "won" : "lost";
    }
    case "totals":
    case "total sets":
      return optionLower.startsWith("over") ? over(total) : under(total);
    case "total games":
      // Tennis games are not tracked — never guess with money.
      return "void";
    default:
      return "void";
  }
}

/** Combine leg results into the bet outcome. Void legs behave like odds of 1.00. */
function betOutcome(bet: BetRow, results: LegResult[]): { status: SettledBet["status"]; payout: number } {
  const stake = Number(bet.stake);
  if (results.includes("lost")) return { status: "lost", payout: 0 };
  if (results.every((result) => result === "void")) return { status: "void", payout: round(stake) };

  const wonOdds = results
    .map((result, index) => (result === "won" ? Number((bet.selections || [])[index]?.odds) || 1 : 1))
    .filter((odds) => Number.isFinite(odds) && odds > 0);
  const payout = round(stake * wonOdds.reduce((total, odds) => total * odds, 1));
  return { status: "won", payout: Math.min(payout, Number(bet.potential_return) || payout) };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

/** Ledger row first, wallet second, with undo on failure — same rule as deposits. */
async function creditPayout(db: SupabaseClient, kind: "customer" | "staff", bet: BetRow, status: SettledBet["status"], payout: number) {
  const reference = `${status === "void" ? "REFUND" : "PAYOUT"}-${bet.id}`;
  const type = status === "void" ? "refund" : "payout";

  const ledger = kind === "customer"
    ? { table: "customer_transactions", owner: "account_id", value: bet.account_id }
    : { table: "transactions", owner: "user_id", value: bet.user_id };

  const { data: entry, error: ledgerError } = await db
    .from(ledger.table)
    .insert({ [ledger.owner]: ledger.value, type, amount: payout, status: "completed", reference })
    .select("id")
    .single();
  if (ledgerError || !entry) throw new Error(ledgerError?.message || "Could not write the payout history.");

  const wallet = kind === "customer"
    ? { table: "customer_accounts", owner: "id" }
    : { table: "profiles", owner: "id" };

  const { data: current, error: readError } = await db.from(wallet.table).select("balance").eq(wallet.owner, ledger.value).single();
  if (readError || !current) {
    await db.from(ledger.table).delete().eq("id", entry.id);
    throw new Error(readError?.message || "Wallet not found.");
  }

  const balance = round(Number(current.balance || 0) + payout);
  const { error: updateError } = await db
    .from(wallet.table)
    .update({ balance, updated_at: new Date().toISOString() })
    .eq(wallet.owner, ledger.value);
  if (updateError) {
    await db.from(ledger.table).delete().eq("id", entry.id);
    throw new Error(updateError.message);
  }
}

/** Sports the public feed covers — used to resolve feed-only bet legs. */
const FEED_SPORTS = ["football", "tennis", "basketball", "table-tennis"];

/**
 * Resolve fixtures that are not in the `matches` table. SportScore keeps
 * returning a fixture while it plays, so a bet placed on a feed-only match can
 * still be settled from its final score even though it was never mirrored
 * into our database.
 */
async function fetchFeedFixtures(wanted: Set<string>): Promise<MatchRow[]> {
  const found = new Map<string, MatchRow>();
  await Promise.all(FEED_SPORTS.map(async (sport) => {
    try {
      const response = await fetch(
        `https://sportscore.com/api/widget/matches/?sport=${encodeURIComponent(sport)}&limit=50&src=betkiing`,
        { headers: { Accept: "application/json" }, cache: "no-store" }
      );
      if (!response.ok) return;
      const payload = await response.json() as {
        matches?: Array<{
          home?: string;
          away?: string;
          home_score?: number | null;
          away_score?: number | null;
          status?: string;
          status_text?: string;
          time?: string;
          slug?: string;
        }>;
      };
      for (const match of payload.matches || []) {
        const slug = match.slug || `${sport}-${match.home || "home"}-${match.away || "away"}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        if (!wanted.has(slug) || found.has(slug)) continue;
        const rawStatus = `${match.status || ""} ${match.status_text || ""}`.toLowerCase();
        const kickoff = match.time || new Date().toISOString();
        const elapsed = (Date.now() - new Date(kickoff).getTime()) / 60000;
        const cancelled = rawStatus.includes("cancel");
        const finished = !cancelled && (
          rawStatus.includes("full time") ||
          rawStatus.includes("finished") ||
          rawStatus.includes("completed") ||
          rawStatus.includes("ended") ||
          /\bft\b/.test(rawStatus) ||
          elapsed >= AUTO_FINISH_MINUTES
        );
        const live = !finished && (rawStatus.includes("live") || rawStatus.includes("half") || rawStatus.includes("in play"));
        found.set(slug, {
          id: slug,
          status: cancelled ? "cancelled" : finished ? "finished" : live ? "live" : "scheduled",
          kickoff,
          current_minute: finished ? FULL_TIME_MINUTE : live ? Math.max(0, Math.floor(elapsed)) : null,
          home_score: typeof match.home_score === "number" ? match.home_score : null,
          away_score: typeof match.away_score === "number" ? match.away_score : null,
          odds: null
        });
      }
    } catch {
      // Feed unavailable — other legs may still resolve, so keep going.
    }
  }));
  return [...found.values()];
}

function matchRowFromCache(fixture: ReturnType<typeof cachedFixtures>[number]): MatchRow {
  const kickoff = fixture.kickoff;
  const elapsed = (Date.now() - new Date(kickoff).getTime()) / 60000;
  const overTime = fixture.status !== "cancelled" && (fixture.status === "finished" || elapsed >= AUTO_FINISH_MINUTES);
  return {
    id: fixture.id,
    status: overTime ? "finished" : fixture.status,
    kickoff,
    current_minute: overTime ? FULL_TIME_MINUTE : fixture.current_minute,
    home_score: fixture.home_score,
    away_score: fixture.away_score,
    odds: null
  };
}

/**
 * Settle every open bet whose selections have all been decided.
 * Returns only the bets this call actually settled, so callers can show a
 * win popup exactly once per bet.
 */
export async function settleOpenBets(): Promise<SettledBet[]> {
  // Self-contained: matches that ran out of time are moved to full time first,
  // so this works from any trigger (bet history, feed poll, admin finish).
  await finalizeOverMatches();

  const db = settlementClient();
  if (!db) return [];

  const [customerBets, staffBets] = await Promise.all([
    db.from("customer_bets").select("id, account_id, stake, potential_return, selections").eq("status", "open").limit(200),
    db.from("bets").select("id, user_id, stake, potential_return, selections").eq("status", "open").limit(200)
  ]);

  const open: Array<{ kind: "customer" | "staff"; bet: BetRow }> = [
    ...(customerBets.data || []).map((bet) => ({ kind: "customer" as const, bet: bet as BetRow })),
    ...(staffBets.data || []).map((bet) => ({ kind: "staff" as const, bet: bet as BetRow }))
  ];
  if (!open.length) return [];

  const matchIds = [...new Set(open.flatMap(({ bet }) => (bet.selections || []).map((selection) => selection.matchId).filter((id): id is string => Boolean(id))))];
  if (!matchIds.length) return [];

  const { data: matches } = await db
    .from("matches")
    .select("id,status,kickoff,current_minute,home_score,away_score,odds")
    .in("id", matchIds);
  const matchById = new Map((matches || []).map((match) => [match.id, match as MatchRow]));

  // Feed-only fixtures are not in the `matches` table. Resolve them from the
  // last-seen feed cache first, then from the live SportScore feed itself.
  const unresolved = matchIds.filter((id) => !matchById.has(id));
  if (unresolved.length) {
    for (const fixture of cachedFixtures(unresolved)) {
      matchById.set(fixture.id, matchRowFromCache(fixture));
    }
    const stillMissing = unresolved.filter((id) => !matchById.has(id));
    if (stillMissing.length) {
      const feedFixtures = await fetchFeedFixtures(new Set(stillMissing));
      for (const fixture of feedFixtures) matchById.set(fixture.id, fixture);
    }
  }
  if (!matchById.size) return [];

  const settled: SettledBet[] = [];
  for (const { kind, bet } of open) {
    const selections = bet.selections || [];
    const legs = selections.map((selection) => ({ selection, match: selection.matchId ? matchById.get(selection.matchId) : undefined }));
    // A leg we cannot resolve (external feed match) or that is still to play keeps the bet open.
    if (legs.some((leg) => !leg.match || (leg.match.status !== "finished" && leg.match.status !== "cancelled"))) continue;

    const { status, payout } = betOutcome(bet, legs.map((leg) => evaluateLeg(leg.selection, leg.match as MatchRow)));

    const table = kind === "customer" ? "customer_bets" : "bets";
    const { data: claimed, error: claimError } = await db
      .from(table)
      .update({ status, settled_at: new Date().toISOString() })
      .eq("id", bet.id)
      .eq("status", "open")
      .select("id");
    if (claimError) {
      console.error(`Settlement claim failed for ${bet.id}:`, claimError.message);
      continue;
    }
    if (!claimed?.length) continue; // another request settled it first

    if (payout > 0) {
      try {
        await creditPayout(db, kind, bet, status, payout);
      } catch (reason) {
        console.error(`Payout failed for ${bet.id}:`, reason instanceof Error ? reason.message : reason);
        await db.from(table).update({ status: "open", settled_at: null }).eq("id", bet.id);
        continue;
      }
    }

    settled.push({
      id: bet.id,
      kind,
      status,
      payout,
      stake: Number(bet.stake),
      potential_return: Number(bet.potential_return),
      accountId: bet.account_id,
      userId: bet.user_id
    });
  }

  return settled;
}

/**
 * Move matches that ran out of time to full time so they stop showing as live.
 * Returns the ids that were finished by this call.
 */
export async function finalizeOverMatches(): Promise<string[]> {
  const db = settlementClient();
  if (!db) return [];

  const { data: playing } = await db
    .from("matches")
    .select("id,status,kickoff,current_minute")
    .in("status", ["scheduled", "live"])
    .limit(100);
  const over = (playing || []).filter((match) => isMatchOver(match));
  if (!over.length) return [];

  const ids = over.map((match) => match.id);
  const { error } = await db
    .from("matches")
    .update({ status: "finished", current_minute: FULL_TIME_MINUTE })
    .in("id", ids)
    .in("status", ["scheduled", "live"]);
  if (error) {
    console.error("Could not move matches to full time:", error.message);
    return [];
  }
  return ids;
}
