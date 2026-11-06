"use client";

import AdminShell from "@/components/admin-shell";
import { Eye } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";

type SubAdmin = { id: string; username: string | null; phone: string | null; referral_code: string | null; created_at: string };

export default function StaffPage() {
  const router = useRouter();
  const [subAdmins, setSubAdmins] = useState<SubAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copiedCode, setCopiedCode] = useState("");

  async function copyReferralLink(code: string) {
    try {
      await copyText(`${window.location.origin}/register?ref=${code}`);
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode(""), 1800);
    } catch {
      setNotice("Copying failed — long-press the link to copy it.");
    }
  }

  async function loadSubAdmins() {
    setLoadError("");
    try {
      const response = await fetch("/api/staff/sub-admins", { cache: "no-store" });
      const result = await response.json() as { error?: string; subAdmins?: SubAdmin[] };
      if (!response.ok) throw new Error(result.error || "Unable to load sub-admins.");
      setSubAdmins(result.subAdmins || []);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Unable to load sub-admins.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSubAdmins(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setNotice("");
    setSuccess("");
    setSubmitting(true);
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/staff/sub-admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), phone: form.get("phone"), password: form.get("password") })
      });
      const result = await response.json() as { error?: string; username?: string };
      if (!response.ok) throw new Error(result.error || "Unable to create sub-admin.");
      setSuccess(`${result.username || "The sub-admin"} can now sign in at /sub-admin/login.`);
      formElement.reset();
      await loadSubAdmins();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Unable to create sub-admin.");
    } finally {
      setSubmitting(false);
    }
  }

  return <AdminShell title="Sub-admins" description="View and create staff accounts for the operations workspace.">
    <section className="admin-card table-card staff-list-card">
      <div className="card-heading"><div><h2>All sub-admins</h2><p>Staff accounts with access to the operations workspace.</p></div></div>
      {loadError && <div className="admin-inline-error">{loadError}</div>}
      <div className="table-wrap"><table><thead><tr><th>Username</th><th>Phone</th><th>Referral link</th><th>Role</th><th>Created</th><th>Details</th></tr></thead><tbody>
        {loading && <tr><td colSpan={6} className="empty-table">Loading sub-admins...</td></tr>}
        {!loading && subAdmins.map((subAdmin) => <tr key={subAdmin.id} className="user-row-clickable" onClick={(event) => { if ((event.target as HTMLElement).closest("a, button")) return; router.push(`/sub-admin/staff/${subAdmin.id}`); }}><td><Link className="user-table-link" href={`/sub-admin/staff/${subAdmin.id}`}><div className="user-cell"><span className="mini-avatar">{(subAdmin.username || "SA").slice(0, 2).toUpperCase()}</span><strong>{subAdmin.username || "Unnamed sub-admin"}</strong></div></Link></td><td>{subAdmin.phone || "—"}</td><td className="referral-link-cell">{subAdmin.referral_code ? <div className="referral-action"><code>/register?ref={subAdmin.referral_code}</code><button type="button" className="copy-referral-button" onClick={() => void copyReferralLink(subAdmin.referral_code || "")}>{copiedCode === subAdmin.referral_code ? "Copied" : "Copy link"}</button></div> : "Not generated"}</td><td><span className="status active">Sub-admin</span></td><td>{new Date(subAdmin.created_at).toLocaleDateString()}</td><td><Link className="user-details-link" href={`/sub-admin/staff/${subAdmin.id}`}><Eye size={14} /> <span>View details</span></Link></td></tr>)}
        {!loading && subAdmins.length === 0 && <tr><td colSpan={6} className="empty-table">No sub-admins found.</td></tr>}
      </tbody></table></div>
    </section>
    <section className="admin-card staff-create-card">
      <div className="card-heading"><div><h2>Create a sub-admin</h2><p>Sub-admins can manage fixtures, users, open bets, partners, and transactions.</p></div></div>
      <form className="staff-create-form" onSubmit={submit}>
        <div className="staff-form-grid"><label className="form-label">Username<input name="username" required minLength={3} placeholder="e.g. operations.team" /></label><label className="form-label">Phone number<input name="phone" type="tel" required minLength={7} placeholder="+233 20 000 0000" /></label><label className="form-label">Temporary password<input name="password" type="password" required minLength={6} placeholder="At least 6 characters" /></label></div>
        {notice && <p className="admin-inline-error">{notice}</p>}
        {success && <p className="admin-success">{success}</p>}
        <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Creating..." : "Create sub-admin"}</button>
      </form>
    </section>
  </AdminShell>;
}
