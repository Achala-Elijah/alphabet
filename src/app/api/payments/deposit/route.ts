import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCustomerSession } from "@/lib/custom-auth";
import { PaymentError, type Currency, type DepositSubject } from "@/lib/payments/types";
import { createDeposit, paymentsClient, verifyAndSettle } from "@/lib/payments/service";
import { minDeposit, normalizeCurrency } from "@/lib/limits";
import { formatCustomerAmount } from "@/lib/currency";

type Wallet = { subject: DepositSubject; currency: Currency; email?: string | null; phone?: string | null };

/** Works for both signed-in staff (Supabase auth) and customers (custom cookie). */
async function resolveWallet(): Promise<Wallet | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("role, phone").eq("id", user.id).single();
    if (profile && (profile.role === "admin" || profile.role === "sub_admin")) {
      return { subject: { type: "staff", staffId: user.id }, currency: "GHS", phone: profile.phone };
    }
  }
  const customer = await getCustomerSession();
  if (customer) {
    return {
      subject: { type: "customer", accountId: customer.account_id },
      currency: customer.currency === "NGN" ? "NGN" : "GHS",
      email: customer.email,
      phone: customer.phone
    };
  }
  return null;
}

function errorResponse(reason: unknown) {
  if (reason instanceof PaymentError) return NextResponse.json({ error: reason.message }, { status: reason.status });
  console.error("Payment failed:", reason);
  return NextResponse.json({ error: "Could not process the payment. Try again." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const wallet = await resolveWallet();
    if (!wallet) return NextResponse.json({ error: "Sign in to make a deposit." }, { status: 401 });

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

    // Minimum deposit: GH₵ 50 (or the naira equivalent) per transaction.
    const minimum = minDeposit(wallet.currency);
    if (amount < minimum) {
      return NextResponse.json({ error: `The minimum deposit is ${formatCustomerAmount(minimum, normalizeCurrency(wallet.currency))}.` }, { status: 400 });
    }

    const isStaff = wallet.subject.type === "staff";
    // Staff deposits return to the staff wallet; customers stay on the customer wallet.
    const callbackUrl = `${new URL(request.url).origin}${isStaff ? "/sub-admin/wallet" : "/account?nav=wallet"}`;
    const result = await createDeposit({
      subject: wallet.subject,
      amount: Math.round(amount * 100) / 100,
      currency: wallet.currency,
      callbackUrl,
      customer: { email: wallet.email, phone: wallet.phone }
    });
    return NextResponse.json(result);
  } catch (reason) {
    return errorResponse(reason);
  }
}

/** Confirm a deposit that is still pending (used after a gateway redirect). */
export async function GET(request: Request) {
  try {
    const wallet = await resolveWallet();
    if (!wallet) return NextResponse.json({ error: "Sign in to view this deposit." }, { status: 401 });
    const reference = new URL(request.url).searchParams.get("reference");
    if (!reference) return NextResponse.json({ error: "A deposit reference is required." }, { status: 400 });
    const result = await verifyAndSettle(paymentsClient(), reference, wallet.subject);
    return NextResponse.json(result);
  } catch (reason) {
    return errorResponse(reason);
  }
}
