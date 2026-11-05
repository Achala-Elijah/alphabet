import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { COMMISSION_RATE, normalizeCurrency } from "@/lib/limits";

/**
 * Commissions service — 65% of every referral deposit goes to the sub-admin.
 *
 * When a customer who joined via a sub-admin's referral link deposits:
 *   - User's wallet is credited 100% of the deposit (in paystack service).
 *   - Sub-admin earns ADDITIONAL 65% of that deposit on top.
 *   - The commission is hidden — the user never sees it.
 *
 * Example: referred user deposits GH₵ 100 → user +GH₵ 100, sub-admin +GH₵ 65.
 *
 * Trigger points:
 *   1. At deposit settle time (`settleDeposit` in payments/service.ts calls
 *      `handleDepositCommission()` right after crediting the user) — the
 *      common case.
 *   2. Admin sweep (POST /api/staff/commissions) — backfill for any deposits
 *      that settled before this code shipped.
 *
 * Idempotent — deposits.reference is unique in `commissions.reference`,
 * so a deposit can never pay a commission twice.
 */

let writer: SupabaseClient | undefined;

function commissionsClient(): SupabaseClient {
  if (writer === undefined) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("Commissions are not configured. Add SUPABASE_SERVICE_ROLE_KEY to .env and restart Next.js.");
    }
    writer = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  }
  return writer;
}

/** 65% of the deposit (in the wallet's currency). The user still gets 100%. */
export function calculateDepositCommission(depositAmount: number): number {
  return Math.round(depositAmount * COMMISSION_RATE * 100) / 100;
}

/**
 * Credit the sub-admin for one deposit. Called after the user's wallet
 * is already credited. Non-blocking — a commission failure never fails
 * the deposit itself.
 */
export async function handleDepositCommission(args: {
  accountId: string;
  depositAmount: number;
  currency: string;
  depositReference: string;
}): Promise<{ amount: number; subAdminId: string | null }> {
  const { accountId, depositAmount, currency, depositReference } = args;
  const normalizedCurrency = normalizeCurrency(currency);
  const commission = calculateDepositCommission(depositAmount);

  if (commission <= 0) return { amount: 0, subAdminId: null };

  let db: SupabaseClient;
  try {
    db = commissionsClient();
  } catch {
    return { amount: 0, subAdminId: null };
  }

  // Who referred this user?
  const { data: account } = await db
    .from("customer_accounts")
    .select("referred_by, currency")
    .eq("id", accountId)
    .maybeSingle();

  const subAdminId = (account as { referred_by: string | null } | null)?.referred_by;
  if (!subAdminId) return { amount: 0, subAdminId: null };

  // Insert commission row (reference = deposit reference → unique, idempotent).
  const { error: insertError } = await db.from("commissions").insert({
    user_id: accountId,
    sub_admin_id: subAdminId,
    amount: commission,
    currency: normalizedCurrency,
    status: "completed",
    reference: `DEPCOM-${depositReference}`,
    deposit_reference: depositReference,
    // type is a plain text column: "deposit_commission"
    type: "deposit_commission"
  });

  if (insertError) {
    // "Could not find the table" = migration not run yet, or the PostgREST
    // schema cache hasn't refreshed. Silent no-op — never block the deposit.
    if (insertError.message.includes("Could not find the table") || insertError.message.includes("schema cache")) {
      return { amount: 0, subAdminId };
    }
    // Duplicate = already paid for this deposit. Nothing to do.
    if (insertError.message.includes("duplicate") || insertError.message.includes("unique")) {
      return { amount: 0, subAdminId };
    }
    return { amount: 0, subAdminId };
  }

  // Credit the sub-admin staff wallet (additional, hidden).
  const { data: profile } = await db.from("profiles").select("balance").eq("id", subAdminId).maybeSingle();
  const balance = Number((profile as { balance: number } | null)?.balance || 0);
  const next = Math.round((balance + commission) * 100) / 100;
  const { error: updateError } = await db
    .from("profiles")
    .update({ balance: next, updated_at: new Date().toISOString() })
    .eq("id", subAdminId);

  if (updateError) {
    // Roll back the commission row so a retry can re-credit.
    await db.from("commissions").delete().eq("reference", `DEPCOM-${depositReference}`);
    console.error(`Commission wallet credit failed for ${depositReference}:`, updateError.message);
    return { amount: 0, subAdminId };
  }

  return { amount: commission, subAdminId };
}

/**
 * Settle commissions for every sub-admin — backfill sweep.
 * Finds deposits with no matching commission reference and pays them.
 *
 * (Kept for the admin page; the normal path is per-deposit at settle time.)
 */
export async function settleAllCommissions(): Promise<{
  deposits_checked: number;
  commissions_paid: number;
  total_amount: number;
}> {
  const db = commissionsClient();

  // All paid deposits for referred users.
  const { data: paid } = await db
    .from("deposits")
    .select("reference, account_id, amount, currency, provider_payload")
    .eq("provider", "payments")
    .eq("status", "paid");

  const paidDeposits = ((paid || []) as Array<{
    reference: string;
    account_id: string | null;
    amount: number;
    currency: string;
    provider_payload?: { purpose?: string } | null;
  }>).filter((deposit) => deposit.provider_payload?.purpose !== "withdrawal_activation_fee");

  if (!paidDeposits.length) return { deposits_checked: 0, commissions_paid: 0, total_amount: 0 };

  // Already-commissioned deposit references.
  const { data: existing } = await db
    .from("commissions")
    .select("deposit_reference")
    .not("deposit_reference", "is", null);

  const alreadyDone = new Set(
    ((existing || []) as Array<{ deposit_reference: string | null }>)
      .map((r) => r.deposit_reference)
      .filter((v): v is string => Boolean(v))
  );

  let commissionsPaid = 0;
  let totalAmount = 0;

  for (const deposit of paidDeposits) {
    if (!deposit.account_id || alreadyDone.has(deposit.reference)) continue;
    const result = await handleDepositCommission({
      accountId: deposit.account_id,
      depositAmount: Number(deposit.amount),
      currency: deposit.currency,
      depositReference: deposit.reference
    });
    if (result.amount > 0) {
      commissionsPaid++;
      totalAmount = Math.round((totalAmount + result.amount) * 100) / 100;
    }
  }

  return { deposits_checked: paidDeposits.length, commissions_paid: commissionsPaid, total_amount: totalAmount };
}

/** Total deposit commissions earned by a sub-admin. */
export async function getSubAdminEarnings(subAdminId: string): Promise<{ count: number; total: number }> {
  const db = commissionsClient();
  const { data } = await db
    .from("commissions")
    .select("amount")
    .eq("sub_admin_id", subAdminId)
    .eq("status", "completed");
  const rows = (data || []) as Array<{ amount: number }>;
  return {
    count: rows.length,
    total: Math.round(rows.reduce((t, r) => t + Number(r.amount || 0), 0) * 100) / 100
  };
}
