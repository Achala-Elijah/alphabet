"use client";

import AdminShell from "@/components/admin-shell";
import { Copy, Link as LinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";

export default function ReferralPage() {
  const [code, setCode] = useState("");
  const [origin, setOrigin] = useState("");
  const [role, setRole] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/staff/profile", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { referral_code?: string | null; role?: string; error?: string };
        if (!response.ok) throw new Error(result.error || "Unable to load your referral link.");
        setCode(result.referral_code || "");
        setRole(result.role || "");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load your referral link."))
      .finally(() => setLoaded(true));
  }, []);

  const link = code && origin ? `${origin}/register?ref=${code}` : "";
  async function copyLink() {
    if (!link) return;
    try {
      await copyText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copying failed — long-press the link to copy it.");
    }
  }

  return <AdminShell title="Book & share" description="Share your referral link to bring customers into your sales network.">
    <section className="admin-card referral-card">
      <div className="referral-card-icon"><LinkIcon size={22} /></div>
      <span className="modal-eyebrow">YOUR REFERRAL LINK</span>
      <h2>Invite customers</h2>
      <p>Customers who sign up through this link are automatically connected to your account.</p>
      {error && <div className="admin-inline-error">{error}</div>}
      {link && <div className="referral-share-box"><code>{link}</code><button type="button" className="primary-button" onClick={() => void copyLink()}><Copy size={15} />{copied ? "Copied" : "Copy link"}</button></div>}
      {!link && !error && loaded && <p>{role === "admin" ? "Admin accounts don't have a referral link — this page is for sub-admins." : "Your referral link is not ready yet. Run supabase/referrals-migration.sql in Supabase, then refresh."}</p>}
      {!link && !error && !loaded && <p>Loading your referral link...</p>}
    </section>
  </AdminShell>;
}
