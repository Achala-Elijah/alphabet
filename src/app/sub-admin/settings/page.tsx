"use client";

import AdminShell from "@/components/admin-shell";
import { Bell, ShieldCheck, Save, LoaderCircle } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

const NOTIFICATION_KEYS = [
  "New user registrations",
  "Deposits and withdrawals",
  "Partner activity",
  "Match status updates"
] as const;

const STORAGE_KEY = "alphabet:staff-notifications";

export default function SettingsPage() {
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [notifications, setNotifications] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NOTIFICATION_KEYS.map((key) => [key, true]))
  );

  useEffect(() => {
    fetch("/api/staff/profile", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { username?: string; phone?: string; error?: string };
        if (!response.ok) throw new Error(result.error || "Unable to load your profile.");
        setUsername(result.username || "");
        setPhone(result.phone || "");
      })
      .catch((reason: unknown) => setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "Unable to load your profile." }))
      .finally(() => setLoading(false));

    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setNotifications((current) => ({ ...current, ...JSON.parse(saved) as Record<string, boolean> }));
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, []);

  function toggleNotification(key: string) {
    setNotifications((current) => {
      const next = { ...current, [key]: !current[key] };
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/staff/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, phone })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to save your profile.");
      setNotice({ kind: "success", text: "Profile saved." });
    } catch (reason) {
      setNotice({ kind: "error", text: reason instanceof Error ? reason.message : "Unable to save your profile." });
    } finally {
      setSaving(false);
    }
  }

  return <AdminShell title="Settings" description="Manage your sub-admin preferences and workspace settings.">
    <div className="settings-grid">
      <section className="admin-card settings-card">
        <h2><Bell size={19} /> Notifications</h2>
        <p>Choose which workspace events you want to be alerted about.</p>
        {NOTIFICATION_KEYS.map((key) => (
          <label className="toggle-row" key={key}>
            <span>{key}</span>
            <input type="checkbox" checked={notifications[key]} onChange={() => toggleNotification(key)} />
            <i />
          </label>
        ))}
      </section>
      <section className="admin-card settings-card">
        <h2><ShieldCheck size={19} /> Account preferences</h2>
        <p>Authenticated staff profile information.</p>
        <form onSubmit={saveProfile}>
          <label className="form-label">Display name<input value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} placeholder="Your name" /></label>
          <label className="form-label">Phone number<input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" required minLength={7} placeholder="+233 20 000 0000" /></label>
          <label className="form-label">Language<select defaultValue="English"><option>English</option></select></label>
          {notice && <p className={notice.kind === "success" ? "admin-success" : "admin-inline-error"}>{notice.text}</p>}
          <button className="primary-button" type="submit" disabled={saving || loading}>
            {saving ? <><LoaderCircle size={16} className="spin" /> Saving…</> : <><Save size={16} /> Save changes</>}
          </button>
        </form>
      </section>
    </div>
  </AdminShell>;
}
