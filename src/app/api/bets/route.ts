import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

/** bets/customer_bets have select-only RLS policies — writes go through the
 *  service-role client after ownership is verified (same as transactions). */
function writerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Bet changes are not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env and restart Next.js.");
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

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
    // A staff member can also carry an old customer cookie from testing the
    // customer site. Their staff profile is the wallet shown in the header,
    // so always prefer a signed-in staff account over that stale customer
    // session — otherwise the bet is debited from the wrong (empty) wallet.
    const authClient = await createSupabaseServerClient();
    const { data: { user: staffUser } } = await authClient.auth.getUser();
    const customer = staffUser ? null : await getCustomerSession();

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
      // Staff wallets live on `profiles`, not `customer_accounts` — check the
      // same balance the header shows before placing any single.
      if (!customer && staffUser) {
        const { data: staffProfile } = await authClient.from("profiles").select("balance").eq("id", staffUser.id).maybeSingle();
        if (staffProfile && Number(staffProfile.balance) < totalStake) {
          return NextResponse.json({ error: "Your wallet balance is too low for this stake. Deposit first, then try again." }, { status: 400 });
        }
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
    if (!staffUser) return NextResponse.json({ error: "Sign in before placing a bet." }, { status: 401 });

    const { data, error } = await authClient.rpc("place_bet", {
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

/**
 * Change the pick (option + odd) on one leg of an OPEN bet, e.g. from the
 * Active Bets detail popup. The potential return is recalculated from the
 * stake × product of all leg odds. Settled bets are immutable.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: string; selections?: BetSelection[] };
    const selections = Array.isArray(body.selections) ? body.selections : [];
    if (!body.id || selections.length === 0 || selections.some((selection) => !selection.matchId || !selection.option || !Number.isFinite(Number(selection.odds)) || Number(selection.odds) <= 1)) {
      return NextResponse.json({ error: "A bet id and valid selections with odds are required." }, { status: 400 });
    }
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    const customer = user ? null : await getCustomerSession();
    if (!user && !customer) return NextResponse.json({ error: "Sign in to change a bet." }, { status: 401 });

    const table = customer ? "customer_bets" : "bets";
    const ownerColumn = customer ? "account_id" : "user_id";
    const ownerId = customer ? customer.account_id : user!.id;
    // Direct table lookup through the session client is blocked by RLS for
    // customer-cookie sessions (history uses a security-definer RPC), so
    // read via service role — ownership is enforced by the owner filter.
    const writer = writerClient();
    const { data: bet, error: lookupError } = await writer
      .from(table)
      .select("id, stake, status, selections")
      .eq("id", body.id)
      .eq(ownerColumn, ownerId)
      .maybeSingle();
    if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 400 });
    if (!bet) return NextResponse.json({ error: "Bet not found." }, { status: 404 });
    if (bet.status !== "open") return NextResponse.json({ error: "Only open bets can be changed." }, { status: 400 });

    // A leg whose match is already decided cannot be re-picked.
    const guard = await guardDecidedMatches(selections);
    if (guard) return guard;

    const cleanSelections = selections.map((selection) => ({
      match: selection.match,
      matchId: selection.matchId,
      option: selection.option,
      odds: Number(selection.odds),
      market: selection.market || "1X2",
      ...(selection.stake ? { stake: Number(selection.stake) } : {})
    }));
    const potentialReturn = Number((Number(bet.stake) * cleanSelections.reduce((total, selection) => total * selection.odds, 1)).toFixed(2));

    // bets/customer_bets have select-only RLS policies — write via service
    // role (ownership already verified above), like staff transactions.
    const { data: updated, error } = await writer
      .from(table)
      .update({ selections: cleanSelections, potential_return: potentialReturn })
      .eq("id", body.id)
      .select("id, stake, potential_return, status, selections, placed_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ bet: updated, potentialReturn });
  } catch (error) {
    console.error("Bet update failed:", error);
    return NextResponse.json({ error: "The bet could not be changed. Please try again." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const betId = searchParams.get("id");
    if (!betId) {
      return NextResponse.json({ error: "Bet ID is required." }, { status: 400 });
    }

    const authClient = await createSupabaseServerClient();
    const { data: { user: staffUser } } = await authClient.auth.getUser();
    const customer = staffUser ? null : await getCustomerSession();

    const writer = writerClient();

    // Determine which table and owner column to use
    const table = customer ? "customer_bets" : "bets";
    const ownerColumn = customer ? "account_id" : "user_id";
    const ownerId = customer ? customer?.account_id : staffUser?.id;

    if (!ownerId) {
      return NextResponse.json({ error: "Sign in to delete a bet." }, { status: 401 });
    }

    // Look up the bet, verifying ownership
    const { data: bet, error: lookupError } = await writer
      .from(table)
      .select("id, stake, status, potential_return")
      .eq("id", betId)
      .eq(ownerColumn, ownerId)
      .maybeSingle();
    if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 400 });
    if (!bet) return NextResponse.json({ error: "Bet not found." }, { status: 404 });

    // Only allow deletion of settled bets (won / lost / void)
    // Open bets must not be deletable — SportyBet-style removal is for history only
    if (bet.status === "open") {
      return NextResponse.json({ error: "Only settled bets can be deleted from history." }, { status: 400 });
    }

    // Delete the bet row
    const { error: deleteError } = await writer
      .from(table)
      .delete()
      .eq("id", betId);

    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 400 });

    // Return success with bet details (status, payout info)
    return NextResponse.json({ id: bet.id, status: bet.status, potential_return: bet.potential_return }, { status: 200 });
  } catch (error) {
    console.error("Bet deletion failed:", error);
    return NextResponse.json({ error: "The bet could not be deleted. Please try again." }, { status: 500 });
  }
}

export async function GET() {
  try {
    // Settle anything that has been decided, then report what changed so the
    // client can celebrate a win exactly once.
    const settled = await settleOpenBets();
    // Same precedence as POST: a signed-in staff account owns the wallet in
    // the header, even if an old customer cookie is still around.
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    const customer = user ? null : await getCustomerSession();
    if (customer) {
      const { data, error } = await supabase.rpc("customer_bet_history", { p_account_id: customer.account_id });
      if (error) {
        console.error("Customer bet history failed:", error.message);
        return NextResponse.json({ error: "Bet history is temporarily unavailable." }, { status: 500 });
      }
      const mine = settled.filter((bet) => bet.kind === "customer" && bet.accountId === customer.account_id);
      return NextResponse.json({ bets: data || [], settled: mine, currency: customer.currency || "GHS" });
    }
    if (!user) return NextResponse.json({ error: "Sign in to view your bets." }, { status: 401 });
    const { data, error } = await supabase.from("bets").select("id,stake,potential_return,status,selections,placed_at").eq("user_id", user.id).order("placed_at", { ascending: false });
    if (error) {
      console.error("Staff bet history failed:", error.message);
      return NextResponse.json({ error: "Bet history is temporarily unavailable." }, { status: 500 });
    }
    const mine = settled.filter((bet) => bet.kind === "staff" && bet.userId === user.id);
    return NextResponse.json({ bets: data || [], settled: mine, currency: "GHS" });
  } catch (error) {
    console.error("Bet history request failed:", error);
    return NextResponse.json({ error: "Bet history is temporarily unavailable." }, { status: 500 });
  }
}
