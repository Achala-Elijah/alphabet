import Link from "next/link";
import AdminShell from "@/components/admin-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type OpenBet = {
  id: string;
  account_id: string;
  stake: number;
  potential_return: number;
  selections: unknown;
  placed_at: string;
};

type Account = {
  id: string;
  username: string;
  phone: string;
  email: string | null;
};

export default async function OpenBetsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user: staffUser } } = await supabase.auth.getUser();
  const { data: staffProfile } = staffUser ? await supabase.from("profiles").select("role").eq("id", staffUser.id).single() : { data: null };
  let accountsQuery = supabase.from("customer_accounts").select("id,username,phone,email");
  if (staffProfile?.role === "sub_admin" && staffUser) accountsQuery = accountsQuery.eq("referred_by", staffUser.id);
  const { data: accounts } = await accountsQuery;
  const accountIds = (accounts || []).map((account) => account.id);
  const { data: bets, error } = accountIds.length
    ? await supabase.from("customer_bets").select("id,account_id,stake,potential_return,selections,placed_at").eq("status", "open").in("account_id", accountIds).order("placed_at", { ascending: false })
    : { data: [], error: null };
  const accountById = new Map(((accounts || []) as Account[]).map((account) => [account.id, account]));
  const rows = (bets || []) as OpenBet[];

  return <AdminShell title="Open bets" description="Monitor unsettled bets and the customers behind them.">
    {error && <div className="admin-inline-error">Could not load open bets: {error.message}</div>}
    <div className="stats-grid compact-stats">
      <div className="stat-card"><div className="stat-top"><span>Open bets</span><div className="stat-icon">#</div></div><strong>{rows.length}</strong></div>
      <div className="stat-card"><div className="stat-top"><span>Open stake value</span><div className="stat-icon">GH</div></div><strong>GH₵ {rows.reduce((total, bet) => total + Number(bet.stake || 0), 0).toFixed(2)}</strong></div>
      <div className="stat-card"><div className="stat-top"><span>Potential returns</span><div className="stat-icon">↗</div></div><strong>GH₵ {rows.reduce((total, bet) => total + Number(bet.potential_return || 0), 0).toFixed(2)}</strong></div>
    </div>
    <section className="admin-card table-card">
      <div className="card-heading"><div><h2>All open bets</h2><p>Unsettled customer bets requiring ongoing monitoring.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Bet</th><th>User</th><th>Phone</th><th>Stake</th><th>Potential return</th><th>Selections</th><th>Placed</th><th>Profile</th></tr></thead><tbody>
        {rows.map((bet) => {
          const account = accountById.get(bet.account_id);
          return <tr key={bet.id}><td className="id-cell">{bet.id.slice(0, 8).toUpperCase()}</td><td><div className="user-cell"><span className="mini-avatar">{(account?.username || "??").slice(0, 2).toUpperCase()}</span><div><strong>{account?.username || "Unknown user"}</strong><small>{account?.email || "No email added"}</small></div></div></td><td>{account?.phone || "—"}</td><td className="amount-cell">GH₵ {Number(bet.stake || 0).toFixed(2)}</td><td className="amount-cell">GH₵ {Number(bet.potential_return || 0).toFixed(2)}</td><td>{Array.isArray(bet.selections) ? bet.selections.length : "—"}</td><td>{new Date(bet.placed_at).toLocaleString()}</td><td>{account && <Link className="user-details-link" href={`/sub-admin/users/${account.id}`}>View user</Link>}</td></tr>;
        })}
        {rows.length === 0 && <tr><td colSpan={8} className="empty-table">No open bets right now.</td></tr>}
      </tbody></table></div>
    </section>
  </AdminShell>;
}
