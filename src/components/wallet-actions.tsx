"use client";

import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCustomerAmount } from "@/lib/currency";
import { minDeposit, minWithdrawal, minDepositLabel, minWithdrawalLabel, minStakeLabel, normalizeCurrency } from "@/lib/limits";

/**
 * The single Deposit/Withdraw control used everywhere a wallet button appears:
 *   layout="wallet"   -> customer wallet page (dark theme)
 *   layout="summary"  -> account page balance card
 *   layout="admin"    -> sub-admin wallet page (admin theme)
 *
 * mode="customer" withdraws through /api/wallet/withdraw,
 * mode="staff"    withdraws through /api/staff/wallet.
 * Deposits always go through /api/payments/deposit (gateway-agnostic).
 */
type Layout = "wallet" | "summary" | "admin";

export default function WalletActions({ mode, currency, layout = "wallet" }: { mode: "customer" | "staff"; currency?: string | null; layout?: Layout }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<"deposit" | "withdrawal" | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const isAdmin = layout === "admin";
  const normalized = normalizeCurrency(currency);
  const money = (value: number) => (isAdmin ? `GH₵ ${value.toFixed(2)}` : formatCustomerAmount(value, normalized));

  async function run(action: "deposit" | "withdrawal") {
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
      if (isDeposit) {
        const minimum = minDeposit(isAdmin ? "GHS" : normalized);
        if (value < minimum) {
          setNotice({ kind: "error", text: `The minimum deposit is ${money(minimum)}.` });
          return;
        }
      } else {
        const minimum = minWithdrawal(isAdmin ? "GHS" : normalized);
        if (value < minimum) {
          setNotice({ kind: "error", text: `The minimum withdrawal is ${money(minimum)}.` });
          return;
        }
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

  const rowClass = isAdmin ? "staff-wallet-actions" : layout === "summary" ? "account-wallet-actions" : "wallet-actions";
  const noticeClass = isAdmin && notice ? `wallet-action-notice ${notice.kind}` : "wallet-notice";
  const depositClass = isAdmin ? "wallet-action-button deposit" : undefined;
  const withdrawClass = isAdmin ? "wallet-action-button withdraw" : undefined;
  const iconSize = isAdmin ? 15 : 17;

  // Shown directly under every Deposit/Withdraw control so the floor is
  // visible before the user types anything. Rendered in the wallet's own
  // currency — a naira account sees ₦5,000, a cedi account sees GH₵50.
  const limitsCurrency = isAdmin ? "GHS" : normalized;
  const minHint = isAdmin
    ? `${minDepositLabel("GHS")} · ${minWithdrawalLabel("GHS")}`
    : `${minDepositLabel(limitsCurrency)} · ${minWithdrawalLabel(limitsCurrency)}`;

  return (
    <>
      <div className={rowClass}>
        <input inputMode="decimal" aria-label="Amount" min={minDeposit(limitsCurrency)} placeholder={`Amount — min ${formatCustomerAmount(minDeposit(limitsCurrency), limitsCurrency)}`} value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy !== null} />
        <button type="button" className={depositClass} onClick={() => void run("deposit")} disabled={busy !== null}>{busy === "deposit" ? "Processing..." : <><ArrowDownToLine size={iconSize} /> Deposit</>}</button>
        <button type="button" className={withdrawClass} onClick={() => void run("withdrawal")} disabled={busy !== null}>{busy === "withdrawal" ? "Processing..." : <><ArrowUpFromLine size={iconSize} /> Withdraw</>}</button>
      </div>
      <p className="wallet-limits">{minHint}</p>
      {notice && <p className={noticeClass}>{notice.text}</p>}
    </>
  );
}
