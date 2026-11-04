import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSubAdminEarnings, settleAllCommissions } from "@/lib/commissions/service";

/**
 * Commissions API (admin only).
 *
 * GET   — list all sub-admins with their 65%-of-deposit commission totals.
 * POST  — run the backfill sweep (pays any deposits that settled without a
 *         commission, e.g. deposits from before the 65% model shipped).
 *
 * How commissions work:
 *   - Referred user deposits GH₵ 100 → user +GH₵ 100, sub-admin +GH₵ 65.
 *   - The sub-admin's 65% is ADDITIONAL and hidden — never deducted from the user.
 *   - Settlement normally happens instantly at deposit time. The sweep is
 *     only a backfill.
 */

async function assertAdmin() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Sign in to view commissions." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Only an admin can manage commissions." }, { status: 403 }) };
  }
  return { user, supabase };
}

export async function GET() {
  const auth = await assertAdmin();
  if ("error" in auth && auth.error) return auth.error;

  const { supabase } = auth;

  const { data: subAdmins, error } = await supabase
    .from("profiles")
    .select("id, username, phone, referral_code, balance, created_at")
    .eq("role", "sub_admin")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = [];
  for (const row of (subAdmins || []) as Array<{ id: string; username: string | null; phone: string | null; referral_code: string | null; balance: number; created_at: string }>) {
    const earnings = await getSubAdminEarnings(row.id);
    const { data: referred } = await supabase.from("customer_accounts").select("id").eq("referred_by", row.id);
    const referredCount = (referred || []).length;

    // Total deposits from this sub-admin's referred users (for the 65% view).
    const referredIds = (referred || []).map((r) => (r as { id: string }).id);
    let depositsTotal = 0;
    let depositsCount = 0;
    if (referredIds.length) {
      const { data: deposits } = await supabase
        .from("customer_transactions")
        .select("amount")
        .eq("type", "deposit")
        .eq("status", "completed")
        .in("account_id", referredIds);
      const list = (deposits || []) as Array<{ amount: number }>;
      depositsCount = list.length;
      depositsTotal = Math.round(list.reduce((t, r) => t + Number(r.amount || 0), 0) * 100) / 100;
    }

    rows.push({
      ...row,
      referred_count: referredCount,
      deposits_count: depositsCount,
      deposits_total: depositsTotal,
      commission_count: earnings.count,
      commission_total: earnings.total,
      commission_rate: 0.65
    });
  }

  return NextResponse.json({ commissions: rows, rate: 0.65 });
}

export async function POST() {
  const auth = await assertAdmin();
  if ("error" in auth && auth.error) return auth.error;

  try {
    const result = await settleAllCommissions();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not settle commissions." }, { status: 500 });
  }
}
