import AdminShell from "@/components/admin-shell";
import { ArrowLeft, CalendarDays, Eye, Hash, Link as LinkIcon, Phone, UserRound, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import CopyReferralLink from "./copy-referral-link";

type PageProps = { params: Promise<{ id: string }> };
type ReferredUser = { id: string; username: string; email: string | null; phone: string; balance: number; currency: string | null; created_at: string };

export default async function SubAdminDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user: actor } } = await supabase.auth.getUser();
  const { data: actorProfile } = actor ? await supabase.from("profiles").select("role").eq("id", actor.id).single() : { data: null };
  if (actorProfile?.role !== "admin") notFound();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminClient = url && serviceKey ? createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
  if (!adminClient) {
    return <AdminShell title="Sub-admin details" description="Profile and referral activity for a staff account.">
      <div className="admin-inline-error">Sub-admin management is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server .env file and restart Next.js.</div>
    </AdminShell>;
  }

  const { data: subAdmin } = await adminClient.from("profiles").select("id,username,phone,role,balance,referral_code,created_at,updated_at").eq("id", id).eq("role", "sub_admin").maybeSingle();
  if (!subAdmin) notFound();

  const { data: referred, error: referredError } = await supabase.from("customer_accounts").select("id,username,email,phone,balance,currency,created_at").eq("referred_by", id).order("created_at", { ascending: false });
  const referredRows = (referred || []) as ReferredUser[];
  const accountIds = referredRows.map((row) => row.id);
  const { count: openBetCount } = accountIds.length
    ? await supabase.from("customer_bets").select("id", { count: "exact", head: true }).eq("status", "open").in("account_id", accountIds)
    : { count: 0 };

  const totalBalance = referredRows.reduce((total, row) => total + Number(row.balance || 0), 0);
  const stats = [
    { label: "Referred customers", value: String(referredRows.length), icon: Users },
    { label: "Customer balances", value: `GH₵ ${totalBalance.toFixed(2)}`, icon: Wallet },
    { label: "Open bets", value: String(openBetCount || 0), icon: CalendarDays }
  ];

  return <AdminShell title="Sub-admin details" description={`Everything about ${subAdmin.username || "this sub-admin"} and the customers on their referral link.`}>
    <Link className="back-link" href="/sub-admin/staff"><ArrowLeft size={15} /> Back to sub-admins</Link>
    <section className="admin-card customer-profile-page">
      <div className="customer-profile-heading"><div className="user-profile-avatar">{(subAdmin.username || "SA").slice(0, 2).toUpperCase()}</div><div><span className="modal-eyebrow">SUB-ADMIN PROFILE</span><h2>{subAdmin.username || "Unnamed sub-admin"}</h2><p>Staff account · Joined {new Date(subAdmin.created_at).toLocaleString()}</p></div><span className="status active">Sub-admin</span></div>
      <div className="user-detail-grid">
        <div className="user-detail-item"><span><Phone size={15} /> Phone</span><strong>{subAdmin.phone || "No phone added"}</strong></div>
        <div className="user-detail-item"><span><UserRound size={15} /> Role</span><strong>Sub Admin</strong></div>
        <div className="user-detail-item"><span><Hash size={15} /> Account ID</span><strong>{subAdmin.id}</strong></div>
        <div className="user-detail-item"><span><CalendarDays size={15} /> Last updated</span><strong>{subAdmin.updated_at ? new Date(subAdmin.updated_at).toLocaleString() : "—"}</strong></div>
      </div>
      <div className="user-balance-panel"><span>Wallet balance</span><strong>GH₵ {Number(subAdmin.balance || 0).toFixed(2)}</strong></div>
      <div className="staff-referral-panel"><span><LinkIcon size={15} /> Referral link</span>{subAdmin.referral_code ? <CopyReferralLink code={subAdmin.referral_code} /> : <strong>Not generated</strong>}</div>
    </section>
    <div className="stats-grid stats-grid-3">{stats.map(({ label, value, icon: Icon }) => <div className="stat-card" key={label}><div className="stat-top"><span>{label}</span><div className="stat-icon"><Icon size={19} /></div></div><strong>{value}</strong></div>)}</div>
    {referredError && <div className="admin-inline-error">Could not load referred customers: {referredError.message}</div>}
    <section className="admin-card table-card">
      <div className="card-heading"><div><h2>Customers from their referral link ({referredRows.length})</h2><p>Accounts that signed up with {subAdmin.username || "this sub-admin"}&apos;s referral link.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>User</th><th>Phone</th><th>Wallet balance</th><th>Joined</th><th>Details</th></tr></thead><tbody>
        {referredRows.map((row) => <tr key={row.id}><td><Link className="user-table-link" href={`/sub-admin/users/${row.id}`}><div className="user-cell"><span className="mini-avatar">{row.username.slice(0, 2).toUpperCase()}</span><div><strong>{row.username}</strong><small>{row.email || "No email added"}</small></div></div></Link></td><td>{row.phone}</td><td className="amount-cell">GH₵ {Number(row.balance || 0).toFixed(2)}</td><td>{new Date(row.created_at).toLocaleDateString()}</td><td><Link className="user-details-link" href={`/sub-admin/users/${row.id}`}><Eye size={14} /> <span>View details</span></Link></td></tr>)}
        {referredRows.length === 0 && <tr><td colSpan={5} className="empty-table">No customers have signed up with this referral link yet.</td></tr>}
      </tbody></table></div>
    </section>
  </AdminShell>;
}
