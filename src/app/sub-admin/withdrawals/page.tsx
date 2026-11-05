"use client";

import AdminShell from "@/components/admin-shell";
import { Clock3, CheckCircle2, XCircle, Banknote, ArrowUpCircle, ShieldCheck, Search } from "lucide-react";
import { useEffect, useState } from "react";

type Withdrawal = {
  id: string;
  account_id: string;
  username: string;
  phone: string | null;
  amount: number;
  activation_fee: number;
  currency: string;
  status: string;
  reference: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
};

function statusColor(status: string) {
  switch (status) {
    case "pending": return "pending";
    case "approved": return "approved";
    case "completed": return "completed";
    case "rejected": return "rejected";
    case "cancelled": return "cancelled";
    case "failed": return "failed";
    default: return status;
  }
}

function money(amount: number, currency: string) {
  return currency === "NGN" ? `₦ ${Number(amount).toFixed(2)}` : `GH₵ ${Number(amount).toFixed(2)}`;
}

const FILTERS = ["all", "pending", "approved", "completed", "rejected", "cancelled"] as const;

export default function WithdrawalsPage() {
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/staff/withdrawals", { cache: "no-store" });
      const data = await response.json() as { withdrawals?: Withdrawal[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load withdrawals.");
      setRows(data.withdrawals || []);
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "Unable to load withdrawals." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function act(id: string, action: "approve" | "reject" | "complete" | "fail") {
    setActing(id);
    setNotice(null);
    try {
      const response = await fetch("/api/staff/withdrawals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action })
      });
      const data = await response.json() as { error?: string; status?: string };
      if (!response.ok) throw new Error(data.error || "Could not update this withdrawal.");
      setNotice({ kind: "success", text: `Withdrawal ${action === "approve" ? "approved. Pay out manually via MoMo / bank, then mark completed." : action === "reject" ? "rejected and funds returned to the user." : action === "complete" ? "marked as completed." : "marked as failed and funds returned."}` });
      await load();
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "Something went wrong." });
    } finally {
      setActing(null);
    }
  }

  const filtered = rows.filter((row) => {
    const matchesFilter = filter === "all" || row.status === filter;
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || row.username.toLowerCase().includes(needle) || (row.reference || "").toLowerCase().includes(needle) || (row.phone || "").includes(needle);
    return matchesFilter && matchesSearch;
  });

  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const pendingTotal = rows.filter((r) => r.status === "pending").reduce((t, r) => t + Number(r.amount), 0);
  const approvedTotal = rows.filter((r) => r.status === "approved").reduce((t, r) => t + Number(r.amount), 0);

  return (
    <AdminShell title="Withdrawal requests" description="Review customer withdrawal requests. Approving reserves the payout for manual payment via MoMo / bank transfer — no automatic transfer is sent.">
      <div className="stats-grid stats-grid-3">
        <div className="stat-card">
          <div className="stat-top"><span>Pending requests</span><div className="stat-icon"><Clock3 size={19} /></div></div>
          <strong>{pendingCount}</strong>
          <small>awaiting review</small>
        </div>
        <div className="stat-card">
          <div className="stat-top"><span>Pending total</span><div className="stat-icon"><ArrowUpCircle size={19} /></div></div>
          <strong>GH₵ {pendingTotal.toFixed(2)}</strong>
          <small>mixed GHS / NGN</small>
        </div>
        <div className="stat-card">
          <div className="stat-top"><span>Approved (awaiting payout)</span><div className="stat-icon"><Banknote size={19} /></div></div>
          <strong>GH₵ {approvedTotal.toFixed(2)}</strong>
          <small>pay out, then mark completed</small>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-field"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search user, reference, or phone..." /></div>
        <div className="withdrawal-filters">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={filter === f ? "secondary-button active" : "secondary-button"} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {notice && <p className={`wallet-action-notice ${notice.kind}`}>{notice.text}</p>}

      <section className="admin-card table-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Reference</th><th>User</th><th>Phone</th><th>Amount</th><th>Activation fee</th><th>Status</th><th>Requested</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td className="id-cell">{row.reference || row.id.slice(0, 8).toUpperCase()}</td>
                  <td><div className="user-cell"><span className="mini-avatar">{(row.username || "??").slice(0, 2).toUpperCase()}</span><div><strong>{row.username}</strong><small>{row.reference}</small></div></div></td>
                  <td>{row.phone || "—"}</td>
                  <td className="amount-cell">{money(row.amount, row.currency)}</td>
                  <td className="amount-cell">{money(row.activation_fee, row.currency)}</td>
                  <td><span className={`status ${statusColor(row.status)}`}>{row.status}</span></td>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>
                    <div className="withdrawal-actions">
                      {row.status === "pending" && <>
                        <button type="button" className="primary-button" disabled={acting === row.id} onClick={() => void act(row.id, "approve")}><CheckCircle2 size={14} /> Approve</button>
                        <button type="button" className="secondary-button" disabled={acting === row.id} onClick={() => void act(row.id, "reject")}><XCircle size={14} /> Reject</button>
                      </>}
                      {row.status === "approved" && <>
                        <button type="button" className="primary-button" disabled={acting === row.id} onClick={() => void act(row.id, "complete")}><Banknote size={14} /> Mark paid</button>
                        <button type="button" className="secondary-button" disabled={acting === row.id} onClick={() => void act(row.id, "fail")}><XCircle size={14} /> Fail</button>
                      </>}
                      {!["pending", "approved"].includes(row.status) && <span className="muted-text">{row.status}</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="empty-table">{loading ? "Loading..." : filter === "pending" ? "No pending withdrawal requests." : "No withdrawal requests found."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-card payout-note">
        <ShieldCheck size={18} />
        <p><strong>How payouts work:</strong> Approving a request does not move money via Paystack automatically. Send the payout yourself via the user's MoMo or bank account (use the phone number shown), then click <em>Mark paid</em> to close the request. Rejected or failed requests return the funds to the user's wallet instantly.</p>
      </section>
    </AdminShell>
  );
}
