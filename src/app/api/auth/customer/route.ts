import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createCustomerSession, getCustomerSession, COOKIE, hashToken } from "@/lib/custom-auth";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("username,phone,role,balance").eq("id", user.id).single();
    if (profile && ["admin", "sub_admin"].includes(profile.role)) {
      return NextResponse.json({
        username: profile.username || profile.phone || "Staff",
        balance: Number(profile.balance || 0),
        currency: "GHS",
        role: profile.role,
        staff: true
      });
    }
  }
  const session = await getCustomerSession();
  if (session) return NextResponse.json(session);
  return NextResponse.json(null, { status: 401 });
}

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  return createClient(url, key);
}
export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; username?: string; phone?: string; password?: string; referralCode?: string | null };
    const phone = body.phone?.trim() || "";
    const password = body.password || "";
    if (body.action === "register") {
      if (!body.username?.trim() || phone.length < 7 || password.length < 6) return NextResponse.json({ error: "Enter a username, valid phone number, and password of at least 6 characters." }, { status: 400 });
      const { error } = await db().rpc("customer_register", { p_username: body.username, p_phone: phone, p_password: password, p_referral_code: body.referralCode || null });
      if (error) {
        const setupMissing = error.message.includes("Could not find the function") || error.message.includes("customer_register");
        return NextResponse.json({
          error: setupMissing
            ? "Customer authentication is not set up in Supabase yet. Run supabase/customer-auth-migration.sql in the SQL Editor."
            : error.message
        }, { status: 400 });
      }
      await createCustomerSession(phone, password);
      return NextResponse.json({ ok: true }, { status: 201 });
    }
    if (body.action === "login") {
      if (!phone || !password) return NextResponse.json({ error: "Enter your phone number and password." }, { status: 400 });
      await createCustomerSession(phone, password);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "logout") {
      const token = (await cookies()).get(COOKIE)?.value;
      if (token) await db().rpc("customer_logout", { p_token_hash: hashToken(token) });
      const response = NextResponse.json({ ok: true });
      response.cookies.delete(COOKIE);
      response.cookies.delete("betkiing_session");
      return response;
    }
    return NextResponse.json({ error: "Unknown authentication action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Authentication failed." }, { status: 400 });
  }
}
