"use client";

import AdminShell from "@/components/admin-shell";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

type NairaWithdrawal = {
  id: string;
  account_id: string;
  amount: number;
  fee: number;
  currency: string;
  status: "pending" | "approved" | "rejected";
  screenshot_data?: string | null;
  reference?: string | null;
  note?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  customer_accounts?: { username?: string; phone?: string; email?: string | null } | null;
};

/** Admin-only review of manual Naira (OPay transfer + screenshot) withdrawal activation fees. */
export default function NairaWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<NairaWithdrawal[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Screenshot viewer pop-up — admin clicks the screenshot to open it, X closes.
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/staff/naira-withdrawals", { cache: "no-store" });
      const data = await response.json() as { withdrawals?: NairaWithdrawal[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load Naira withdrawals.");
      setWithdrawals(data.withdrawals || []);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load Naira withdrawals.");
    }
  }

  useEffect(() => { void load(); }, []);

  async function closeLightbox() {
    setLightbox(null);
  }

  async function review(withdrawal: NairaWithdrawal, action: "approve" | "reject") {
    if (busyId) return;
    setBusyId(withdrawal.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/staff/naira-withdrawals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: withdrawal.id, action })
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to review the withdrawal.");
      setNotice(action === "approve"
        ? `Approved — ₦${Number(withdrawal.fee).toLocaleString()} activation fee recorded, ₦${Number(withdrawal.amount).toLocaleString()} reserved from the wallet. The payout is now in the Withdrawals queue.`
        : "Rejected. The user's wallet balance is unchanged.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to review the withdrawal.");
    } finally {
      setBusyId(null);
    }
  }

  const pending = withdrawals.filter((withdrawal) => withdrawal.status === "pending");
  const reviewed = withdrawals.filter((withdrawal) => withdrawal.status !== "pending");

  function renderWithdrawal(withdrawal: NairaWithdrawal) {
    const customer = withdrawal.customer_accounts;
    return (
      <article className="naira-claim" key={withdrawal.id}>
        <div className="naira-claim-main">
          <div className="user-cell">
            <span className="mini-avatar">{(customer?.username || "??").slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{customer?.username || "Unknown user"}</strong>
              <small>{customer?.phone || "—"}{customer?.email ? ` · ${customer.email}` : ""}</small>
            </div>
          </div>
          <strong className="naira-claim-amount">₦{Number(withdrawal.amount || 0).toLocaleString()}</strong>
          <span className={`status ${withdrawal.status}`}>{withdrawal.status}</span>
        </div>
        <dl className="naira-claim-meta">
          <div><dt>Activation fee</dt><dd>₦{Number(withdrawal.fee || 0).toLocaleString()}</dd></div>
          <div><dt>OPay reference (user)</dt><dd>{withdrawal.reference || "—"}</dd></div>
          <div><dt>Submitted</dt><dd>{new Date(withdrawal.created_at).toLocaleString()}</dd></div>
          {withdrawal.reviewed_at && <div><dt>Reviewed</dt><dd>{new Date(withdrawal.reviewed_at).toLocaleString()}</dd></div>}
        </dl>
        {withdrawal.screenshot_data && (
          <button type="button" className="naira-screenshot-link" onClick={() => setLightbox({ src: withdrawal.screenshot_data!, alt: `Activation fee screenshot for ${withdrawal.id}` })}>
            <img className="naira-screenshot" src={withdrawal.screenshot_data} alt="Activation fee payment screenshot" loading="lazy" />
            <span>View full screenshot</span>
          </button>
        )}
        {withdrawal.status === "pending" && (
          <div className="naira-claim-actions">
            <button type="button" className="primary-button" disabled={busyId === withdrawal.id} onClick={() => void review(withdrawal, "approve")}><Check size={15} /> Approve & reserve</button>
            <button type="button" className="danger-button" disabled={busyId === withdrawal.id} onClick={() => void review(withdrawal, "reject")}><X size={15} /> Reject</button>
          </div>
        )}
      </article>
    );
  }

  return (
    <AdminShell title="Naira Withdrawals" description="Manual OPay activation-fee claims from Naira customers. Verify the screenshot, then approve — the fee is recorded, the withdrawal amount is reserved from the wallet, and the payout moves to the Withdrawals queue.">
      {error && <div className="admin-inline-error" role="alert">{error}</div>}
      {notice && <div className="admin-inline-error" role="alert" style={{ background: "#e9f8ef", color: "#248c52" }}>{notice}</div>}
      <section className="admin-card table-card">
        <div className="card-heading"><div><h2>Pending review ({pending.length})</h2><p>Approve only when the screenshot matches the activation-fee amount.</p></div></div>
        {pending.length === 0 && <p className="empty-table">No pending Naira withdrawals.</p>}
        {pending.map(renderWithdrawal)}
      </section>
      <section className="admin-card table-card">
        <div className="card-heading"><div><h2>Reviewed ({reviewed.length})</h2><p>Approved and rejected claims.</p></div></div>
        {reviewed.length === 0 && <p className="empty-table">Nothing reviewed yet.</p>}
        {reviewed.map(renderWithdrawal)}
      </section>

      {lightbox && (
        <div className="naira-lightbox" role="dialog" aria-modal="true" aria-label="Activation fee screenshot" onClick={(event) => { if (event.target === event.currentTarget) closeLightbox(); }}>
          <div className="naira-lightbox-inner">
            <button type="button" className="naira-lightbox-close" onClick={closeLightbox} aria-label="Close"><X size={20} /></button>
            <img className="naira-lightbox-img" src={lightbox.src} alt={lightbox.alt} />
          </div>
        </div>
      )}
    </AdminShell>
  );
}
