import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCustomerSession } from "@/lib/custom-auth";
import { minDeposit, normalizeCurrency } from "@/lib/limits";
import { getOpayAccount } from "@/lib/naira-opay";

function writerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Naira deposits are not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env and restart Next.js.");
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** OPay account details for the deposit popup + the customer's own claims. */
export async function GET() {
  const customer = await getCustomerSession();
  if (!customer) return NextResponse.json({ error: "Sign in to view your deposits." }, { status: 401 });
  if (normalizeCurrency(customer.currency) !== "NGN") {
    return NextResponse.json({ error: "Manual Naira deposits are only for Naira accounts." }, { status: 400 });
  }
  const db = writerClient();
  const { data: mine } = await db
    .from("naira_deposits")
    .select("id, amount, currency, status, reference, created_at")
    .eq("account_id", customer.account_id)
    .order("created_at", { ascending: false })
    .limit(20);
  return NextResponse.json({ opay: getOpayAccount(), mine: mine || [] });
}

/**
 * Submit a manual Naira deposit claim: amount + transfer reference +
 * a screenshot of the OPay transfer. Starts pending admin review.
 */
export async function POST(request: Request) {
  try {
    const customer = await getCustomerSession();
    if (!customer) return NextResponse.json({ error: "Sign in to make a deposit." }, { status: 401 });
    if (normalizeCurrency(customer.currency) !== "NGN") {
      return NextResponse.json({ error: "Manual Naira deposits are only for Naira accounts." }, { status: 400 });
    }
    if (!getOpayAccount()) {
      return NextResponse.json({ error: "Naira deposits are not available yet. Please try again later." }, { status: 503 });
    }

    const form = await request.formData();
    const amount = Number(form.get("amount"));
    const reference = String(form.get("reference") || "").trim().slice(0, 80);
    const screenshot = form.get("screenshot");

    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
      return NextResponse.json({ error: "Enter a valid amount up to 1,000,000." }, { status: 400 });
    }
    const minimum = minDeposit("NGN");
    if (amount < minimum) {
      return NextResponse.json({ error: `The minimum deposit is ₦${minimum.toLocaleString()}.` }, { status: 400 });
    }
    if (!(screenshot instanceof File) || screenshot.size === 0) {
      return NextResponse.json({ error: "Upload a screenshot of your transfer." }, { status: 400 });
    }
    if (!screenshot.type.startsWith("image/")) {
      return NextResponse.json({ error: "The screenshot must be an image file." }, { status: 400 });
    }
    if (screenshot.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "The screenshot is too large. Keep it under 2 MB." }, { status: 400 });
    }
    const screenshotData = Buffer.from(await screenshot.arrayBuffer()).toString("base64");
    const dataUrl = `data:${screenshot.type};base64,${screenshotData}`;

    const db = writerClient();
    const { data, error } = await db.from("naira_deposits").insert({
      account_id: customer.account_id,
      amount: Math.round(amount * 100) / 100,
      currency: "NGN",
      status: "pending",
      screenshot_data: dataUrl,
      reference: reference || null
    }).select("id, amount, currency, status, reference, created_at").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ deposit: data }, { status: 201 });
  } catch (error) {
    console.error("Naira deposit claim failed:", error);
    return NextResponse.json({ error: "Could not submit your deposit. Please try again." }, { status: 500 });
  }
}
