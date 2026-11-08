import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function writerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Naira deposits are not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env and restart Next.js.");
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Only an admin can review Naira deposits." }, { status: 403 }) };
  }
  return { user };
}

/** All manual Naira deposit claims, newest first, with customer + screenshot. */
export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth && auth.error) return auth.error;
  const db = writerClient();
  const { data, error } = await db
    .from("naira_deposits")
    .select("id, account_id, amount, currency, status, screenshot_data, reference, note, reviewed_at, created_at, customer_accounts(username, phone, email)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ deposits: data || [] });
}

/**
 * Review a claim. Approve credits the customer's Naira wallet and writes
 * the wallet ledger history; reject only marks it rejected. Either way the
 * claim leaves "pending", so it can never be reviewed twice.
 */
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth && auth.error) return auth.error;
    const user = auth.user;

    const body = await request.json() as { id?: string; action?: string };
    if (!body.id || !["approve", "reject"].includes(body.action || "")) {
      return NextResponse.json({ error: "A deposit id and an action of approve or reject are required." }, { status: 400 });
    }

    const db = writerClient();
    const { data: claim } = await db
      .from("naira_deposits")
      .select("id, account_id, amount, currency, status")
      .eq("id", body.id)
      .maybeSingle();
    if (!claim) return NextResponse.json({ error: "Deposit claim not found." }, { status: 404 });
    if (claim.status !== "pending") {
      return NextResponse.json({ error: "This claim has already been reviewed." }, { status: 409 });
    }

    const now = new Date().toISOString();
    if (body.action === "reject") {
      const { error } = await db.from("naira_deposits")
        .update({ status: "rejected", reviewed_by: user.id, reviewed_at: now })
        .eq("id", body.id)
        .eq("status", "pending");
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, status: "rejected" });
    }

    // Approve: credit wallet + ledger, then mark approved. The ledger row
    // is written first so a failed credit never leaves history without money.
    const { data: account } = await db.from("customer_accounts").select("balance").eq("id", claim.account_id).single();
    if (!account) return NextResponse.json({ error: "Customer account not found." }, { status: 404 });
    const amount = Number(claim.amount);
    const reference = `NGN-${body.id.slice(0, 8).toUpperCase()}`;
    const { error: ledgerError } = await db.from("customer_transactions").insert({
      account_id: claim.account_id,
      type: "deposit",
      amount,
      status: "completed",
      reference
    });
    if (ledgerError) return NextResponse.json({ error: ledgerError.message }, { status: 400 });

    const nextBalance = Math.round((Number(account.balance || 0) + amount) * 100) / 100;
    const { error: creditError } = await db.from("customer_accounts")
      .update({ balance: nextBalance, updated_at: now })
      .eq("id", claim.account_id);
    if (creditError) {
      await db.from("customer_transactions").delete().eq("reference", reference).eq("account_id", claim.account_id);
      return NextResponse.json({ error: creditError.message }, { status: 400 });
    }

    const { error: reviewError } = await db.from("naira_deposits")
      .update({ status: "approved", reviewed_by: user.id, reviewed_at: now, reference: reference })
      .eq("id", body.id)
      .eq("status", "pending");
    if (reviewError) return NextResponse.json({ error: reviewError.message }, { status: 400 });
    return NextResponse.json({ ok: true, status: "approved", balance: nextBalance });
  } catch (error) {
    console.error("Naira deposit review failed:", error);
    return NextResponse.json({ error: "Could not review the deposit." }, { status: 500 });
  }
}
