"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = { username: string; email?: string | null; currency?: string | null };

export default function CustomerAccount({ username, email: initialEmail = "", currency: initialCurrency = "GHS" }: Props) {
  const router = useRouter();
  const [currency, setCurrency] = useState(initialCurrency || "GHS");
  const [email, setEmail] = useState(initialEmail || "");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    const response = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currency, email: email.trim() || null })
    });
    const result = await response.json() as { error?: string };
    setNotice(response.ok ? "Account preferences saved." : result.error || "Unable to save account preferences.");
    setSaving(false);
    if (response.ok) router.refresh();
  }

  return <section className="customer-account-settings">
    <h1>My Account</h1>
    <p>Manage your account preferences</p>
    <form onSubmit={save}>
      <label>Currency
        <select value={currency} onChange={(event) => setCurrency(event.target.value)}>
          <option value="GHS">Ghana cedis (GH₵)</option>
          <option value="NGN">Naira (₦)</option>
        </select>
      </label>
      <label>Username<input value={username} disabled /></label>
      <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="your@email.com" /></label>
      {notice && <p className="account-settings-notice">{notice}</p>}
      <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save changes"}</button>
    </form>
  </section>;
}
