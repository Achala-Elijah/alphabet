"use client";

import Link from "next/link";
import { Search, CircleUserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { formatCustomerAmount } from "@/lib/currency";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type CustomerSession = { username: string; balance: number; currency?: string | null; role?: "admin" | "sub_admin"; staff?: boolean };

export default function ClientHeader() {
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const handler = () => setRefreshKey((key) => key + 1);
    window.addEventListener("alphabet:balance-updated", handler);
    window.addEventListener("betkiing:balance-updated", handler);
    return () => {
      window.removeEventListener("alphabet:balance-updated", handler);
      window.removeEventListener("betkiing:balance-updated", handler);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadSession() {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: { session: browserSession } } = await supabase.auth.getSession();
        if (browserSession?.user) {
          const profileResponse = await fetch("/api/staff/profile", { cache: "no-store" });
          if (profileResponse.ok) {
            const profile = await profileResponse.json() as { username?: string | null; phone?: string | null; role: "admin" | "sub_admin"; balance?: number };
            if (active) {
              setSession({ username: profile.username || profile.phone || browserSession.user.user_metadata?.username || "Staff", balance: Number(profile.balance || 0), currency: "GHS", role: profile.role, staff: true });
              setSessionResolved(true);
            }
            return;
          }
        }
        const customerResponse = await fetch("/api/auth/customer", { cache: "no-store" });
        if (customerResponse.ok) {
          const value = await customerResponse.json() as CustomerSession;
          if (active) {
            setSession(value);
            setSessionResolved(true);
          }
          return;
        }
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (active) {
            setSession(null);
            setSessionResolved(true);
          }
          return;
        }
        const profileResponse = await fetch("/api/staff/profile", { cache: "no-store" });
        if (!profileResponse.ok) {
          if (active) {
            setSession(null);
            setSessionResolved(true);
          }
          return;
        }
        const profile = await profileResponse.json() as { username?: string | null; phone?: string | null; role: "admin" | "sub_admin"; balance?: number };
        if (active) {
          setSession({ username: profile.username || profile.phone || "Staff", balance: Number(profile.balance || 0), currency: "GHS", role: profile.role, staff: true });
          setSessionResolved(true);
        }
      } catch {
        if (active) {
          setSession(null);
          setSessionResolved(true);
        }
      }
    }
    void loadSession();
    const supabase = createSupabaseBrowserClient();
    const { data: listener } = supabase.auth.onAuthStateChange(() => { void loadSession(); });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [refreshKey]);

  const initials = session?.username.slice(0, 2).toUpperCase() || "";
  const accountHref = session ? "/account" : sessionResolved ? "/login" : "/";
  return (
    <header className="client-header">
      <Link href="/" className="brand-wordmark">AlphaBet</Link>
      <div className="header-actions">
        <button aria-label="Search" className="icon-button"><Search size={24} /></button>
        <Link href={accountHref} className="balance-pill" aria-label={session ? `Signed in as ${session.username}` : sessionResolved ? "Sign in" : "Loading account"}>
          <span className="avatar">{initials || <CircleUserRound size={17} />}</span>
          <span>{session ? formatCustomerAmount(session.balance, session.currency) : sessionResolved ? "Sign in" : "…"}</span>
        </Link>
      </div>
    </header>
  );
}
