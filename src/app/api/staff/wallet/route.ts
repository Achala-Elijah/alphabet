import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";
import { minWithdrawal } from "@/lib/limits";

function newReference() {
  return `WDR-${Date.now().toString(36).toUpperCase()}${randomBytes(4).toString("hex").toUpperCase()}`;
}

/**
 * Staff withdrawals.
 *
 * Deposits go through /api/payments/deposit (Paystack hosted checkout).
 * Staff withdrawals are instant — staff wallets are internal operational
 * balances, not customer wallets, so they don't need manual review.
 * The manual-review flow (withdrawal_requests) only applies to customers.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to use your wallet." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role, balance").eq("id", user.id).single();
  if (!profile || !["admin", "sub_admin"].includes(profile.role)) {
    return NextResponse.json({ error: "Only staff accounts can use this wallet." }, { status: 403 });
  }

  let body: { action?: unknown; amount?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  if (body.action !== "withdrawal") {
    return NextResponse.json({ error: "Deposits are processed through the payment checkout. Only withdrawals are handled here." }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
    return NextResponse.json({ error: "Enter an amount between GH₵ 0.01 and GH₵ 1,000,000.00." }, { status: 400 });
  }
  const rounded = Math.round(amount * 100) / 100;
  const minimum = minWithdrawal("GHS");
  if (rounded < minimum) {
    return NextResponse.json({ error: `The minimum withdrawal is GH₵ ${minimum.toFixed(2)}.` }, { status: 400 });
  }
  const balance = Number(profile.balance || 0);
  if (rounded > balance) {
    return NextResponse.json({ error: `Insufficient balance. You have GH₵ ${balance.toFixed(2)}.` }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const writer = url && serviceKey ? createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } }) : supabase;
  const reference = newReference();

  const { data: inserted, error: insertError } = await writer
    .from("transactions")
    .insert({ user_id: user.id, type: "withdrawal", amount: rounded, status: "completed", reference })
    .select("id")
    .single();
  if (insertError) {
    const blocked = insertError.message.includes("row-level security");
    return NextResponse.json({ error: blocked ? "Your wallet cannot record this transaction yet." : `Could not record the withdrawal: ${insertError.message}` }, { status: 500 });
  }

  const nextBalance = Math.round((balance - rounded) * 100) / 100;
  const { error: updateError } = await writer.from("profiles").update({ balance: nextBalance, updated_at: new Date().toISOString() }).eq("id", user.id);
  if (updateError) {
    await writer.from("transactions").delete().eq("id", inserted.id);
    return NextResponse.json({ error: `Could not update your balance: ${updateError.message}` }, { status: 500 });
  }

  return NextResponse.json({ action: "withdrawal", amount: rounded, balance: nextBalance, reference });
}
