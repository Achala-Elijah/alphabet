"use client";

import Link from "next/link";
import { CircleUserRound, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { formatCustomerAmount } from "@/lib/currency";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { SEARCH_UPDATED_EVENT, readSearchQuery, writeSearchQuery } from "@/lib/search-query";

type CustomerSession = { username: string; balance: number; currency?: string | null; role?: "admin" | "sub_admin"; staff?: boolean };

export default function ClientHeader() {
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const searchTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Keep the visible value aligned with the URL, so opening a result (which
  // clears `q`) or using browser back/forward never leaves stale text behind.
  useEffect(() => {
    if (searchTimer.current) {
      window.clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }
    setQuery(readSearchQuery());
  }, [pathname]);

  useEffect(() => {
    const sync = () => setQuery(readSearchQuery());
    const onSearch = (event: Event) => {
      // Another part of the page (e.g. opening a result) took over — cancel
      // any pending debounce so it cannot overwrite that navigation.
      if (searchTimer.current) {
        window.clearTimeout(searchTimer.current);
        searchTimer.current = null;
      }
      const detail = (event as CustomEvent<string>).detail;
      setQuery(typeof detail === "string" ? detail : readSearchQuery());
    };
    window.addEventListener(SEARCH_UPDATED_EVENT, onSearch);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener(SEARCH_UPDATED_EVENT, onSearch);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  useEffect(() => () => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
  }, []);

  /** Push the typed term into the URL so the home page filters live. */
  function applyQuery(value: string) {
    const term = value.trim();
    if (pathname !== "/" && !term) return;
    const params = new URLSearchParams(pathname === "/" ? window.location.search : "");
    if (term) params.set("q", term);
    else params.delete("q");
    // A new search should not re-open an old match or stay on the Games tab.
    params.delete("match");
    params.delete("focus");
    params.delete("nav");
    const target = `/?${params.toString()}`;
    router.replace(target, { scroll: false });
  }

  function handleChange(value: string) {
    setQuery(value);
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => applyQuery(value), 220);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (!query.trim()) {
      inputRef.current?.focus();
      return;
    }
    applyQuery(query);
  }

  function clearSearch() {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    setQuery("");
    writeSearchQuery("");
    if (pathname === "/") applyQuery("");
  }

  const initials = session?.username.slice(0, 2).toUpperCase() || "";
  const accountHref = session ? "/account" : sessionResolved ? "/login" : "/";
  return (
    <header className="client-header">
      <Link href="/" className="brand-wordmark">AlphaBet</Link>
      <form className="header-search" role="search" onSubmit={handleSubmit}>
        <div className="header-search-field">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => handleChange(event.target.value)}
            placeholder="Search team"
            aria-label="Search matches"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button type="button" className="header-search-clear" onClick={clearSearch} aria-label="Clear search">
              <X size={13} />
            </button>
          )}
        </div>
        <button type="submit" className="header-search-submit" aria-label="Search matches">
          <Search size={18} />
        </button>
      </form>
      <div className="header-actions">
        <Link href={accountHref} className="balance-pill" aria-label={session ? `Signed in as ${session.username}` : sessionResolved ? "Sign in" : "Loading account"}>
          <span className="avatar">{initials || <CircleUserRound size={17} />}</span>
          <span>{session ? formatCustomerAmount(session.balance, session.currency) : sessionResolved ? "Sign in" : "…"}</span>
        </Link>
      </div>
    </header>
  );
}
