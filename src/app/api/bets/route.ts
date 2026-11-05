import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCustomerSession } from "@/lib/custom-auth";
import { isMatchOver, settleOpenBets } from "@/lib/bets/settlement";
import { minStake, normalizeCurrency } from "@/lib/limits";
import { formatCustomerAmount } from "@/lib/currency";

type BetSelection = {
  match: string;
  matchId: string;
  option: string;
  odds: number;
  market: string;
  /** Per-selection stake — required in "singles" mode. */
  stake?: number;
};

type CustomerSession = Awaited<ReturnType<typeof getCustomerSession>>;

/**
 * The UI disables odds on decided matches — the API has to as well, or a
 * client could bet on a result that is already known.
 * Note: matchId may be a SportScore slug for feed-only matches — those
 * aren't in the `matches` table yet, so we only block on rows we find.
 */
async function guardDecidedMatches(selections: BetSelection[]): Promise<NextResponse | null> {
  const guardClient = await createSupabaseServerClient();
  const chosenIds = [...new Set(selections.map((selection) => selection.matchId))];
  const { data: chosen } = await guardClient.from("matches").select("id,status,kickoff,current_minute").in("id", chosenIds);
  const decided = (chosen || []).find((match) => match.status === "finished" || match.status === "cancelled" || isMatchOver(match));
  if (decided) {
    return NextResponse.json({ error: "One of your selected matches has already finished. Refresh the matches and try again." }, { status: 400 });
  }
  return null;
}

/** Give a friendly message for the most common failures. */
function friendlyBetError(message: string): string {
  if (message.includes("Insufficient balance")) return "Your wallet balance is too low for this stake. Deposit first, then try again.";
  if (message.includes("balance")) return "Your wallet balance is too low for this stake.";
  if (message.includes("not available")) return "One of your selected matches is no longer available.";
  return message;
}

type SingleBetResult = { data: unknown } | { error: string; status: number };

