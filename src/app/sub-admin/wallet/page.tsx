import AdminShell from "@/components/admin-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Wallet, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import WalletActions from "@/components/wallet-actions";

type WalletRow = { id: string; type: string; amount: number; status: string; reference: string | null; created_at: string };

export default async function SubAdminWallet({ searchParams }: { searchParams: Promise<{ reference?: string; trxref?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const params = await searchParams;
  const ref = params.reference || params.trxref;
  let paymentNotice: { kind: "success" | "error"; text: string } | null = null;

  // The payment gateway returns here after checkout. Verify and settle the
  // deposit server-side once so the staff wallet shows the fresh balance.
  if (ref && user) {
    try {
      const { paymentsClient, verifyAndSettle } = await import("@/lib/payments/service");
      const result = await verifyAndSettle(paymentsClient(), ref, { type: "staff", staffId: user.id });
      if (result.status === "paid") {
        paymentNotice = {
          kind: "success",
          text: `Payment confirmed! GH₵ ${result.balance.toFixed(2)} is your new balance.`
        };
      } else if (result.status === "failed") {
        paymentNotice = { kind: "error", text: "The payment could not be completed or was cancelled." };
      }
    } catch (err) {
      console.error("Auto verify on staff return failed:", err);
    }
  }

  const { data: profile } = user ? await supabase.from("profiles").select("username, balance").eq("id", user.id).single() : { data: null };
  const { data: rows } = user
    ? await supabase.from("transactions").select("id, type, amount, status, reference, created_at").eq("user_id", user.id).in("type", ["deposit", "withdrawal"]).order("created_at", { ascending: false }).limit(50)
    : { data: [] as WalletRow[] };

  const transactions = (rows || []) as WalletRow[];
  const balance = Number(profile?.balance || 0);
  const totalDeposits = transactions.filter((row) => row.type === "deposit").reduce((total, row) => total + Number(row.amount || 0), 0);
  const totalWithdrawals = transactions.filter((row) => row.type === "withdrawal").reduce((total, row) => total + Number(row.amount || 0), 0);

  const stats = [
    { label: "Account balance", value: `GH₵ ${balance.toFixed(2)}`, icon: Wallet },
    { label: "Total deposits", value: `GH₵ ${totalDeposits.toFixed(2)}`, icon: ArrowDownLeft },
    { label: "Total withdrawals", value: `GH₵ ${totalWithdrawals.toFixed(2)}`, icon: ArrowUpRight }
  ];

  return <AdminShell title="Wallet" description="Your account balance with every deposit and withdrawal in one place.">
    {paymentNotice && <p className={`wallet-action-notice ${paymentNotice.kind}`}>{paymentNotice.text}</p>}
    <div className="stats-grid stats-grid-3">{stats.map(({ label, value, icon: Icon }) => <div className="stat-card" key={label}><div className="stat-top"><span>{label}</span><div className="stat-icon"><Icon size={19} /></div></div><strong>{value}</strong></div>)}</div>
    <section className="admin-card wallet-action-card">
      <div className="wallet-action-heading"><h2>Deposit or withdraw</h2><p>Enter an amount, then choose where it should go.</p></div>
      <WalletActions mode="staff" layout="admin" />
    </section>
    <section className="admin-card table-card"><div className="card-heading"><div><h2>Deposits & withdrawals</h2><p>{profile?.username ? `Wallet activity for ${profile.username}` : "Wallet activity for your account"}</p></div></div><div className="table-wrap"><table><thead><tr><th>Transaction</th><th>Type</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>{transactions.map((row) => <tr key={row.id}><td className="id-cell">{row.reference || row.id.slice(0, 8).toUpperCase()}</td><td>{row.type === "deposit" ? <span className="credit-text">Deposit</span> : <span className="debit-text">Withdrawal</span>}</td><td className="amount-cell">GH₵ {Number(row.amount || 0).toFixed(2)}</td><td><span className={`status ${row.status.toLowerCase()}`}>{row.status}</span></td><td>{new Date(row.created_at).toLocaleString()}</td></tr>)}{transactions.length === 0 && <tr><td colSpan={5} className="empty-table">No deposits or withdrawals yet.</td></tr>}</tbody></table></div></section>
  </AdminShell>;
}
