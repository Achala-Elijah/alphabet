import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCustomerSession } from "@/lib/custom-auth";

/**
 * Customer withdrawal — manual-review mode with a mandatory activation fee.
 *
 * The fee is paid separately through checkout before any request is created.
 * After payment, settlement creates the reservation and withdrawal request.
 */

function writerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Withdrawals are not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env and restart Next.js.");
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(request: Request) {
  void request;
  return NextResponse.json({ error: "Withdrawals are created only after the activation fee is paid." }, { status: 400 });
}

/**
 * User cancels their own pending withdrawal.
 * Body: { reference }
 * Only `pending` requests can be cancelled. Funds are returned immediately.
 */
export async function DELETE(request: Request) {
  const customer = await getCustomerSession();
  if (!customer) return NextResponse.json({ error: "Sign in to withdraw." }, { status: 401 });

  let body: { reference?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  if (!reference) return NextResponse.json({ error: "A withdrawal reference is required." }, { status: 400 });

  const writer = writerClient();

  const { data: requestRow, error: fetchError } = await writer
    .from("withdrawal_requests")
    .select("id, amount, status")
    .eq("account_id", customer.account_id)
    .eq("reference", reference)
    .maybeSingle();

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!requestRow) return NextResponse.json({ error: "Withdrawal request not found." }, { status: 404 });
  if (requestRow.status !== "pending") {
    return NextResponse.json({ error: `This withdrawal is ${requestRow.status} and can no longer be cancelled.` }, { status: 400 });
  }

  const amount = Number(requestRow.amount);
  const balance = Number(customer.balance || 0);
  const restoredBalance = Math.round((balance + amount) * 100) / 100;

  const { error: updateError } = await writer
    .from("withdrawal_requests")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", requestRow.id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await writer.from("customer_transactions")
    .update({ status: "cancelled" })
    .eq("account_id", customer.account_id)
    .eq("reference", reference)
    .eq("type", "withdrawal");

  const { error: balanceError } = await writer
    .from("customer_accounts")
    .update({ balance: restoredBalance, updated_at: new Date().toISOString() })
    .eq("id", customer.account_id);

  if (balanceError) return NextResponse.json({ error: balanceError.message }, { status: 500 });

  return NextResponse.json({
    action: "withdrawal_cancelled",
    amount,
    balance: restoredBalance,
    reference,
    status: "cancelled"
  });
}
