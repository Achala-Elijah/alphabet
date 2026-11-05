import { formatCustomerAmount } from "./currency";

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
/** Minimum single withdrawal: GH₵ 1,000 / ₦100,000. */
export const MIN_WITHDRAWAL_GHS = 1000;
/** Per-withdrawal activation charge: GH₵ 200 / ₦20,000. */
export const WITHDRAWAL_ACTIVATION_FEE_GHS = 200;
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

/** Activation fee charged on every customer withdrawal: GH₵200 / ₦20,000. */
export function withdrawalActivationFee(currency?: string | null) {
  return inCurrency(WITHDRAWAL_ACTIVATION_FEE_GHS, currency);
}

/** Minimum stake for this wallet's currency. */
export function minStake(currency?: string | null) {
  return inCurrency(MIN_STAKE_GHS, currency);
}

/** Normalize a currency string to the two supported codes. */
export function normalizeCurrency(currency?: string | null): "GHS" | "NGN" {
  return currency === "NGN" ? "NGN" : "GHS";
}

/**
 * Human-readable minimums for the UI. Always rendered in the wallet's OWN
 * currency, so a naira account sees the naira equivalent (₦5,000 for the
 * GH₵50 deposit floor) instead of a figure in a foreign currency.
 *
 * These are display-only labels — the numbers are the same ones the server
 * enforces (deposits/withdrawals in wallet-actions.tsx, stakes in
 * /api/bets), so the copy can never drift from the validation.
 */
export function minDepositLabel(currency?: string | null): string {
  return `Minimum deposit ${formatCustomerAmount(minDeposit(currency), currency)}`;
}

export function minWithdrawalLabel(currency?: string | null): string {
  return `Minimum withdrawal ${formatCustomerAmount(minWithdrawal(currency), currency)}`;
}

export function minStakeLabel(currency?: string | null): string {
  return `Minimum stake ${formatCustomerAmount(minStake(currency), currency)}`;
}
