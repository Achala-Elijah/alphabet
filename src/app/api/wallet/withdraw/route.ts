import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { getCustomerSession } from "@/lib/custom-auth";
import { minWithdrawal, normalizeCurrency } from "@/lib/limits";
import { formatCustomerAmount } from "@/lib/currency";

/**
 * Customer withdrawal — manual-review mode.
 *
 * Old instant-withdraw behavior is replaced with a request/approval flow:
 *
 *   1. User requests a withdrawal.
 *      - Validates amount (min, max, balance).
 *      - Reserves funds: balance is debited immediately.
 *      - Inserts a `withdrawal_requests` row with status `pending`.
 *      - Inserts a `customer_transactions` row: type=`withdrawal`, status=`pending`.
 *      - Returns `{ status: "pending", reference }` — user sees "processing".
 *
 *   2. Staff reviews in /sub-admin/withdrawals.
 *      - Approve: status -> `approved` (payout sent manually via MoMo/bank).
 *      - Reject: status -> `rejected`, funds returned to wallet, refund row written.
 *      - Mark completed: status -> `completed`.
 *
 *   3. User can cancel a pending request (status -> `cancelled`, funds returned).
 *
 * No automatic Paystack transfer is performed here. Payouts are sent manually
 * by staff after approval (bank transfer / MoMo). The optional Paystack
 * Transfers API (PAYSTACK_TRANSFERS_ENABLED=true) is preserved for future
 * automation — it is NOT used in this flow.
 */

function newReference() {
  return `WDR-${Date.now().toString(36).toUpperCase()}${randomBytes(4).toString("hex").toUpperCase()}`;
}

function writerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Withdrawals are not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env and restart Next.js.");
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(request: Request) {
  const customer = await getCustomerSession();
  if (!customer) return NextResponse.json({ error: "Sign in to withdraw." }, { status: 401 });

  let body: { amount?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
    return NextResponse.json({ error: "Enter a valid amount up to 1,000,000." }, { status: 400 });
  }
  const rounded = Math.round(amount * 100) / 100;
  const currency = normalizeCurrency(customer.currency);
  const minimum = minWithdrawal(currency);

  if (rounded < minimum) {
    return NextResponse.json({
      error: `The minimum withdrawal is ${formatCustomerAmount(minimum, currency)}.`
    }, { status: 400 });
  }

  const balance = Number(customer.balance || 0);
  if (rounded > balance) {
    return NextResponse.json({
      error: `Insufficient balance. You have ${formatCustomerAmount(balance, currency)}.`
    }, { status: 400 });
  }

  const reference = newReference();
  const writer = writerClient();

  // Reserve funds: create the debit row first, then update the balance.
  // If the balance update fails we remove the row so nothing is stranded.
  const { data: withdrawalRow, error: insertError } = await writer
    .from("customer_transactions")
    .insert({
      account_id: customer.account_id,
      type: "withdrawal",
      amount: rounded,
      status: "pending",
      reference
    })
    .select("id")
    .single();

  if (insertError || !withdrawalRow) {
    const missingTable = insertError?.message.includes("withdrawal_requests") ||
      insertError?.message.includes("customer_transactions");
    return NextResponse.json({
      error: missingTable
        ? "Withdrawals are not set up yet. Run supabase/withdrawal-requests-migration.sql in the Supabase SQL Editor."
        : insertError?.message || "Could not record the withdrawal."
    }, { status: 500 });
  }

  const nextBalance = Math.round((balance - rounded) * 100) / 100;
  const { error: updateError } = await writer
    .from("customer_accounts")
    .update({ balance: nextBalance, updated_at: new Date().toISOString() })
    .eq("id", customer.account_id);

  if (updateError) {
    await writer.from("customer_transactions").delete().eq("id", withdrawalRow.id);
    return NextResponse.json({ error: `Could not update your balance: ${updateError.message}` }, { status: 500 });
  }

  // Record the withdrawal request for staff review.
  const { error: requestError } = await writer
    .from("withdrawal_requests")
    .insert({
      account_id: customer.account_id,
      amount: rounded,
      currency,
      status: "pending",
      reference
    });

  if (requestError) {
    // Roll back the reservation so funds go back to the user.
    await writer.from("customer_transactions").delete().eq("id", withdrawalRow.id);
    await writer.from("customer_accounts")
      .update({ balance, updated_at: new Date().toISOString() })
      .eq("id", customer.account_id);
    const missingTable = requestError.message.includes("withdrawal_requests");
    return NextResponse.json({
      error: missingTable
        ? "Withdrawals are not set up yet. Run supabase/withdrawal-requests-migration.sql in the Supabase SQL Editor."
        : `Could not create the withdrawal request: ${requestError.message}`
    }, { status: 500 });
  }

  return NextResponse.json({
    action: "withdrawal_requested",
    amount: rounded,
    balance: nextBalance,
    reference,
    status: "pending",
    // No automatic payout — staff review is required.
    message: `Your withdrawal request of ${formatCustomerAmount(rounded, currency)} is pending. Our team will process it and contact you.`
  });
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

  // Mark cancelled, return funds, update transaction row.
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
