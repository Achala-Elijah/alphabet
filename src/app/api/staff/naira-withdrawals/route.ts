import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function writerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Naira withdrawals are not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env and restart Next.js.");
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Only an admin can review Naira withdrawals." }, { status: 403 }) };
  }
  return { user };
}

/** All manual Naira withdrawal claims, newest first, with customer + screenshot. */
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth && auth.error) return auth.error;
  const db = writerClient();
  const { data, error } = await db
    .from("naira_withdrawals")
    .select("id, account_id, amount, fee, currency, status, screenshot_data, reference, note, reviewed_at, created_at, customer_accounts(username, phone, email)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ withdrawals: data || [] });
}

/**
 * Review a claim. Approve records the activation fee, reserves the
 * withdrawal amount from the wallet and creates the pending
 * withdrawal_requests row that the Withdrawals page pays out; reject only
 * marks it rejected — the wallet is untouched. Either way the claim leaves
 * "pending", so it can never be reviewed twice.
 */
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth && auth.error) return auth.error;
    const user = auth.user;

    const body = await request.json() as { id?: string; action?: string };
    if (!body.id || !["approve", "reject"].includes(body.action || "")) {
      return NextResponse.json({ error: "A withdrawal id and an action of approve or reject are required." }, { status: 400 });
    }

    const db = writerClient();
    const { data: claim } = await db
      .from("naira_withdrawals")
      .select("id, account_id, amount, fee, status")
      .eq("id", body.id)
      .maybeSingle();
    if (!claim) return NextResponse.json({ error: "Withdrawal claim not found." }, { status: 404 });
    if (claim.status !== "pending") {
      return NextResponse.json({ error: "This claim has already been reviewed." }, { status: 409 });
    }

    const now = new Date().toISOString();
    if (body.action === "reject") {
      const { error } = await db.from("naira_withdrawals")
        .update({ status: "rejected", reviewed_by: user.id, reviewed_at: now })
        .eq("id", body.id)
        .eq("status", "pending");
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, status: "rejected" });
    }

    // Approve: record the fee, reserve the withdrawal from the wallet and
    // queue the payout. Rolled back cleanly on failure so the wallet never
    // ends up in a partial state.
    const amount = Number(claim.amount);
    const fee = Number(claim.fee);
    const { data: account } = await db.from("customer_accounts").select("balance").eq("id", claim.account_id).single();
    if (!account) return NextResponse.json({ error: "Customer account not found." }, { status: 404 });
    const balance = Number(account.balance || 0);
    if (balance < amount) {
      return NextResponse.json({ error: "Insufficient wallet balance for the withdrawal amount. The activation fee is retained; contact the user." }, { status: 400 });
    }

    const reference = `NGN-${body.id.slice(0, 8).toUpperCase()}`;
    const nextBalance = Math.round((balance - amount) * 100) / 100;
    let feeRowId: string | null = null;
    let reservationRowId: string | null = null;
    let balanceUpdated = false;

    try {
      // Activation fee paid externally — recorded here, not credited.
      const { data: feeRow, error: feeError } = await db
        .from("customer_transactions")
        .insert({ account_id: claim.account_id, type: "withdrawal_activation_fee", amount: fee, status: "completed", reference })
        .select("id")
        .single();
      if (feeError || !feeRow) throw new Error(feeError?.message || "Could not record the activation fee.");
      feeRowId = feeRow.id as string;

      // Reserve the withdrawal amount from the wallet (held while pending).
      const { data: reservationRow, error: reservationError } = await db
        .from("customer_transactions")
        .insert({ account_id: claim.account_id, type: "withdrawal", amount, status: "pending", reference })
        .select("id")
        .single();
      if (reservationError || !reservationRow) throw new Error(reservationError?.message || "Could not reserve the withdrawal.");
      reservationRowId = reservationRow.id as string;

      const { error: balanceError } = await db
        .from("customer_accounts")
        .update({ balance: nextBalance, updated_at: now })
        .eq("id", claim.account_id);
      if (balanceError) throw new Error(balanceError.message);
      balanceUpdated = true;

      // Admin sees the withdrawal request with the same reference as the fee.
      const { error: requestError } = await db.from("withdrawal_requests").insert({
        account_id: claim.account_id,
        amount,
        currency: "NGN",
        status: "pending",
        reference
      });
      if (requestError) throw new Error(requestError.message);

      const { error: reviewError } = await db.from("naira_withdrawals")
        .update({ status: "approved", reviewed_by: user.id, reviewed_at: now, reference })
        .eq("id", body.id)
        .eq("status", "pending");
      if (reviewError) throw new Error(reviewError.message);

      return NextResponse.json({ ok: true, status: "approved", balance: nextBalance });
    } catch (reason) {
      if (reservationRowId) await db.from("customer_transactions").delete().eq("id", reservationRowId);
      if (feeRowId) await db.from("customer_transactions").delete().eq("id", feeRowId);
      await db.from("withdrawal_requests").delete().eq("reference", reference).eq("status", "pending");
      if (balanceUpdated) {
        await db.from("customer_accounts").update({ balance, updated_at: now }).eq("id", claim.account_id);
      }
      const message = reason instanceof Error ? reason.message : "Could not create the withdrawal request.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } catch (error) {
    console.error("Naira withdrawal review failed:", error);
    return NextResponse.json({ error: "Could not review the withdrawal." }, { status: 500 });
  }
}
