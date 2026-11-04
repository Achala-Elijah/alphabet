import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCustomerSession } from "@/lib/custom-auth";
import { generateBookingCode, normalizeBookingCode, isValidBookingCode } from "@/lib/bet-slip";

function writerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Booking codes are not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env and restart Next.js.");
  }
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * POST /api/booking-codes
 * Body: { selections: BetSlipSelection[], stake: string }
 *
 * Creates a shareable booking code for the current bet slip. Returns the
 * code (e.g. ABX7K2P). Codes expire after 7 days.
 */
export async function POST(request: Request) {
  try {
    let body: { selections?: unknown; stake?: unknown };
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const selections = Array.isArray(body.selections) ? body.selections : [];
    const stake = typeof body.stake === "string" ? body.stake : "150";

    if (selections.length === 0) {
      return NextResponse.json({ error: "Add at least one selection before sharing your bet slip." }, { status: 400 });
    }
    if (selections.length > 50) {
      return NextResponse.json({ error: "Your bet slip is too large to share." }, { status: 400 });
    }

    const customer = await getCustomerSession();
    const writer = writerClient();

    // Generate a unique code (retry on the tiny chance of a collision).
    let code = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      code = generateBookingCode();
      const { data: existing } = await writer.from("booking_codes").select("id").eq("code", code).maybeSingle();
      if (!existing) break;
      if (attempt === 4) return NextResponse.json({ error: "Could not generate a booking code. Try again." }, { status: 500 });
    }

    const { error } = await writer.from("booking_codes").insert({
      code,
      selections,
      stake: Math.max(0, Number(stake) || 0),
      created_by: customer ? null : null
    });

    if (error) {
      const missingTable = error.message.includes("booking_codes");
      return NextResponse.json({
        error: missingTable
          ? "Booking codes are not set up yet. Run supabase/booking-codes-migration.sql in the Supabase SQL Editor."
          : error.message
      }, { status: 500 });
    }

    return NextResponse.json({ code, expiresInDays: 7 }, { status: 201 });
  } catch (error) {
    console.error("Booking code creation failed:", error);
    return NextResponse.json({ error: "Could not create a booking code. Try again." }, { status: 500 });
  }
}

/**
 * GET /api/booking-codes?code=ABX7K2P
 *
 * Loads a bet slip by its booking code. Expired or unknown codes return 404.
 * Does not require sign-in — the code is the authorization.
 */
export async function GET(request: Request) {
  try {
    const rawCode = new URL(request.url).searchParams.get("code") || "";
    if (!isValidBookingCode(rawCode)) {
      return NextResponse.json({ error: "Enter a valid booking code (e.g. ABX7K2P)." }, { status: 400 });
    }
    const code = normalizeBookingCode(rawCode);
    const writer = writerClient();

    const { data, error } = await writer
      .from("booking_codes")
      .select("code, selections, stake, created_at, expires_at")
      .eq("code", code)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error) {
      const missingTable = error.message.includes("booking_codes");
      return NextResponse.json({
        error: missingTable
          ? "Booking codes are not set up yet. Run supabase/booking-codes-migration.sql in the Supabase SQL Editor."
          : error.message
      }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "This booking code was not found or has expired." }, { status: 404 });
    }

    return NextResponse.json({
      code: data.code,
      selections: data.selections,
      stake: String(data.stake || "150"),
      createdAt: data.created_at,
      expiresAt: data.expires_at
    });
  } catch (error) {
    console.error("Booking code load failed:", error);
    return NextResponse.json({ error: "Could not load this booking code. Try again." }, { status: 500 });
  }
}
