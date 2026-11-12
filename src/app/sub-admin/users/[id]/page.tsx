import AdminShell from "@/components/admin-shell";
import TransactionFlagActions from "@/components/transaction-flag-actions";
import { ArrowLeft, Mail, Phone, UserRound, WalletCards } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Children, type ReactNode } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCustomerAmount } from "@/lib/currency";

type PageProps = { params: Promise<{ id: string }> };
type Transaction = { id: string; type: string; amount: number; status: string; reference: string | null; created_at: string };
type Bet = { id: string; stake: number; potential_return: number; status: string; selections: unknown; placed_at: string };

export default async function UserDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: user } = await supabase.from("customer_accounts").select("id,username,email,phone,balance,currency,referred_by,created_at").eq("id", id).single();
  if (!user) notFound();
  const { data: { user: staffUser } } = await supabase.auth.getUser();
  const { data: staffProfile } = staffUser ? await supabase.from("profiles").select("role").eq("id", staffUser.id).single() : { data: null };
  if (staffProfile?.role === "sub_admin" && staffUser && user.referred_by !== staffUser.id) notFound();
  const isAdmin = staffProfile?.role === "admin";
  const currency = user.currency || "GHS";

  const [{ data: transactions, error: transactionsError }, { data: bets, error: betsError }] = await Promise.all([
    supabase.from("customer_transactions").select("id,type,amount,status,reference,created_at").eq("account_id", id).order("created_at", { ascending: false }),
    supabase.from("customer_bets").select("id,stake,potential_return,status,selections,placed_at").eq("account_id", id).order("placed_at", { ascending: false })
  ]);
  const transactionRows = (transactions || []) as Transaction[];
  const betRows = (bets || []) as Bet[];
  const openBets = betRows.filter((bet) => bet.status.toLowerCase() === "open");

  return <AdminShell title="Customer details" description={`Full account activity for ${user.username}.`}>
    <Link className="back-link" href="/sub-admin/users"><ArrowLeft size={15} /> Back to users</Link>
    <section className="admin-card customer-profile-page">
      <div className="customer-profile-heading"><div className="user-profile-avatar">{user.username.slice(0, 2).toUpperCase()}</div><div><span className="modal-eyebrow">CUSTOMER PROFILE</span><h2>{user.username}</h2><p>Customer account · Joined {new Date(user.created_at).toLocaleString()}</p></div><span className="status active">Active</span></div>
      <div className="user-detail-grid"><div className="user-detail-item"><span><Phone size={15} /> Phone</span><strong>{user.phone}</strong></div><div className="user-detail-item"><span><Mail size={15} /> Email</span><strong>{user.email || "No email added"}</strong></div><div className="user-detail-item"><span><UserRound size={15} /> Account ID</span><strong>{user.id}</strong></div><div className="user-detail-item"><span><WalletCards size={15} /> Currency</span><strong>{user.currency || "GHS"}</strong></div></div>
      <div className="user-balance-panel"><span>Wallet balance</span><strong>{user.currency === "NGN" ? "₦" : "GH₵"} {Number(user.balance || 0).toFixed(2)}</strong></div>
    </section>
    {transactionsError && <div className="admin-inline-error">Could not load transaction history: {transactionsError.message}</div>}
    {betsError && <div className="admin-inline-error">Could not load bet history: {betsError.message}</div>}
    <div className="customer-activity-grid"><ActivityTable title={`All transaction history (${transactionRows.length})`} empty="No transactions found." headers={isAdmin ? ["Reference", "Type", "Amount", "Status", "Date", "Actions"] : ["Reference", "Type", "Amount", "Status", "Date"]}>{transactionRows.map((transaction) => <tr key={transaction.id}><td className="id-cell">{transaction.reference || transaction.id.slice(0, 8).toUpperCase()}</td><td>{transaction.type.replaceAll("_", " ")}</td><td className="amount-cell">{formatCustomerAmount(transaction.amount, currency)}</td><td><span className={`status ${transaction.status.toLowerCase()}`}>{transaction.status}</span></td><td>{new Date(transaction.created_at).toLocaleString()}</td>{isAdmin && <td className="transaction-actions-cell"><TransactionFlagActions transaction={transaction} isAdmin={isAdmin} accountName={user.username} /></td>}</tr>)}</ActivityTable><ActivityTable title={`Bet history (${betRows.length})`} empty="No bets found." headers={["Bet ID", "Stake", "Potential return", "Status", "Placed"]}>{betRows.map((bet) => <tr key={bet.id}><td className="id-cell">{bet.id.slice(0, 8).toUpperCase()}</td><td className="amount-cell">{formatCustomerAmount(bet.stake, currency)}</td><td className="amount-cell">{formatCustomerAmount(bet.potential_return, currency)}</td><td><span className={`status ${bet.status.toLowerCase()}`}>{bet.status}</span></td><td>{new Date(bet.placed_at).toLocaleString()}</td></tr>)}</ActivityTable></div>
    <ActivityTable title={`Open bets (${openBets.length})`} empty="No open bets found." headers={["Bet ID", "Stake", "Potential return", "Selections", "Placed"]}>{openBets.map((bet) => <tr key={bet.id}><td className="id-cell">{bet.id.slice(0, 8).toUpperCase()}</td><td className="amount-cell">{formatCustomerAmount(bet.stake, currency)}</td><td className="amount-cell">{formatCustomerAmount(bet.potential_return, currency)}</td><td>{Array.isArray(bet.selections) ? bet.selections.length : "—"}</td><td>{new Date(bet.placed_at).toLocaleString()}</td></tr>)}</ActivityTable>
  </AdminShell>;
}

function ActivityTable({ title, empty, headers, children }: { title: string; empty: string; headers: string[]; children: ReactNode }) {
  return <section className="admin-card table-card customer-activity-card"><div className="card-heading"><div><h2>{title}</h2><p>Complete records from the customer account.</p></div></div><div className="table-wrap"><table><thead><tr>{headers.map((header) => <th key={header} className={header === "Actions" ? "transaction-actions-cell" : undefined}>{header}</th>)}</tr></thead><tbody>{Children.count(children) > 0 ? children : <tr><td colSpan={headers.length} className="empty-table">{empty}</td></tr>}</tbody></table></div></section>;
}
