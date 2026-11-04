import AdminShell from "@/components/admin-shell";
import { Handshake, TrendingUp, Wallet, Users } from "lucide-react";

export default function PartnersPage() {
  return <AdminShell title="Partner analytics" description="Review partner performance, referrals, and commissions.">
    <div className="stats-grid compact-stats"><div className="stat-card"><div className="stat-top"><span>Total partners</span><Handshake size={18}/></div><strong>0</strong><small>No partner module configured</small></div><div className="stat-card"><div className="stat-top"><span>Partner referrals</span><Users size={18}/></div><strong>0</strong><small>No referral data</small></div><div className="stat-card"><div className="stat-top"><span>Commissions paid</span><Wallet size={18}/></div><strong>GH₵ 0.00</strong><small>No commission ledger</small></div><div className="stat-card"><div className="stat-top"><span>Conversion rate</span><TrendingUp size={18}/></div><strong>0%</strong><small>Awaiting partner integration</small></div></div>
    <section className="admin-card table-card"><div className="card-heading"><div><h2>Partner performance</h2><p>Partner analytics will appear when the partner module is connected.</p></div></div><div className="empty-table">No partner records are available yet.</div></section>
  </AdminShell>;
}
