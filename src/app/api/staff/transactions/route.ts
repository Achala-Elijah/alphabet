import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * customer_transactions has only a SELECT policy for staff — there is no
 * UPDATE policy, so the normal logged-in client silently updates 0 rows.
 * Writes must go through the service-role client (same pattern as
 * /api/staff/withdrawals), which bypasses RLS.
 */
function writerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Transaction flags are not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env and restart Next.js.");
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["admin", "sub_admin"].includes(profile.role)) return NextResponse.json({ error: "Only staff can view transactions." }, { status: 403 });
  let accountsQuery = supabase.from("customer_accounts").select("id,username");
  if (profile.role === "sub_admin") accountsQuery = accountsQuery.eq("referred_by", user.id);
  const { data: accountRows } = await accountsQuery;
  const accountIds = (accountRows || []).map((account) => account.id);
  const transactionQuery = accountIds.length
    ? supabase.from("customer_transactions").select("id,account_id,type,amount,status,reference,created_at").in("account_id", accountIds).order("created_at", { ascending: false })
    : supabase.from("customer_transactions").select("id,account_id,type,amount,status,reference,created_at").eq("id", "00000000-0000-0000-0000-000000000000");
  const accountLookupQuery = supabase.from("customer_accounts").select("id,username").in("id", accountIds.length ? accountIds : ["00000000-0000-0000-0000-000000000000"]);
  const [{ data: transactions, error }, { data: accounts }] = await Promise.all([transactionQuery, accountLookupQuery]);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ transactions: transactions || [], accounts: Object.fromEntries((accounts || []).map((account) => [account.id, account.username])) });
}

/** Statuses the admin may force on a transaction. */
const FLAGGED_STATUSES = ["failed", "paid", "completed", "pending"] as const;

/**
 * "paid" / "completed" both mean "successful" — deposits settle as `paid`,
 * every other type (withdrawals, activation fees) settles as `completed`.
 */
function successStatusFor(type: string): "paid" | "completed" {
  return type === "deposit" || type === "deposit_bonus" ? "paid" : "completed";
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: string; status?: string };
    if (!body.id || !body.status || !FLAGGED_STATUSES.includes(body.status as (typeof FLAGGED_STATUSES)[number])) {
      return NextResponse.json({ error: "A transaction id and a status of failed, paid, completed, or pending are required." }, { status: 400 });
    }
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") return NextResponse.json({ error: "Only an admin can change transaction statuses." }, { status: 403 });
    // Read the row's real type so a generic "successful" flag settles to the
    // status this transaction type actually uses (deposits → paid, rest →
    // completed) and the ledger stays honest.
    const { data: row } = await supabase
      .from("customer_transactions")
      .select("id, type")
      .eq("id", body.id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    const status = body.status === "failed" ? "failed" : body.status === "pending" ? "pending" : successStatusFor(row.type || "");
    const writer = writerClient();
    const { data: updated, error } = await writer
      .from("customer_transactions")
      .update({ status })
      .eq("id", body.id)
      .select("id, status")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!updated) return NextResponse.json({ error: "Transaction could not be updated." }, { status: 409 });
    return NextResponse.json({ ok: true, status: updated.status });
  } catch (error) {
    console.error("Transaction status update failed:", error);
    return NextResponse.json({ error: "Could not update transaction status." }, { status: 500 });
  }
}
