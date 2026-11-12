import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSubAdminEarnings, getSubAdminCommissionRows, settleAllCommissions } from "@/lib/commissions/service";

/**
 * Commissions API.
 *
 * GET   /api/staff/commissions?from=2026-01-01&to=2026-01-31
 *       Admin       → per-sub-admin summary (existing shape), optionally
 *                     filtered by date range (created_at).
 *       Sub-admin   → their own commission rows + totals, same date params.
 *
 * POST  (admin only) — backfill sweep for unpaid deposit commissions.
 *
 * How commissions work:
 *   Referred user deposits GH₵ 100 → user +GH₵ 100, sub-admin +GH₵ 65.
 *   The sub-admin's 65% is ADDITIONAL and hidden — never deducted from the user.
 */

async function assertStaff() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Sign in to view commissions." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("id, role, username").eq("id", user.id).single();
  if (!profile) return { error: NextResponse.json({ error: "Profile not found." }, { status: 401 }) };
  if (profile.role !== "admin" && profile.role !== "sub_admin") {
    return { error: NextResponse.json({ error: "Only staff can view commissions." }, { status: 403 }) };
  }
  return { user, supabase, profile };
}

export async function GET(request: Request) {
  const auth = await assertStaff();
  if ("error" in auth && auth.error) return auth.error;
  const { profile, supabase } = auth;

  const url = new URL(request.url);
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;

  // Sub-admin view — own commissions, date-filtered.
  if (profile.role === "sub_admin") {
    const { rows, total_count, total_amount } = await getSubAdminCommissionRows(profile.id, from, to);

    // Attach customer name/phone for the table.
    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
    const { data: users } = userIds.length
      ? await supabase.from("customer_accounts").select("id, username, phone").in("id", userIds)
      : { data: [] };
    const userMap = new Map(
      (users || []).map((u) => [u.id, u] as const)
    );

    return NextResponse.json({
      scope: "self",
      from: from || null,
      to: to || null,
      rate: 0.65,
      rows: rows.map((r) => ({
        ...r,
        username: userMap.get(r.user_id)?.username ?? null,
        phone: userMap.get(r.user_id)?.phone ?? null
      })),
      total_count,
      total_amount
    });
  }

  // Admin view — per-sub-admin summary, optional date range.
  const { data: subAdmins, error } = await supabase
    .from("profiles")
    .select("id, username, phone, referral_code, balance, created_at")
    .eq("role", "sub_admin")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = [];
  for (const row of (subAdmins || []) as Array<{ id: string; username: string | null; phone: string | null; referral_code: string | null; balance: number; created_at: string }>) {
    const earnings = await getSubAdminEarnings(row.id, from, to);
    const { data: referred } = await supabase.from("customer_accounts").select("id, created_at").eq("referred_by", row.id);
    const referredRows = (referred || []) as Array<{ id: string; created_at: string }>;
    const referredCount = referredRows.length;

    const referredIds = referredRows.map((r) => r.id);
    let depositsTotal = 0;
    let depositsCount = 0;
    if (referredIds.length) {
      let depositsQuery = supabase
        .from("customer_transactions")
        .select("amount")
        .eq("type", "deposit")
        .eq("status", "completed")
        .in("account_id", referredIds);
      if (from) depositsQuery = depositsQuery.gte("created_at", `${from}T00:00:00`);
      if (to) depositsQuery = depositsQuery.lte("created_at", `${to}T23:59:59.999`);
      const { data: deposits } = await depositsQuery;
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

  return NextResponse.json({ commissions: rows, rate: 0.65, scope: "all", from: from || null, to: to || null });
}

export async function POST() {
  const auth = await assertStaff();
  if ("error" in auth && auth.error) return auth.error;
  if (auth.profile.role !== "admin") {
    return NextResponse.json({ error: "Only an admin can run the commission backfill." }, { status: 403 });
  }

  try {
    const result = await settleAllCommissions();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not settle commissions." }, { status: 500 });
  }
}