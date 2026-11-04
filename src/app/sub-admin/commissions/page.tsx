"use client";

import AdminShell from "@/components/admin-shell";
import { Wallet, Users, TrendingUp, CheckCircle2, Play } from "lucide-react";
import { useEffect, useState } from "react";

type CommissionRow = {
  id: string;
  username: string | null;
  phone: string | null;
  referral_code: string | null;
  balance: number;
  referred_count: number;
  deposits_count: number;
  deposits_total: number;
  commission_count: number;
  commission_total: number;
  created_at: string;
};

export default function CommissionsPage() {
  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [settling, setSettling] = useState(false);
  const [lastSettlement, setLastSettlement] = useState<{ paid: number; earned: number } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/staff/commissions", { cache: "no-store" });
      const data = await response.json() as { commissions?: CommissionRow[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Unable to load commissions.");
      setRows(data.commissions || []);
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "Unable to load commissions." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function runSettlement() {
    setSettling(true);
    setNotice(null);
    try {
      const response = await fetch("/api/staff/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await response.json() as { ok?: boolean; commissions_paid?: number; total_amount?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not settle commissions.");
      const paid = data.commissions_paid || 0;
      const earned = data.total_amount || 0;
      setLastSettlement({ paid, earned });
      setNotice({
        kind: "success",
        text: paid > 0
          ? `${paid} deposit commission${paid === 1 ? "" : "s"} paid — GH₵ ${earned.toFixed(2)} credited to sub-admin wallets (65% of deposits).`
          : "No unpaid deposit commissions found."
      });
      await load();
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "Could not settle commissions." });
    } finally {
      setSettling(false);
    }
  }

  const totalReferred = rows.reduce((t, r) => t + r.referred_count, 0);
  const totalDepositsCount = rows.reduce((t, r) => t + r.deposits_count, 0);
  const totalDepositsValue = rows.reduce((t, r) => t + r.deposits_total, 0);
  const totalCommissions = rows.reduce((t, r) => t + r.commission_count, 0);
  const totalEarned = rows.reduce((t, r) => t + r.commission_total, 0);

  return (
    <AdminShell title="Sub-admin commissions" description="Sub-admins earn 65% of every deposit their referred users make — added on top of the user's full deposit. The user keeps 100% and never sees the commission.">
      <div className="stats-grid stats-grid-3">
        <div className="stat-card">
          <div className="stat-top"><span>Referred deposits</span><div className="stat-icon"><Users size={19} /></div></div>
          <strong>{totalDepositsCount}</strong>
          <small>GH₵ {totalDepositsValue.toFixed(2)} from {totalReferred} referred users</small>
        </div>
        <div className="stat-card">
          <div className="stat-top"><span>Deposit commissions paid</span><div className="stat-icon"><CheckCircle2 size={19} /></div></div>
          <strong>{totalCommissions}</strong>
          <small>65% of each deposit</small>
        </div>
        <div className="stat-card">
          <div className="stat-top"><span>Total earned (65%)</span><div className="stat-icon"><Wallet size={19} /></div></div>
          <strong>GH₵ {totalEarned.toFixed(2)}</strong>
          <small>credited to sub-admin wallets</small>
        </div>
      </div>

      <div className="toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <TrendingUp size={17} />
          <span style={{ fontSize: 12, color: "#888a94" }}>Rate: <strong>65% of every referred deposit</strong> · User keeps 100% · Hidden</span>
        </div>
        <button type="button" className="primary-button" onClick={() => void runSettlement()} disabled={settling}>
          <Play size={15} /> {settling ? "Settling…" : "Run backfill sweep"}
        </button>
      </div>

      {notice && <p className={`wallet-action-notice ${notice.kind}`}>{notice.text}</p>}
      {lastSettlement && <p style={{ fontSize: 11, color: "#888a94", marginTop: 8 }}>Last sweep: {lastSettlement.paid} commissions · GH₵ {lastSettlement.earned.toFixed(2)}</p>}

      <section className="admin-card table-card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Sub-admin</th><th>Phone</th><th>Referred users</th><th>Deposits (65%)</th><th>Commissions paid</th><th>Total earned</th><th>Wallet balance</th><th>Joined</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><div className="user-cell"><span className="mini-avatar">{(row.username || "SA").slice(0, 2).toUpperCase()}</span><div><strong>{row.username || "Sub-admin"}</strong><small>{row.referral_code ? `/${row.referral_code.slice(0, 8)}` : "no code"}</small></div></div></td>
                  <td>{row.phone || "—"}</td>
                  <td>{row.referred_count}</td>
                  <td>{row.deposits_count} · GH₵ {Number(row.deposits_total || 0).toFixed(2)}</td>
                  <td>{row.commission_count}</td>
                  <td className="amount-cell">GH₵ {Number(row.commission_total || 0).toFixed(2)}</td>
                  <td className="amount-cell">GH₵ {Number(row.balance || 0).toFixed(2)}</td>
                  <td>{new Date(row.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="empty-table">{loading ? "Loading…" : "No sub-admins found."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 13, margin: "0 0 8px" }}>How 65% commissions work</h2>
        <ol style={{ fontSize: 12, color: "#555762", lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
          <li>A customer signs up through a sub-admin&apos;s referral link (<code>/register?ref=...</code>) — they&apos;re linked to that sub-admin forever.</li>
          <li>Every time that customer deposits, the sub-admin earns an <strong>additional 65%</strong> of the deposit on top. Example: user deposits <strong>GH₵ 100 → user gets +GH₵ 100, sub-admin gets +GH₵ 65.</strong></li>
          <li>The user never sees this. Their deposit is credited 100% — the 65% is platform subsidy (your cost), not a split.</li>
          <li>Settlement happens instantly at deposit time. The <strong>Run backfill sweep</strong> button only pays deposits that settled before this model (idempotent — already-paid deposits reference-check first).</li>
          <li>One commission per deposit. Re-running the sweep is safe.</li>
        </ol>
        <p style={{ fontSize: 11, color: "#888a94", marginTop: 10 }}>Rate is defined once in <code>src/lib/limits.ts</code> (<code>COMMISSION_RATE = 0.65</code>). Change it there and redeploy — past commissions keep their original percentages.</p>
      </section>
    </AdminShell>
  );
}
