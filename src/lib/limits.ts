/**
 * Money limits shared by the API routes and the UI, so a number shown to the
 * user can never drift from the number the server enforces.
 *
 * Naira values are the GHS amounts converted at GHS_TO_NGN — the one exchange
 * rate used across the app.
 */
export const GHS_TO_NGN = 100;

/** Minimum single deposit: GH₵ 50 / ₦5,000. Withdrawal flow statuses documented in withdrawal_requests migration. */
export const MIN_DEPOSIT_GHS = 50;
/** Minimum single withdrawal: GH₵ 50 / ₦5,000. */
export const MIN_WITHDRAWAL_GHS = 50;
/** Minimum stake for a single bet: GH₵ 150 / ₦15,000. */
export const MIN_STAKE_GHS = 150;

/**
 * Sub-admin commissions on deposits (65% of every referral deposit).
 *
 * When a customer who joined via a sub-admin's referral link makes a deposit,
 * the sub-admin earns an ADDITIONAL 65% of that deposit on top — the user's
 * wallet is still credited 100% of the deposit. The commission is "hidden":
 * the user never sees it, and their balance is never reduced.
 *
 * Example: referred user deposits GH₵ 100 → user gets +GH₵ 100, sub-admin
 * gets +GH₵ 65. The 65% is platform subsidy (your cost), not a split of the
 * user's money.
 *
 * Rule:
 *   commission = deposit_amount * COMMISSION_RATE
 *   COMMISSION_RATE = 0.65
 *
 * Enforced in `src/lib/commissions/service.ts` →
 * `calculateDepositCommission()`. The amount is logged to `commissions`
 * table with `type='deposit_commission'` and the staff wallet is credited.
 * Idempotent — one commission row per deposit reference.
 */
export const COMMISSION_RATE = 0.65;

/** Minimum deposit the commission applies to (same as min deposit). */
export const COMMISSION_MIN_DEPOSIT_GHS = 50;

/** Deprecated: flat per-activation fee was replaced by 65% of deposit. */
export const COMMISSION_PER_ACTIVE_USER_GHS = 5;

function inCurrency(ghs: number, currency?: string | null) {
  return currency === "NGN" ? ghs * GHS_TO_NGN : ghs;
}

/** Minimum deposit for this wallet's currency. */
export function minDeposit(currency?: string | null) {
  return inCurrency(MIN_DEPOSIT_GHS, currency);
}

/** Minimum withdrawal for this wallet's currency. */
export function minWithdrawal(currency?: string | null) {
  return inCurrency(MIN_WITHDRAWAL_GHS, currency);
}

/** Minimum stake for this wallet's currency. */
export function minStake(currency?: string | null) {
  return inCurrency(MIN_STAKE_GHS, currency);
}

/** Normalize a currency string to the two supported codes. */
export function normalizeCurrency(currency?: string | null): "GHS" | "NGN" {
  return currency === "NGN" ? "NGN" : "GHS";
}
