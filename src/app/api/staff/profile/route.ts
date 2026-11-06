import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Update the signed-in staff member's display name and phone number. */
export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { username?: unknown; phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (username.length < 3) return NextResponse.json({ error: "Display name must be at least 3 characters." }, { status: 400 });
  if (phone.length < 7) return NextResponse.json({ error: "Enter a valid phone number." }, { status: 400 });

  const { error } = await supabase.from("profiles").update({ username, phone }).eq("id", user.id);
  if (error) return NextResponse.json({ error: `Could not save your profile: ${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, username, phone });
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data, error } = await supabase.from("profiles").select("username, phone, role, balance, referral_code").eq("id", user.id).single();
  if (error) {
    if (error.message.includes("referral_code")) {
      return NextResponse.json({ error: "Referral setup is incomplete. Run supabase/referrals-migration.sql in Supabase, then restart the app." }, { status: 503 });
    }
    return NextResponse.json({ error: `Could not load staff profile: ${error.message}` }, { status: 500 });
  }
  if (!data || !["admin", "sub_admin"].includes(data.role)) {
    return NextResponse.json({ error: "Your account is not assigned an admin or sub-admin role." }, { status: 403 });
  }
  let referralCode = data.referral_code;
  if (data.role === "sub_admin" && !referralCode) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && serviceKey) {
      const adminClient = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
      referralCode = randomBytes(6).toString("hex");
      const { error: updateError } = await adminClient.from("profiles").update({ referral_code: referralCode }).eq("id", user.id);
      if (updateError) return NextResponse.json({ error: "Could not create your referral link. Run supabase/referrals-migration.sql first." }, { status: 503 });
    }
  }
  if (data.role === "sub_admin" && !referralCode) {
    return NextResponse.json({ error: "Your referral link is not ready. Run supabase/referrals-migration.sql in Supabase first." }, { status: 503 });
  }
  return NextResponse.json({ ...data, referral_code: referralCode, balance: Number(data.balance || 0) });
}
