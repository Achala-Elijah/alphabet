"use client";

import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type FlagAction = "failed" | "successful" | "pending";

export type FlagTransaction = {
  id: string;
  type: string;
  status: string;
  reference: string | null;
};

const SUCCESS_STATUSES = ["paid", "completed", "approved"];

export default function TransactionFlagActions({ transaction, isAdmin, accountName }: { transaction: FlagTransaction; isAdmin: boolean; accountName?: string }) {
  const [pendingAction, setPendingAction] = useState<FlagAction | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!pendingAction) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPendingAction(null); };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [pendingAction]);

  if (!isAdmin) return null;

  const status = transaction.status.toLowerCase();
  const canFlagFailed = !status.includes("failed");
  const canMarkSuccessful = !SUCCESS_STATUSES.includes(status);
  const canMarkPending = status !== "pending";

  function request(action: FlagAction) {
    setError("");
    setPendingAction(action);
  }

  async function confirm() {
    if (!pendingAction) return;
    setSaving(true);
    setError("");
    try {
      const statusToSend = pendingAction === "failed"
        ? "failed"
        : pendingAction === "pending"
          ? "pending"
          : (transaction.type === "deposit" || transaction.type === "deposit_bonus" ? "paid" : "completed");

      const response = await fetch("/api/staff/transactions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: transaction.id, status: statusToSend })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to update transaction.");
      }
      // Optimistic update: close modal immediately so UI reflects the change
      setPendingAction(null);
      setSaving(false);
      // Full reload to refresh server data
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update transaction.");
      setSaving(false);
    }
  }

  const failing = pendingAction === "failed";
  const pending = pendingAction === "pending";
  const label = transaction.reference || transaction.id.slice(0, 8).toUpperCase();
  const actionLabel = failing ? "failed" : pending ? "pending" : "successful";
  const title = failing ? "Flag transaction as failed?" : pending ? "Mark transaction as pending?" : "Mark transaction as successful?";
  const confirmLabel = failing ? "Yes, flag failed" : pending ? "Yes, mark pending" : "Yes, mark successful";
  const modal = pendingAction ? <div className="match-edit-overlay transaction-confirm-overlay" role="alertdialog" aria-modal="true" aria-labelledby={`flag-title-${transaction.id}`} onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingAction(null); }} tabIndex={-1}>
    <section className="admin-card match-confirm-card">
      <div className="confirm-icon">{failing ? <XCircle size={22} /> : pending ? <Clock size={22} /> : <CheckCircle2 size={22} />}</div>
      <h2 id={`flag-title-${transaction.id}`}>{title}</h2>
      <p>This will mark <strong>{label}</strong> as <strong>{actionLabel}</strong>{accountName ? <> for <strong>{accountName}</strong></> : null}.</p>
      {error && <p className="admin-inline-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button ref={cancelButtonRef} type="button" className="secondary-button" onClick={() => setPendingAction(null)} disabled={saving}>Cancel</button>
        <button type="button" className={failing ? "danger-button" : pending ? "secondary-button" : "primary-button"} onClick={confirm} disabled={saving}>{saving ? "Saving..." : confirmLabel}</button>
      </div>
    </section>
  </div> : null;

  return <>
    <div className="withdrawal-actions transaction-actions">
      {canFlagFailed && <button type="button" className="danger-button" onClick={() => request("failed")}><XCircle size={15} /> Failed</button>}
      {canMarkSuccessful && <button type="button" className="primary-button" onClick={() => request("successful")}><CheckCircle2 size={15} /> Successful</button>}
      {canMarkPending && <button type="button" className="secondary-button" onClick={() => request("pending")}><Clock size={15} /> Pending</button>}
    </div>
    {modal ? createPortal(modal, document.body) : null}
  </>;
}