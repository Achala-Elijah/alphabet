import AdminShell from "@/components/admin-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Users, Wallet, Ticket, Activity } from "lucide-react";

export default async function AdminOverview() {
  const supabase = await createSupabaseServerClient();
  const { data: { user: staffUser } } = await supabase.auth.getUser();
  const { data: staffProfile } = staffUser ? await supabase.from("profiles").select("role, balance").eq("id", staffUser.id).single() : { data: null };
  const referredFilter = staffProfile?.role === "sub_admin" ? staffUser?.id || null : null;
  let accountsQuery = supabase.from("customer_accounts").select("id, username");
  if (referredFilter) accountsQuery = accountsQuery.eq("referred_by", referredFilter);
  const { data: scopedAccounts } = await accountsQuery;
  const accountIds = (scopedAccounts || []).map((account) => account.id);
  const [{ count: userCount }, { count: betCount }, { data: transactions }, { count: matchCount }, { data: accounts }] = await Promise.all([
    referredFilter ? supabase.from("customer_accounts").select("id", { count: "exact", head: true }).eq("referred_by", referredFilter) : supabase.from("customer_accounts").select("id", { count: "exact", head: true }),
    accountIds.length ? supabase.from("customer_bets").select("id", { count: "exact", head: true }).eq("status", "open").in("account_id", accountIds) : supabase.from("customer_bets").select("id", { count: "exact", head: true }).eq("id", "00000000-0000-0000-0000-000000000000"),
    accountIds.length ? supabase.from("customer_transactions").select("id, account_id, type, amount, status, reference, created_at").in("account_id", accountIds).order("created_at", { ascending: false }).limit(5) : supabase.from("customer_transactions").select("id, account_id, type, amount, status, reference, created_at").eq("id", "00000000-0000-0000-0000-000000000000"),
    supabase.from("matches").select("id", { count: "exact", head: true }),
    supabase.from("customer_accounts").select("id, username").in("id", accountIds.length ? accountIds : ["00000000-0000-0000-0000-000000000000"])
  ]);
  const rows = transactions || [];
  const accountNames = new Map((accounts || []).map((account) => [account.id, account.username]));
  const totalTransactions = rows.reduce((total, transaction) => total + Number(transaction.amount || 0), 0);
  const myBalance = Number(staffProfile?.balance || 0);
  const stats = referredFilter
    ? [
      { label: "Referred customers", value: String(userCount || 0), icon: Users },
      { label: "Open bets", value: String(betCount || 0), icon: Ticket },
      { label: "My balance", value: `GH₵ ${myBalance.toFixed(2)}`, icon: Wallet }
    ]
    : [
      { label: "Customer accounts", value: String(userCount || 0), icon: Users },
      { label: "Open bets", value: String(betCount || 0), icon: Ticket },
      { label: "Recent transaction value", value: `GH₵ ${totalTransactions.toFixed(2)}`, icon: Wallet },
      { label: "Fixtures", value: String(matchCount || 0), icon: Activity }
    ];

  return <AdminShell title={referredFilter ? "My dashboard" : "Overview"} description={referredFilter ? "Monitor customers, bets, and wallet activity from your referral link." : "Monitor activity and performance across your platform."}>
    <div className={referredFilter ? "stats-grid stats-grid-3" : "stats-grid"}>{stats.map(({ label, value, icon: Icon }) => <div className="stat-card" key={label}><div className="stat-top"><span>{label}</span><div className="stat-icon"><Icon size={19} /></div></div><strong>{value}</strong></div>)}</div>
    <section className="admin-card table-card"><div className="card-heading"><div><h2>Recent transactions</h2><p>{referredFilter ? "Latest wallet activity from your referred customers" : "Latest wallet activity from customer accounts"}</p></div><a href="/sub-admin/transactions" className="view-all">View all</a></div><div className="table-wrap"><table><thead><tr><th>Transaction</th><th>User</th><th>Type</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>{rows.slice(0, 3).map((transaction) => <tr key={transaction.id}><td className="id-cell">{transaction.reference || transaction.id.slice(0, 8).toUpperCase()}</td><td>{accountNames.get(transaction.account_id) || "Unknown"}</td><td>{transaction.type.replace("_", " ")}</td><td className="amount-cell">GH₵ {Number(transaction.amount || 0).toFixed(2)}</td><td><span className={`status ${transaction.status.toLowerCase()}`}>{transaction.status}</span></td><td>{new Date(transaction.created_at).toLocaleString()}</td></tr>)}{rows.length === 0 && <tr><td colSpan={6} className="empty-table">{referredFilter ? "No referred-customer transactions yet." : "No platform transactions yet."}</td></tr>}</tbody></table></div></section>
  </AdminShell>;
}
