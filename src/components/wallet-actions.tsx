"use client";

import { ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Clock3 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { currencySymbol, formatCustomerAmount } from "@/lib/currency";
import { minDeposit, minWithdrawal, minDepositLabel, minWithdrawalLabel, normalizeCurrency } from "@/lib/limits";

/**
 * The single Deposit/Withdraw control used everywhere a wallet appears:
 *   layout="wallet"   -> customer wallet page (dark theme)
 *   layout="summary"  -> account page balance card (dark theme)
 *   layout="admin"    -> sub-admin wallet page (light admin theme)
 *
 * Shaped like a standard sportsbook cashier: a Deposit / Withdraw tab
 * switcher, quick-amount chips, one labelled amount field and a single
 * full-width call-to-action — instead of two competing buttons beside a
 * bare input.
 *
 * mode="customer" withdraws through /api/wallet/withdraw,
 * mode="staff"    withdraws through /api/staff/wallet.
 * Deposits always go through /api/payments/deposit (gateway-agnostic).
 */
type Layout = "wallet" | "summary" | "admin";
type Action = "deposit" | "withdrawal";

export default function WalletActions({ mode, currency, layout = "wallet" }: { mode: "customer" | "staff"; currency?: string | null; layout?: Layout }) {
  const router = useRouter();
  const [action, setAction] = useState<Action>("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const isAdmin = layout === "admin";
  const normalized = normalizeCurrency(currency);
  const limitsCurrency = isAdmin ? "GHS" : normalized;
  const symbol = currencySymbol(limitsCurrency);
  const money = (value: number) => (isAdmin ? `GH₵ ${value.toFixed(2)}` : formatCustomerAmount(value, normalized));

  const floor = action === "deposit" ? minDeposit(limitsCurrency) : minWithdrawal(limitsCurrency);
  // Quick-amount chips, like every real cashier: bare numbers only — the
  // currency prefix sits in the amount field above. A symbol on every chip
  // (GH₵ 1,000.00) overflows 5-up on a phone, so chips stay short and the
  // field shows the full value. Amounts derive from the enforced minimum.
  const quickAmounts = [1, 2, 4, 10, 20].map((multiplier) => minDeposit(limitsCurrency) * multiplier);
  const chipLabel = (value: number) =>
    value >= 1_000_000 ? `${value / 1_000_000}M` : value >= 1_000 ? `${value / 1_000}K` : String(value);

  function switchAction(next: Action) {
    if (next === action || busy) return;
    setAction(next);
    setAmount("");
    setNotice(null);
  }

  async function run() {
    const parsed = Number(amount);
    if (!amount.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      setNotice({ kind: "error", text: "Enter an amount greater than zero." });
      return;
    }
    const value = Math.round(parsed * 100) / 100;
    const isDeposit = action === "deposit";
    setBusy(action);
    setNotice(null);
    try {
      if (value < floor) {
        setNotice({
          kind: "error",
          text: `The minimum ${isDeposit ? "deposit" : "withdrawal"} is ${money(floor)}.`
        });
        return;
      }
      const url = isDeposit ? "/api/payments/deposit" : mode === "staff" ? "/api/staff/wallet" : "/api/wallet/withdraw";
      const body = isDeposit || mode === "customer" ? { amount: value } : { action: "withdrawal", amount: value };
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { error?: string; checkoutUrl?: string | null; balance?: number; fee?: number; total?: number; payout?: boolean; reference?: string; status?: string; message?: string };
      if (!response.ok) {
        setNotice({ kind: "error", text: data.error || (isDeposit ? "Could not start your deposit." : "Could not complete your withdrawal.") });
        return;
      }
      if (data.checkoutUrl) {
        // Hosted payment page (Paystack) — navigate away. Keep busy until
        // the browser unloads so the user can't double-submit.
        window.location.href = data.checkoutUrl;
        return;
      }
      // Instant/manual provider: the server already settled the deposit.
      const balance = money(Number(data.balance || 0));
      setAmount("");
      if (isDeposit) {
        setNotice({ kind: "success", text: `Deposit of ${money(value)} received. New balance: ${balance}.` });
      } else if (mode === "customer" && data.status === "pending") {
        // Manual-review withdrawal: funds are reserved, staff will contact the user.
        setNotice({
          kind: "success",
          text: data.message || `Withdrawal of ${money(value)} requested. Our team will contact you to process it. New balance: ${balance}.`
        });
      } else {
        setNotice({ kind: "success", text: `Withdrawal of ${money(value)} completed. New balance: ${balance}.` });
      }
      window.dispatchEvent(new Event("alphabet:balance-updated"));
      window.dispatchEvent(new Event("betkiing:balance-updated")); // refresh the header balance pill
      router.refresh();
    } catch {
      setNotice({ kind: "error", text: "Something went wrong. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  const shellClass = `wallet-shell${isAdmin ? " is-admin" : ""}${layout === "summary" ? " is-summary" : ""}`;
  const isDeposit = action === "deposit";
  const ctaLabel = isDeposit
    ? (busy === "deposit" ? "Processing…" : `Deposit ${amount ? money(Number(amount) || 0) : ""}`)
    : (busy === "withdrawal" ? "Processing…" : `Withdraw ${amount ? money(Number(amount) || 0) : ""}`);

  const helper = isDeposit
    ? "Secure checkout — card, bank transfer and mobile money."
    : layout === "wallet"
      ? null // the wallet page already shows the manual-review note below
      : "Withdrawals are reviewed manually — our team will contact you.";

  return (
    <div className={shellClass}>
      {/* Cashier-style switcher: pick the direction first, then the amount. */}
      <div className="wallet-tabs" role="tablist" aria-label="Wallet action">
        <button
          type="button"
          role="tab"
          aria-selected={isDeposit}
          className={`wallet-tab ${isDeposit ? "is-active" : ""}`}
          onClick={() => switchAction("deposit")}
          disabled={busy !== null}
        >
          <ArrowDownToLine size={15} /> Deposit
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isDeposit}
          className={`wallet-tab ${!isDeposit ? "is-active" : ""}`}
          onClick={() => switchAction("withdrawal")}
          disabled={busy !== null}
        >
          <ArrowUpFromLine size={15} /> Withdraw
        </button>
      </div>

      <label className="wallet-field">
        <span className="wallet-field-label">Amount</span>
        <span className="wallet-input-wrap">
          <b className="wallet-currency" aria-hidden="true">{symbol}</b>
          <input
            inputMode="decimal"
            aria-label={`Amount in ${limitsCurrency}`}
            min={floor}
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={busy !== null}
          />
        </span>
      </label>

      {/* One-tap amounts — the pattern every sportsbook cashier uses. */}
      <div className="wallet-chips" role="group" aria-label="Quick amounts">
        {quickAmounts.map((quick) => (
          <button
            key={quick}
            type="button"
            className={`wallet-chip ${Number(amount) === quick ? "is-active" : ""}`}
            onClick={() => { setAmount(String(quick)); setNotice(null); }}
            disabled={busy !== null}
            title={formatCustomerAmount(quick, limitsCurrency)}
          >
            {chipLabel(quick)}
          </button>
        ))}
      </div>

      <p className="wallet-meta">
        {isDeposit ? minDepositLabel(limitsCurrency) : minWithdrawalLabel(limitsCurrency)}
        <span className="wallet-meta-sep">·</span>
        <span className="wallet-meta-soft">Max {formatCustomerAmount(1_000_000, limitsCurrency)}</span>
      </p>

      <button type="button" className="wallet-cta" onClick={() => void run()} disabled={busy !== null}>
        {isDeposit ? <ArrowDownToLine size={17} /> : <ArrowUpFromLine size={17} />}
        {ctaLabel}
      </button>

      {helper && (
        <p className="wallet-helper">
          {isDeposit ? <ShieldCheck size={13} /> : <Clock3 size={13} />}
          {helper}
        </p>
      )}

      {notice && <p className={`wallet-banner ${notice.kind}`}>{notice.text}</p>}
    </div>
  );
}