/** Place exactly one bet (one selection, one stake) — used by Singles mode. */
async function placeSingleBet(customer: CustomerSession, stake: number, potentialReturn: number, selections: BetSelection[]): Promise<SingleBetResult> {
  const supabase = await createSupabaseServerClient();
  if (customer) {
    const { data, error } = await supabase.rpc("customer_place_bet", {
      p_account_id: customer.account_id,
      p_stake: stake,
      p_potential_return: potentialReturn,
      p_selections: selections
    });
    if (error) return { error: friendlyBetError(error.message), status: 400 };
    return { data };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in before placing a bet.", status: 401 };
  const { data, error } = await supabase.rpc("place_bet", { p_stake: stake, p_potential_return: potentialReturn, p_selections: selections });
  if (error) {
    console.error("Supabase place_bet failed:", error.message);
    return { error: friendlyBetError(error.message), status: 400 };
  }
  return { data };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { stake?: number; selections?: BetSelection[]; mode?: string };
    const mode = body.mode === "singles" ? "singles" : "multiple";
    const stake = Number(body.stake);
    const selections = Array.isArray(body.selections) ? body.selections : [];
    const customer = await getCustomerSession();

    // Minimum stake: GH₵ 150 for staff and GHS wallets, ₦15,000 for NGN wallets.
    const stakeCurrency = normalizeCurrency(customer?.currency);
    const minimumStake = minStake(stakeCurrency);

    if (mode === "singles") {
      // One bet per game, each with its own stake. Individually a stake can
      // be any positive amount — the wallet's minimum (GH₵150 / ₦15,000)
      // applies to the SUM of the slip, exactly like a real sportsbook.
      if (selections.length === 0 || selections.some((selection) => !selection.matchId || !selection.option || !Number.isFinite(selection.odds) || selection.odds <= 1)) {
        return NextResponse.json({ error: "Your bet slip contains an invalid selection. Refresh the matches and try again." }, { status: 400 });
      }
      const invalidStake = selections.find((selection) => !Number.isFinite(Number(selection.stake)) || Number(selection.stake) <= 0 || Number(selection.stake) > 1_000_000);
      if (invalidStake) {
        return NextResponse.json({ error: "Enter a valid stake up to 1,000,000 for every game." }, { status: 400 });
      }
      const totalStake = selections.reduce((total, selection) => total + Number(selection.stake), 0);
      if (totalStake < minimumStake) {
        return NextResponse.json({ error: `The minimum total stake for singles is ${formatCustomerAmount(minimumStake, stakeCurrency)}.` }, { status: 400 });
      }
      // Check the wallet can cover the whole slip before placing any of it,
      // so a short balance never leaves half the singles already staked.
      if (customer && Number(customer.balance) < totalStake) {
        return NextResponse.json({ error: "Your wallet balance is too low for this stake. Deposit first, then try again." }, { status: 400 });
      }
      const guard = await guardDecidedMatches(selections);
      if (guard) return guard;

      const placed: unknown[] = [];
      for (const selection of selections) {
        const singleStake = Number(selection.stake);
        const singleReturn = Number((singleStake * selection.odds).toFixed(2));
        const result = await placeSingleBet(customer, singleStake, singleReturn, [selection]);
        if ("error" in result) {
          // A later bet failed after earlier ones went through — tell the
          // user exactly what got staked instead of pretending nothing did.
          if (placed.length > 0) {
            return NextResponse.json({
              error: `${placed.length} of ${selections.length} games were placed before this error: ${result.error}`,
              placed: placed.length
            }, { status: 400 });
          }
          return NextResponse.json({ error: result.error }, { status: result.status });
        }
        placed.push(result.data);
      }
      const potentialReturn = Number(selections.reduce((total, selection) => total + Number(selection.stake) * selection.odds, 0).toFixed(2));
      return NextResponse.json({ bets: placed, count: placed.length, potentialReturn }, { status: 201 });
    }

    if (!Number.isFinite(stake) || stake <= 0 || stake > 1_000_000) {
      return NextResponse.json({ error: "Enter a valid stake up to 1,000,000." }, { status: 400 });
    }

    if (stake < minimumStake) {
      return NextResponse.json({ error: `The minimum stake is ${formatCustomerAmount(minimumStake, stakeCurrency)}.` }, { status: 400 });
    }

    if (selections.length === 0 || selections.some((selection) => !selection.matchId || !selection.option || !Number.isFinite(selection.odds) || selection.odds <= 1)) {
      return NextResponse.json({ error: "Your bet slip contains an invalid selection. Refresh the matches and try again." }, { status: 400 });
    }

    const guard = await guardDecidedMatches(selections);
    if (guard) return guard;

    const potentialReturn = Number((stake * selections.reduce((total, selection) => total * selection.odds, 1)).toFixed(2));
    if (customer) {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.rpc("customer_place_bet", { p_account_id: customer.account_id, p_stake: stake, p_potential_return: potentialReturn, p_selections: selections });
      if (error) {
        return NextResponse.json({ error: friendlyBetError(error.message) }, { status: 400 });
      }
      return NextResponse.json({ bet: data, potentialReturn }, { status: 201 });
    }
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in before placing a bet." }, { status: 401 });

    const { data, error } = await supabase.rpc("place_bet", {
      p_stake: stake,
      p_potential_return: potentialReturn,
      p_selections: selections
    });
    if (error) {
      console.error("Supabase place_bet failed:", error.message);
      const message = error.message.includes("Insufficient balance")
        ? "Your wallet balance is too low for this stake."
        : error.message.includes("not available")
          ? "One of your selected matches is no longer available."
          : "The bet could not be placed. Please try again.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ bet: data, potentialReturn }, { status: 201 });
  } catch (error) {
    console.error("Bet placement failed:", error);
    return NextResponse.json({ error: "The bet could not be placed. Please try again." }, { status: 500 });
  }
}

export async function GET() {
  try {
    // Settle anything that has been decided, then report what changed so the
    // client can celebrate a win exactly once.
    const settled = await settleOpenBets();
    const customer = await getCustomerSession();
    const supabase = await createSupabaseServerClient();
    if (customer) {
      const { data, error } = await supabase.rpc("customer_bet_history", { p_account_id: customer.account_id });
      if (error) {
        console.error("Customer bet history failed:", error.message);
        return NextResponse.json({ error: "Bet history is temporarily unavailable." }, { status: 500 });
      }
      const mine = settled.filter((bet) => bet.kind === "customer" && bet.accountId === customer.account_id);
      return NextResponse.json({ bets: data || [], settled: mine });
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in to view your bets." }, { status: 401 });
    const { data, error } = await supabase.from("bets").select("id,stake,potential_return,status,selections,placed_at").eq("user_id", user.id).order("placed_at", { ascending: false });
    if (error) {
      console.error("Staff bet history failed:", error.message);
      return NextResponse.json({ error: "Bet history is temporarily unavailable." }, { status: 500 });
    }
    const mine = settled.filter((bet) => bet.kind === "staff" && bet.userId === user.id);
    return NextResponse.json({ bets: data || [], settled: mine });
  } catch (error) {
    console.error("Bet history request failed:", error);
    return NextResponse.json({ error: "Bet history is temporarily unavailable." }, { status: 500 });
  }
}
