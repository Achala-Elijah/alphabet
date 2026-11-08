"use client";

import { ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Clock3 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { currencySymbol, formatCustomerAmount } from "@/lib/currency";
import { minDeposit, minWithdrawal, minDepositLabel, minWithdrawalLabel, normalizeCurrency, withdrawalActivationFee } from "@/lib/limits";
import NairaDepositPopup from "@/components/naira-deposit-popup";

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

export default function WalletActions({ mode, currency, layout = "wallet", availableBalance }: { mode: "customer" | "staff"; currency?: string | null; layout?: Layout; availableBalance?: number }) {
  const router = useRouter();
  const [action, setAction] = useState<Action>("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [activationAmount, setActivationAmount] = useState<number | null>(null);
  // Naira customers pay by manual OPay transfer + screenshot, not Paystack.
  const [nairaPopupOpen, setNairaPopupOpen] = useState(false);

  const isAdmin = layout === "admin";
  const normalized = normalizeCurrency(currency);
  const limitsCurrency = isAdmin ? "GHS" : normalized;
  const symbol = currencySymbol(limitsCurrency);
  const money = (value: number) => (isAdmin ? `GH₵ ${value.toFixed(2)}` : formatCustomerAmount(value, normalized));

  const floor = action === "deposit" ? minDeposit(limitsCurrency) : minWithdrawal(limitsCurrency);
  const activationFee = mode === "customer" ? withdrawalActivationFee(normalized) : 0;
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
    // Naira deposits are manual OPay transfers with a screenshot —
    // show the OPay popup instead of a Paystack checkout.
    if (isDeposit && mode === "customer" && normalized === "NGN") {
      setNotice(null);
      setNairaPopupOpen(true);
      return;
    }
    if (mode === "customer" && !isDeposit) {
      if (value < floor) {
        setNotice({ kind: "error", text: `The minimum withdrawal is ${money(floor)}.` });
        return;
      }
      if (availableBalance !== undefined && value > availableBalance) {
        setNotice({ kind: "error", text: `You have ${money(availableBalance)}. You need ${money(value)} in your wallet for the withdrawal amount.` });
        return;
      }
      setNotice(null);
      setActivationAmount(value);
      return;
    }
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
          text: data.message || `Withdrawal of ${money(value)} requested. New balance: ${balance}.`
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

  async function submitActivation() {
    const value = activationAmount;
    if (value === null) return;
    if (availableBalance !== undefined && value > availableBalance) {
      setNotice({ kind: "error", text: `You have ${money(availableBalance)}. You need ${money(value)} in your wallet for the withdrawal amount.` });
      setActivationAmount(null);
      return;
    }
    setBusy("withdrawal");
    setNotice(null);
    try {
      const response = await fetch("/api/payments/withdraw-activation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: value, activationFeeConsent: true })
      });
      const data = await response.json() as { error?: string; checkoutUrl?: string | null; balance?: number; status?: string; reference?: string; activationRequested?: boolean; message?: string };
      if (!response.ok) {
        setNotice({ kind: "error", text: data.error || "Could not start your activation fee payment." });
        return;
      }
      if (data.checkoutUrl) {
        // Hosted checkout — do not credit or reserve anything until it settles.
        window.location.href = data.checkoutUrl;
        return;
      }
      const balance = money(Number(data.balance || 0));
      setAmount("");
      setNotice({ kind: "success", text: data.message || `Activation fee paid. Your withdrawal of ${money(value)} is pending admin review. New balance: ${balance}.` });
      setActivationAmount(null);
      window.dispatchEvent(new Event("alphabet:balance-updated"));
      window.dispatchEvent(new Event("betkiing:balance-updated"));
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
    : mode === "customer"
      ? `${money(activationFee)} activation fee is paid separately before the withdrawal can be requested.`
      : null;

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

      {activationAmount !== null && (
        <div
          className="activation-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Withdrawal activation fee"
          onClick={() => setActivationAmount(null)}
        >
          <div className="activation-card" onClick={(event) => event.stopPropagation()}>
            <span className="activation-icon"><ShieldCheck size={27} /></span>
            <span className="activation-eyebrow">WITHDRAWAL ACTIVATION FEE</span>
            <h3>Activate your withdrawal</h3>
            <p>Pay {money(activationFee)} to activate your withdrawal.</p>
            <dl className="activation-summary">
              <div><dt>Withdrawal from wallet</dt><dd>{money(activationAmount)}</dd></div>
              <div><dt>Activation fee (separate)</dt><dd>{money(activationFee)}</dd></div>
              <div className="activation-total"><dt>Total to pay</dt><dd>{money(activationAmount + activationFee)}</dd></div>
            </dl>
            <div className="activation-actions">
              <button type="button" className="activation-cancel" onClick={() => setActivationAmount(null)} disabled={busy === "withdrawal"}>Cancel</button>
              <button type="button" className="activation-pay" onClick={() => void submitActivation()} disabled={busy === "withdrawal"}>
                {busy === "withdrawal" ? "Processing…" : `Pay ${money(activationFee)}`}
              </button>
            </div>
          </div>
        </div>
      )}
      {nairaPopupOpen && (
        <NairaDepositPopup
          onClose={() => setNairaPopupOpen(false)}
          onSubmitted={() => {
            setNairaPopupOpen(false);
            setAmount("");
            setNotice({ kind: "success", text: "Deposit claim submitted. The system will automatically verify it and credit your wallet." });
            window.dispatchEvent(new Event("alphabet:balance-updated"));
            window.dispatchEvent(new Event("betkiing:balance-updated"));
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
