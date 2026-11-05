import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/custom-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PaymentError } from "@/lib/payments/types";
import { createWithdrawalActivationPayment } from "@/lib/payments/service";
import { minWithdrawal, normalizeCurrency, withdrawalActivationFee } from "@/lib/limits";
import { formatCustomerAmount } from "@/lib/currency";

export async function POST(request: Request) {
  const customer = await getCustomerSession();
  if (!customer) return NextResponse.json({ error: "Sign in to activate a withdrawal." }, { status: 401 });

  let body: { amount?: unknown; activationFeeConsent?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return NextResponse.json({ error: "Enter a valid withdrawal amount up to 1,000,000." }, { status: 400 });
  }
  const intended = Math.round(amount * 100) / 100;
  const currency = normalizeCurrency(customer.currency);
  const fee = withdrawalActivationFee(currency);
  const minimum = minWithdrawal(currency);

  if (body.activationFeeConsent !== true) {
    return NextResponse.json({ error: `A ${formatCustomerAmount(fee, currency)} activation fee is required for every withdrawal.` }, { status: 400 });
  }
  if (intended < minimum) {
    return NextResponse.json({ error: `The minimum withdrawal is ${formatCustomerAmount(minimum, currency)}.` }, { status: 400 });
  }
  if (intended > Number(customer.balance || 0)) {
    return NextResponse.json({
      error: `Insufficient balance. You need ${formatCustomerAmount(intended, currency)} in your wallet for the withdrawal amount.`
    }, { status: 400 });
  }

  const callbackUrl = `${new URL(request.url).origin}/account?nav=wallet`;
  try {
    const result = await createWithdrawalActivationPayment({
      subject: { type: "customer", accountId: customer.account_id },
      amount: intended,
      currency,
      callbackUrl,
      customer: { email: customer.email, phone: customer.phone }
    });
    return NextResponse.json(result);
  } catch (reason) {
    if (reason instanceof PaymentError) return NextResponse.json({ error: reason.message }, { status: reason.status });
    console.error("Withdrawal activation payment failed:", reason);
    return NextResponse.json({ error: "Could not start the activation fee payment. Try again." }, { status: 500 });
  }
}
