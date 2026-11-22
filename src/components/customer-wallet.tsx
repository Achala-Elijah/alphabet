"use client";

import { useEffect } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Clock3, Wallet } from "lucide-react";
import { formatCustomerAmount } from "@/lib/currency";
import WalletActions from "@/components/wallet-actions";

const DEBIT_TYPES = new Set(["bet_stake", "withdrawal", "withdrawal_activation_fee"]);
const TRANSACTION_LABELS: Record<string, string> = {
  bet_stake: "Bet",
  withdrawal: "Withdrawal",
  withdrawal_activation_fee: "Activation fee",
  payout: "Payout",
  refund: "Refund",
  deposit: "Deposit"
};

type WalletTransaction = {
  id: string;
  type: string;
  amount: number;
  status: string;
  reference: string | null;
  created_at: string;
};

export default function CustomerWallet({
  balance,
  currency,
  initialTransactions,
  title = "My Wallet",
  paymentNotice
}: {
  balance: number;
  currency?: string | null;
  initialTransactions: WalletTransaction[];
  title?: string;
  paymentNotice?: { kind: "success" | "error"; text: string } | null;
}) {
  useEffect(() => {
    if (paymentNotice?.kind === "success") {
      window.dispatchEvent(new Event("alphabet:balance-updated"));
      window.dispatchEvent(new Event("betkiing:balance-updated"));
    }
  }, [paymentNotice]);

  return (
    <section className="customer-wallet">
      <h1 className="wallet-page-title">{title}</h1>
      {paymentNotice && <p className={`wallet-notice ${paymentNotice.kind}`}>{paymentNotice.text}</p>}
      <div className="wallet-balance-card">
        <span><Wallet size={17} /> Available balance</span>
        <strong>{formatCustomerAmount(balance, currency)}</strong>
        <small>Wallet funds available for betting</small>
      </div>
      <WalletActions mode="customer" currency={currency} layout="wallet" availableBalance={balance} />
      <div className="wallet-history-heading"><span><Clock3 size={16} /> Transaction History</span></div>
      {initialTransactions.length === 0 ? <div className="wallet-empty">No transactions yet.</div> : <div className="wallet-transactions">
        {initialTransactions.map((transaction) => <div className="wallet-transaction" key={transaction.id}>
          <span className={`wallet-transaction-icon ${DEBIT_TYPES.has(transaction.type) ? "debit" : "credit"}`}>{DEBIT_TYPES.has(transaction.type) ? <ArrowUpFromLine size={15} /> : <ArrowDownToLine size={15} />}</span>
          <span className="wallet-transaction-info"><strong>{TRANSACTION_LABELS[transaction.type] || transaction.type.replace(/_/g, " ")}</strong><small>{transaction.reference || "Wallet transaction"} · {new Date(transaction.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small></span>
          <span className={`wallet-amount ${DEBIT_TYPES.has(transaction.type) ? "debit-text" : "credit-text"}`}>{DEBIT_TYPES.has(transaction.type) ? "-" : "+"}{formatCustomerAmount(transaction.amount, currency)}<small>{transaction.status}</small></span>
        </div>)}
      </div>}
    </section>
  );
}
