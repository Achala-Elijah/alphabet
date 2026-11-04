"use client";

import AdminShell from "@/components/admin-shell";
import { Download, Search, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

type Transaction = { id: string; account_id: string; type: string; amount: number; status: string; reference: string | null; created_at: string };

export default function TransactionsPage() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pendingFailure, setPendingFailure] = useState<Transaction | null>(null);
  const [flagging, setFlagging] = useState(false);
  const load = async () => {
    const response = await fetch("/api/staff/transactions", { cache: "no-store" });
    const data = await response.json() as { transactions?: Transaction[]; accounts?: Record<string, string>; error?: string };
    if (!response.ok) throw new Error(data.error || "Unable to load transactions.");
    setRows(data.transactions || []);
    setAccounts(data.accounts || {});
  };
  useEffect(() => { void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load transactions.")); }, []);
  async function flagFailed(transaction: Transaction) {
    setPendingFailure(transaction);
  }
  async function confirmFlagFailed() {
    if (!pendingFailure) return;
    setFlagging(true);
    try {
      const response = await fetch("/api/staff/transactions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: pendingFailure.id, status: "failed" }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setError(data.error || "Unable to update transaction."); return; }
      setPendingFailure(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update transaction.");
    } finally {
      setFlagging(false);
    }
  }
  return <AdminShell title="Transactions" description="Track deposits, withdrawals, and transaction statuses.">
    <div className="toolbar"><div className="search-field"><Search size={17} /><input placeholder="Search transactions..." /></div><button className="secondary-button"><Download size={17} /> Export</button></div>
    {error && <div className="admin-inline-error">{error}</div>}
    <section className="admin-card table-card"><div className="table-wrap"><table><thead><tr><th>Transaction ID</th><th>User</th><th>Type</th><th>Amount</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead><tbody>{rows.map((transaction) => <tr key={transaction.id}><td className="id-cell">{transaction.reference || transaction.id.slice(0, 8).toUpperCase()}</td><td>{accounts[transaction.account_id] || "Unknown"}</td><td>{transaction.type.replace("_", " ")}</td><td className="amount-cell">GH₵ {Number(transaction.amount || 0).toFixed(2)}</td><td><span className={`status ${transaction.status.toLowerCase()}`}>{transaction.status}</span></td><td>{new Date(transaction.created_at).toLocaleString()}</td><td>{transaction.status.toLowerCase() !== "failed" && <button className="danger-button" onClick={() => void flagFailed(transaction)}><XCircle size={15} /> Flag failed</button>}</td></tr>)}</tbody></table></div></section>
    {pendingFailure && <div className="match-edit-overlay transaction-confirm-overlay" role="alertdialog" aria-modal="true" aria-labelledby="transaction-confirm-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingFailure(null); }} onKeyDown={(event) => { if (event.key === "Escape") setPendingFailure(null); }} tabIndex={-1}><section className="admin-card match-confirm-card"><div className="confirm-icon"><XCircle size={22} /></div><h2 id="transaction-confirm-title">Flag transaction as failed?</h2><p>This will mark <strong>{pendingFailure.reference || pendingFailure.id.slice(0, 8).toUpperCase()}</strong> as failed for <strong>{accounts[pendingFailure.account_id] || "this customer"}</strong>.</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setPendingFailure(null)} disabled={flagging}>Cancel</button><button type="button" className="danger-button" onClick={() => void confirmFlagFailed()} disabled={flagging}>{flagging ? "Saving..." : "Yes, flag failed"}</button></div></section></div>}
  </AdminShell>;
}
