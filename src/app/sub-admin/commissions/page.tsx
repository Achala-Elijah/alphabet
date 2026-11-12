"use client";

import AdminShell from "@/components/admin-shell";
import { Wallet, Users, TrendingUp, CheckCircle2, Play, HandCoins } from "lucide-react";
import { useEffect, useState } from "react";
import { formatCustomerAmount, currencySymbol } from "@/lib/currency";

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

type MineRow = {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  status: string;
  reference: string | null;
  deposit_reference: string | null;
  type: string;
  created_at: string;
  username: string | null;
  phone: string | null;
};

export default function CommissionsPage() {
  const [scope, setScope] = useState<"self" | "all" | null>(null);
  const [rows, setRows] = useState<CommissionRow[]>([]);
  const [mineRows, setMineRows] = useState<MineRow[]>([]);
  const [mineTotals, setMineTotals] = useState<{ count: number; amount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [settling, setSettling] = useState(false);
  const [lastSettlement, setLastSettlement] = useState<{ paid: number; earned: number } | null>(null);

  // Date filter — default to today.
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  async function load(dateFrom = from, dateTo = to) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      const response = await fetch(`/api/staff/commissions?${params.toString()}`, { cache: "no-store" });
      const data = await response.json() as {
        scope?: "self" | "all";
        commissions?: CommissionRow[];
        rows?: MineRow[];
        total_count?: number;
        total_amount?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Unable to load commissions.");
      if (data.scope === "self") {
        setScope("self");
        setMineRows(data.rows || []);
        setMineTotals({ count: data.total_count ?? 0, amount: data.total_amount ?? 0 });
      } else {
        setScope("all");
        setRows(data.commissions || []);
      }
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
          ? `${paid} deposit commission${paid === 1 ? "" : "s"} recorded — GH₵ ${earned.toFixed(2)} tracked in the commissions ledger (65% of deposits; balances not changed).`
          : "No unpaid deposit commissions found."
      });
      await load();
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "Could not settle commissions." });
    } finally {
      setSettling(false);
    }
  }

  function handleDateChange(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    void load(nextFrom, nextTo);
  }

  const totalReferred = rows.reduce((t, r) => t + r.referred_count, 0);
  const totalDepositsCount = rows.reduce((t, r) => t + r.deposits_count, 0);
  const totalDepositsValue = rows.reduce((t, r) => t + r.deposits_total, 0);
  const totalCommissions = rows.reduce((t, r) => t + r.commission_count, 0);
  const totalEarned = rows.reduce((t, r) => t + r.commission_total, 0);

  const dateFilterBar = (
    <div className="toolbar" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      <HandCoins size={18} />
      <span style={{ fontSize: 12, color: "#888a94" }}>Show commissions from <strong>{from || "beginning"}</strong> to <strong>{to || "now"}</strong></span>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#555762" }}>
        <span>From</span>
        <input
          type="date"
          value={from}
          onChange={(event) => handleDateChange(event.target.value, to)}
          style={{ height: 38, padding: "0 8px", border: "1px solid #dedfe5", borderRadius: 8, fontSize: 12 }}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#555762" }}>
        <span>To</span>
        <input
          type="date"
          value={to}
          onChange={(event) => handleDateChange(from, event.target.value)}
          style={{ height: 38, padding: "0 8px", border: "1px solid #dedfe5", borderRadius: 8, fontSize: 12 }}
        />
      </label>
      <button
        type="button"
        className="secondary-button"
        onClick={() => {
          const now = new Date().toISOString().slice(0, 10);
          setFrom(now);
          setTo(now);
          void load(now, now);
        }}
        style={{ height: 38, padding: "0 14px", fontSize: 12 }}
      >
        Today
      </button>
    </div>
  );

  return (
    <AdminShell
      title={scope === "self" ? "My commissions" : "Commissions"}
      description={
        scope === "self"
          ? "Every deposit commission earned by your referred customers — 65% of their deposits, hidden from them."
          : "Sub-admins earn 65% of every deposit their referred users make — added on top of the user's full deposit. The user keeps 100% and never sees the commission."
      }
    >
      {notice && <p className={`wallet-action-notice ${notice.kind}`}>{notice.text}</p>}

      {scope !== "self" && (
        <>
          <div className="stats-grid stats-grid-3">
            <div className="stat-card">
              <div className="stat-top"><span>Referred deposits</span><div className="stat-icon"><Users size={19} /></div></div>
              <strong>{totalDepositsCount}</strong>
              <small>{scope === "all" ? `GH₵ ${totalDepositsValue.toFixed(2)} from ${totalReferred} referred users` : ""}</small>
            </div>
            <div className="stat-card">
              <div className="stat-top"><span>Deposit commissions paid</span><div className="stat-icon"><CheckCircle2 size={19} /></div></div>
              <strong>{totalCommissions}</strong>
              <small>65% of each deposit</small>
            </div>
            <div className="stat-card">
              <div className="stat-top"><span>Total earned (65%)</span><div className="stat-icon"><Wallet size={19} /></div></div>
              <strong>GH₵ {totalEarned.toFixed(2)}</strong>
              <small>tracked in the commissions ledger</small>
            </div>
          </div>

          {dateFilterBar}

          <div className="toolbar">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <TrendingUp size={17} />
              <span style={{ fontSize: 12, color: "#888a94" }}>Rate: <strong>65% of every referred deposit</strong> · User keeps 100% · Hidden</span>
            </div>
            <button type="button" className="primary-button" onClick={() => void runSettlement()} disabled={settling}>
              <Play size={15} /> {settling ? "Settling…" : "Run backfill sweep"}
            </button>
          </div>

          {lastSettlement && <p style={{ fontSize: 11, color: "#888a94", marginTop: 8 }}>Last sweep: {lastSettlement.paid} commissions · GH₵ {lastSettlement.earned.toFixed(2)}</p>}

          <section className="admin-card table-card">
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Sub-admin</th>
                  <th>Phone</th>
                  <th>Referred users</th>
                  <th>Deposits (65%)</th>
                  <th>Commissions paid</th>
                  <th>Total earned</th>
                  <th>Wallet balance (in-app)</th>
                  <th>Joined</th>
                </tr></thead>
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
        </>
      )}

      {scope === "self" && (
        <>
          <div className="stats-grid stats-grid-3">
            <div className="stat-card">
              <div className="stat-top"><span>Commissions received</span><div className="stat-icon"><CheckCircle2 size={19} /></div></div>
              <strong>{mineTotals?.count ?? 0}</strong>
              <small>on {from} – {to}</small>
            </div>
            <div className="stat-card">
              <div className="stat-top"><span>Total earned (65%)</span><div className="stat-icon"><Wallet size={19} /></div></div>
              <strong>GH₵ {(mineTotals?.amount ?? 0).toFixed(2)}</strong>
              <small>tracked in the commissions ledger</small>
            </div>
          </div>

          {dateFilterBar}

          <section className="admin-card table-card">
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Reference</th>
                </tr></thead>
                <tbody>
                  {mineRows.map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.created_at).toLocaleString()}</td>
                      <td><strong>{row.username || "Customer"}</strong></td>
                      <td>{row.phone || "—"}</td>
                      <td>{(row.type || "commission").replaceAll("_", " ")}</td>
                      <td className="amount-cell">{formatCustomerAmount(row.amount, row.currency)}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{row.reference || row.deposit_reference || "—"}</td>
                    </tr>
                  ))}
                  {mineRows.length === 0 && (
                    <tr><td colSpan={6} className="empty-table">{loading ? "Loading…" : "No commissions for this date range."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="admin-card" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 13, margin: "0 0 8px" }}>How these commissions work</h2>
            <ul style={{ fontSize: 12, color: "#555762", lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
              <li>Your referred user deposits → you earn <strong>65% of that deposit</strong> on top of what the user already received.</li>
              <li>The user keeps 100% of their deposit — commissions are hidden and never deducted from their balance.</li>
              <li>Settlement happens instantly at deposit time.</li>
              <li>Each row above is one commission. Re-running an admin sweep is idempotent — it cannot double-pay.</li>
            </ul>
          </section>
        </>
      )}
    </AdminShell>
  );
}