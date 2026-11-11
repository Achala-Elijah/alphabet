"use client";

import AdminShell from "@/components/admin-shell";
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

type NairaDeposit = {
  id: string;
  account_id: string;
  amount: number;
  currency: string;
  status: "pending" | "approved" | "rejected";
  screenshot_data?: string | null;
  reference?: string | null;
  note?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  customer_accounts?: { username?: string; phone?: string; email?: string | null } | null;
};

/** Admin-only review of manual Naira (OPay transfer + screenshot) deposits. */
export default function NairaDepositsPage() {
  const [deposits, setDeposits] = useState<NairaDeposit[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Screenshot viewer pop-up — admin clicks the screenshot to open it, X closes.
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/staff/naira-deposits", { cache: "no-store" });
      const data = await response.json() as { deposits?: NairaDeposit[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load Naira deposits.");
      setDeposits(data.deposits || []);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load Naira deposits.");
    }
  }

  useEffect(() => { void load(); }, []);

  async function closeLightbox() {
    setLightbox(null);
  }

  async function review(deposit: NairaDeposit, action: "approve" | "reject") {
    if (busyId) return;
    setBusyId(deposit.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/staff/naira-deposits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deposit.id, action })
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to review the deposit.");
      setNotice(action === "approve" ? `Approved — ₦${Number(deposit.amount).toLocaleString()} credited to the user's wallet.` : "Rejected. The user keeps their wallet balance.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to review the deposit.");
    } finally {
      setBusyId(null);
    }
  }

  const pending = deposits.filter((deposit) => deposit.status === "pending");
  const reviewed = deposits.filter((deposit) => deposit.status !== "pending");

  function renderDeposit(deposit: NairaDeposit) {
    const customer = deposit.customer_accounts;
    return (
      <article className="naira-claim" key={deposit.id}>
        <div className="naira-claim-main">
          <div className="user-cell">
            <span className="mini-avatar">{(customer?.username || "??").slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{customer?.username || "Unknown user"}</strong>
              <small>{customer?.phone || "—"}{customer?.email ? ` · ${customer.email}` : ""}</small>
            </div>
          </div>
          <strong className="naira-claim-amount">₦{Number(deposit.amount || 0).toLocaleString()}</strong>
          <span className={`status ${deposit.status}`}>{deposit.status}</span>
        </div>
        <dl className="naira-claim-meta">
          <div><dt>Reference</dt><dd>{deposit.reference || "—"}</dd></div>
          <div><dt>Submitted</dt><dd>{new Date(deposit.created_at).toLocaleString()}</dd></div>
          {deposit.reviewed_at && <div><dt>Reviewed</dt><dd>{new Date(deposit.reviewed_at).toLocaleString()}</dd></div>}
        </dl>
        {deposit.screenshot_data && (
          <button type="button" className="naira-screenshot-link" onClick={() => setLightbox({ src: deposit.screenshot_data!, alt: `Transfer screenshot for ${deposit.id}` })}>
            <img className="naira-screenshot" src={deposit.screenshot_data} alt="Transfer screenshot" loading="lazy" />
            <span>View full screenshot</span>
          </button>
        )}
        {deposit.status === "pending" && (
          <div className="naira-claim-actions">
            <button type="button" className="primary-button" disabled={busyId === deposit.id} onClick={() => void review(deposit, "approve")}><Check size={15} /> Mark successful</button>
            <button type="button" className="danger-button" disabled={busyId === deposit.id} onClick={() => void review(deposit, "reject")}><X size={15} /> Reject</button>
          </div>
        )}
      </article>
    );
  }

  return (
    <AdminShell title="Naira Account Deposits" description="Manual OPay transfer claims from Naira customers. Verify the screenshot, then approve to credit the wallet or reject.">
      {error && <div className="admin-inline-error" role="alert">{error}</div>}
      {notice && <div className="admin-inline-error" role="alert" style={{ background: "#e9f8ef", color: "#248c52" }}>{notice}</div>}
      <section className="admin-card table-card">
        <div className="card-heading"><div><h2>Pending review ({pending.length})</h2><p>Approve only when the screenshot matches the amount and account.</p></div></div>
        {pending.length === 0 && <p className="empty-table">No pending Naira deposits.</p>}
        {pending.map(renderDeposit)}
      </section>
      <section className="admin-card table-card">
        <div className="card-heading"><div><h2>Reviewed ({reviewed.length})</h2><p>Approved and rejected claims.</p></div></div>
        {reviewed.length === 0 && <p className="empty-table">Nothing reviewed yet.</p>}
        {reviewed.map(renderDeposit)}
      </section>

      {lightbox && (
        <div className="naira-lightbox" role="dialog" aria-modal="true" aria-label="Transfer screenshot" onClick={(event) => { if (event.target === event.currentTarget) closeLightbox(); }}>
          <div className="naira-lightbox-inner">
            <button type="button" className="naira-lightbox-close" onClick={closeLightbox} aria-label="Close"><X size={20} /></button>
            <img className="naira-lightbox-img" src={lightbox.src} alt={lightbox.alt} />
          </div>
        </div>
      )}
    </AdminShell>
  );
}
