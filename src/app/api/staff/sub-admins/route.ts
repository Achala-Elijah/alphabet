import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function phoneIdentity(phone: string) {
  return `customer-${phone.replace(/\D/g, "")}@auth.betkiing.local`;
}

async function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: { user: actor } } = await supabase.auth.getUser();
  if (!actor) return { error: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", actor.id).single();
  if (profile?.role !== "admin") return { error: NextResponse.json({ error: "Only an admin can manage sub-admins." }, { status: 403 }) };
  return { supabase };
}

async function assignSubAdminProfile(adminClient: SupabaseClient, userId: string, username: string, phone: string) {
  const { data: existing } = await adminClient.from("profiles").select("referral_code").eq("id", userId).maybeSingle();
  const { error } = await adminClient.from("profiles").upsert(
  { id: userId, username, phone, role: "sub_admin", referral_code: existing?.referral_code || randomBytes(6).toString("base64url") },
    { onConflict: "id" }
  );
  return error;
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;
    const adminClient = await getAdminClient();
    if (!adminClient) return NextResponse.json({ error: "Sub-admin management is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server .env file and restart Next.js." }, { status: 503 });
    const { data, error } = await adminClient.from("profiles").select("id,username,phone,referral_code,created_at,updated_at").eq("role", "sub_admin").order("created_at", { ascending: false });
    if (error) {
      const missingReferralColumn = error.message.includes("profiles.referral_code") || error.message.includes("referral_code");
      return NextResponse.json({
        error: missingReferralColumn
          ? "Referral setup is incomplete. Run supabase/referrals-migration.sql in the Supabase SQL Editor, then refresh this page."
          : error.message
      }, { status: 400 });
    }
    return NextResponse.json({ subAdmins: data || [] });
  } catch (error) {
    console.error("Sub-admin list failed:", error);
    return NextResponse.json({ error: "Could not load sub-admins." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { username?: string; phone?: string; password?: string };
    const username = body.username?.trim().toLowerCase();
    const phone = body.phone?.trim();
    const password = body.password;
    if (!username || username.length < 3 || !phone || phone.length < 7 || !password || password.length < 6) {
      return NextResponse.json({ error: "Username, phone number, and a password of at least 6 characters are required." }, { status: 400 });
    }

    const auth = await requireAdmin();
    if ("error" in auth) return auth.error;

    const adminClient = await getAdminClient();
    if (!adminClient) return NextResponse.json({ error: "Sub-admin management is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server .env file and restart Next.js." }, { status: 503 });
    const email = phoneIdentity(phone);
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username, phone } });
    if (createError) {
      const duplicateEmail = createError.message.toLowerCase().includes("already been registered");
      if (duplicateEmail) {
        const { data: users, error: usersError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const existingUser = usersError ? null : users.users.find((user) => user.email === email);
        if (existingUser) {
          const profileError = await assignSubAdminProfile(adminClient, existingUser.id, username, phone);
          if (!profileError) return NextResponse.json({ username, repaired: true }, { status: 200 });
        }
      }
      return NextResponse.json({
        error: duplicateEmail
          ? "A staff account already exists, but its profile could not be repaired. Check Supabase Authentication > Users for this phone number."
          : createError.message
      }, { status: 400 });
    }
    if (!created.user) return NextResponse.json({ error: "Unable to create the account." }, { status: 400 });

    const profileError = await assignSubAdminProfile(adminClient, created.user.id, username, phone);
    if (profileError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      const missingReferralColumn = profileError.message.includes("referral_code");
      return NextResponse.json({
        error: missingReferralColumn
          ? "Referral setup is incomplete. Run supabase/referrals-migration.sql in the Supabase SQL Editor, then create the sub-admin again."
          : "The account was created but could not be assigned the sub-admin role."
      }, { status: 500 });
    }
    return NextResponse.json({ username }, { status: 201 });
  } catch (error) {
    console.error("Sub-admin creation failed:", error);
    return NextResponse.json({ error: "Could not create the sub-admin." }, { status: 500 });
  }
}
