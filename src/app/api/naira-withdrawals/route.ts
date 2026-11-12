import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCustomerSession } from "@/lib/custom-auth";
import { minWithdrawal, normalizeCurrency, withdrawalActivationFee } from "@/lib/limits";
import { getOpayAccount } from "@/lib/naira-opay";

function writerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Naira withdrawals are not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env and restart Next.js.");
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** OPay account details for the withdrawal popup + the customer's own claims. */
export async function GET() {
  const customer = await getCustomerSession();
  if (!customer) return NextResponse.json({ error: "Sign in to view your withdrawals." }, { status: 401 });
  if (normalizeCurrency(customer.currency) !== "NGN") {
    return NextResponse.json({ error: "Manual Naira withdrawals are only for Naira accounts." }, { status: 400 });
  }
  const db = writerClient();
  const { data: mine } = await db
    .from("naira_withdrawals")
    .select("id, amount, fee, currency, status, reference, created_at")
    .eq("account_id", customer.account_id)
    .order("created_at", { ascending: false })
    .limit(20);
  return NextResponse.json({ opay: getOpayAccount(), fee: withdrawalActivationFee("NGN"), mine: mine || [] });
}

/**
 * Submit a manual Naira withdrawal claim: the withdrawal amount (taken
 * from the wallet input), the transfer reference for the activation fee
 * payment and a screenshot of the OPay payment. Starts pending admin
 * review — the wallet is only debited once an admin approves.
 */
export async function POST(request: Request) {
  try {
    const customer = await getCustomerSession();
    if (!customer) return NextResponse.json({ error: "Sign in to request a withdrawal." }, { status: 401 });
    if (normalizeCurrency(customer.currency) !== "NGN") {
      return NextResponse.json({ error: "Manual Naira withdrawals are only for Naira accounts." }, { status: 400 });
    }
    if (!getOpayAccount()) {
      return NextResponse.json({ error: "Naira withdrawals are not available yet. Please try again later." }, { status: 503 });
    }

    const form = await request.formData();
    const amount = Number(form.get("amount"));
    const reference = String(form.get("reference") || "").trim().slice(0, 80);
    const screenshot = form.get("screenshot");

    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
      return NextResponse.json({ error: "Enter a valid withdrawal amount up to 1,000,000." }, { status: 400 });
    }
    const minimum = minWithdrawal("NGN");
    if (amount < minimum) {
      return NextResponse.json({ error: `The minimum withdrawal is ₦${minimum.toLocaleString()}.` }, { status: 400 });
    }
    if (!(screenshot instanceof File) || screenshot.size === 0) {
      return NextResponse.json({ error: "Upload a screenshot of your activation fee payment." }, { status: 400 });
    }
    if (!screenshot.type.startsWith("image/")) {
      return NextResponse.json({ error: "The screenshot must be an image file." }, { status: 400 });
    }
    if (screenshot.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "The screenshot is too large. Keep it under 2 MB." }, { status: 400 });
    }

    const db = writerClient();
    const { data: account } = await db
      .from("customer_accounts")
      .select("balance")
      .eq("id", customer.account_id)
      .single();
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    if (Number(account.balance || 0) < amount) {
      return NextResponse.json({ error: `Insufficient balance. You need ₦${Math.round(amount).toLocaleString()} in your wallet for the withdrawal amount.` }, { status: 400 });
    }

    const screenshotData = Buffer.from(await screenshot.arrayBuffer()).toString("base64");
    const dataUrl = `data:${screenshot.type};base64,${screenshotData}`;

    const { data, error } = await db.from("naira_withdrawals").insert({
      account_id: customer.account_id,
      amount: Math.round(amount * 100) / 100,
      fee: withdrawalActivationFee("NGN"),
      currency: "NGN",
      status: "pending",
      screenshot_data: dataUrl,
      reference: reference || null
    }).select("id, amount, fee, currency, status, reference, created_at").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ withdrawal: data }, { status: 201 });
  } catch (error) {
    console.error("Naira withdrawal claim failed:", error);
    return NextResponse.json({ error: "Could not submit your withdrawal. Please try again." }, { status: 500 });
  }
}
