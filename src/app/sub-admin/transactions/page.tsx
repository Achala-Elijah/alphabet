"use client";

import AdminShell from "@/components/admin-shell";
import { Download, Search, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Transaction = { id: string; account_id: string; type: string; amount: number; status: string; reference: string | null; created_at: string };

export default function TransactionsPage() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pendingFailure, setPendingFailure] = useState<Transaction | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [search, setSearch] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchTerm = search.trim().toLowerCase();
  const filtered = rows.filter((transaction) => {
    if (!searchTerm) return true;
    const haystack = [transaction.reference, transaction.id, accounts[transaction.account_id], transaction.type, transaction.status].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(searchTerm);
  });
  function exportCsv() {
    const headers = ["id", "user", "type", "amount", "status", "reference", "created_at"];
    const escape = (value: string | number | null | undefined) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const body = filtered.map((transaction) => [
      transaction.id,
      accounts[transaction.account_id] || "Unknown",
      transaction.type,
      transaction.amount,
      transaction.status,
      transaction.reference,
      new Date(transaction.created_at).toISOString()
    ].map(escape).join(","));
    const csv = [headers.map(escape).join(","), ...body].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  const load = async () => {
    const response = await fetch("/api/staff/transactions", { cache: "no-store" });
    const data = await response.json() as { transactions?: Transaction[]; accounts?: Record<string, string>; error?: string };
    if (!response.ok) throw new Error(data.error || "Unable to load transactions.");
    setRows(data.transactions || []);
    setAccounts(data.accounts || {});
  };
  useEffect(() => { void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load transactions.")); }, []);
  // Only full admins can flag transactions as failed — hide the action for sub-admins.
  useEffect(() => {
    fetch("/api/staff/profile", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ role?: string }> : null)
      .then((profile) => setIsAdmin(profile?.role === "admin"))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!pendingFailure) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPendingFailure(null); };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [pendingFailure]);
  async function flagFailed(transaction: Transaction) {
    setConfirmError("");
    setPendingFailure(transaction);
  }
  async function confirmFlagFailed() {
    if (!pendingFailure) return;
    setFlagging(true);
    setConfirmError("");
    try {
      const response = await fetch("/api/staff/transactions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: pendingFailure.id, status: "failed" }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setConfirmError(data.error || "Unable to update transaction."); return; }
      setPendingFailure(null);
      await load();
    } catch (reason) {
      setConfirmError(reason instanceof Error ? reason.message : "Unable to update transaction.");
    } finally {
      setFlagging(false);
    }
  }
  return <AdminShell title="Transactions" description="Track deposits, withdrawals, and transaction statuses.">
    <div className="toolbar"><div className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transactions, users, references..." aria-label="Search transactions" /></div><button className="secondary-button" onClick={exportCsv} disabled={filtered.length === 0}><Download size={17} /> Export</button></div>
    {error && <div className="admin-inline-error">{error}</div>}
    <section className="admin-card table-card"><div className="table-wrap"><table><thead><tr><th>Transaction ID</th><th>User</th><th>Type</th><th>Amount</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead><tbody>{filtered.map((transaction) => <tr key={transaction.id}><td className="id-cell">{transaction.reference || transaction.id.slice(0, 8).toUpperCase()}</td><td>{accounts[transaction.account_id] || "Unknown"}</td><td>{transaction.type.replace("_", " ")}</td><td className="amount-cell">GH₵ {Number(transaction.amount || 0).toFixed(2)}</td><td><span className={`status ${transaction.status.toLowerCase()}`}>{transaction.status}</span></td><td>{new Date(transaction.created_at).toLocaleString()}</td><td>{transaction.status.toLowerCase() !== "failed" && isAdmin && <button className="danger-button" onClick={() => void flagFailed(transaction)}><XCircle size={15} /> Flag failed</button>}</td></tr>)}{filtered.length === 0 && <tr><td colSpan={7} className="empty-table">No transactions match “{search.trim() || "your search"}”.</td></tr>}</tbody></table></div></section>
    {pendingFailure && <div className="match-edit-overlay transaction-confirm-overlay" role="alertdialog" aria-modal="true" aria-labelledby="transaction-confirm-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingFailure(null); }} onKeyDown={(event) => { if (event.key === "Escape") setPendingFailure(null); }} tabIndex={-1}><section className="admin-card match-confirm-card"><div className="confirm-icon"><XCircle size={22} /></div><h2 id="transaction-confirm-title">Flag transaction as failed?</h2><p>This will mark <strong>{pendingFailure.reference || pendingFailure.id.slice(0, 8).toUpperCase()}</strong> as failed for <strong>{accounts[pendingFailure.account_id] || "this customer"}</strong>.</p>{confirmError && <p className="admin-inline-error" role="alert">{confirmError}</p>}<div className="modal-actions"><button ref={cancelButtonRef} type="button" className="secondary-button" onClick={() => setPendingFailure(null)} disabled={flagging}>Cancel</button><button type="button" className="danger-button" onClick={() => void confirmFlagFailed()} disabled={flagging}>{flagging ? "Saving..." : "Yes, flag failed"}</button></div></section></div>}
  </AdminShell>;
}
