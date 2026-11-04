import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Staff API for manual-review withdrawals.
 *
 * GET   — list withdrawal requests (admin only — sub-admins are blocked)
 * PATCH — approve / reject / complete a pending request (admin only)
 *
 * Domain rules:
 *   - Only a full admin can approve withdrawals. Sub-admins cannot view or
 *     act on withdrawal requests.
 *   - Funds are deducted from the user's wallet at request time (in
 *     /api/wallet/withdraw) and stay reserved while pending — the user
 *     cannot bet with them and cannot request a second withdrawal that
 *     would overdraw the balance.
 *
 * Approval flow:
 *   approve  : status `pending`  -> `approved`. Funds stay reserved (already deducted).
 *              Admin then pays out manually (MoMo / bank transfer) and can optionally
 *              mark the request `completed` in a second step.
 *   reject   : status `pending`  -> `rejected`. Funds returned to customer's wallet,
 *              refund row written to customer_transactions.
 *   complete : status `approved` -> `completed` (payout confirmed sent).
 *   fail     : any -> `failed` (funds returned).
 */

function writerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Staff withdrawals are not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env and restart Next.js.");
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function assertStaff() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Sign in to view withdrawals." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  // Only a full admin can manage withdrawals — sub-admins are blocked.
  if (!profile || profile.role !== "admin") {
    return { error: NextResponse.json({ error: "Only an admin can manage withdrawals." }, { status: 403 }) };
  }
  return { user, profile: profile as { role: string }, supabase };
}

export async function GET() {
  const auth = await assertStaff();
  if ("error" in auth && auth.error) return auth.error;
  const { user, profile: { role } } = auth;

  const writer = writerClient();

  // Admin sees every withdrawal request.
  const query = writer
    .from("withdrawal_requests")
    .select("id, account_id, amount, currency, status, reference, reviewed_by, reviewed_at, review_note, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Resolve usernames for display.
  const ids = [...new Set((data || []).map((r) => r.account_id))];
  const { data: accounts } = ids.length
    ? await writer.from("customer_accounts").select("id, username, phone").in("id", ids)
    : { data: [] as never[] };
  const lookup = Object.fromEntries((accounts || []).map((a) => [a.id, { username: a.username, phone: a.phone }]));

  const withdrawals = (data || []).map((row) => ({
    ...row,
    username: lookup[row.account_id]?.username || "Unknown",
    phone: lookup[row.account_id]?.phone || null
  }));

  return NextResponse.json({ withdrawals });
}

export async function PATCH(request: Request) {
  const auth = await assertStaff();
  if ("error" in auth && auth.error) return auth.error;
  const { user } = auth;

  let body: { id?: unknown; action?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const id = typeof body.id === "string" ? body.id : "";
  const action = typeof body.action === "string" ? body.action : "";
  const note = typeof body.note === "string" ? body.note : "";

  if (!id || !["approve", "reject", "complete", "fail"].includes(action)) {
    return NextResponse.json({ error: "A withdrawal id and a valid action (approve | reject | complete | fail) are required." }, { status: 400 });
  }

  const writer = writerClient();

  const { data: row, error: fetchError } = await writer
    .from("withdrawal_requests")
    .select("id, account_id, amount, currency, status, reference")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Withdrawal request not found." }, { status: 404 });

  // Admin-only: role is already verified in assertStaff(). No per-user
  // scoping here — an admin can review any customer's withdrawal.

  const amount = Number(row.amount);
  const now = new Date().toISOString();

  if (action === "approve") {
    if (row.status !== "pending") {
      return NextResponse.json({ error: `Only pending requests can be approved (current: ${row.status}).` }, { status: 400 });
    }
    const { error } = await writer.from("withdrawal_requests")
      .update({ status: "approved", reviewed_by: user.id, reviewed_at: now, review_note: note || null, updated_at: now })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writer.from("customer_transactions")
      .update({ status: "approved" })
      .eq("account_id", row.account_id)
      .eq("reference", row.reference)
      .eq("type", "withdrawal");
    return NextResponse.json({ ok: true, status: "approved" });
  }

  if (action === "complete") {
    if (row.status !== "approved") {
      return NextResponse.json({ error: `Only approved requests can be completed (current: ${row.status}).` }, { status: 400 });
    }
    const { error } = await writer.from("withdrawal_requests")
      .update({ status: "completed", reviewed_by: user.id, reviewed_at: now, review_note: note || null, updated_at: now })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await writer.from("customer_transactions")
      .update({ status: "completed" })
      .eq("account_id", row.account_id)
      .eq("reference", row.reference)
      .eq("type", "withdrawal");
    return NextResponse.json({ ok: true, status: "completed" });
  }

  // reject | fail — return funds to the wallet.
  if (!["pending", "approved"].includes(row.status)) {
    return NextResponse.json({ error: `This request is ${row.status} and cannot be changed.` }, { status: 400 });
  }

  const { data: account } = await writer.from("customer_accounts").select("balance").eq("id", row.account_id).single();
  const balance = Number((account as { balance: number } | null)?.balance || 0);
  const restored = Math.round((balance + amount) * 100) / 100;

  const nextStatus = action === "reject" ? "rejected" : "failed";

  const { error: updateError } = await writer.from("withdrawal_requests")
    .update({ status: nextStatus, reviewed_by: user.id, reviewed_at: now, review_note: note || null, updated_at: now })
    .eq("id", id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await writer.from("customer_transactions")
    .update({ status: nextStatus })
    .eq("account_id", row.account_id)
    .eq("reference", row.reference)
    .eq("type", "withdrawal");

  const { error: balanceError } = await writer.from("customer_accounts")
    .update({ balance: restored, updated_at: now })
    .eq("id", row.account_id);
  if (balanceError) return NextResponse.json({ error: balanceError.message }, { status: 500 });

  return NextResponse.json({ ok: true, status: nextStatus, balance: restored });
}
