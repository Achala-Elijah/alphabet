"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useEffect, useRef, useState } from "react";
import { LayoutDashboard, Users, ArrowLeftRight, Menu, X, ArrowLeft, Ticket, UserPlus, Link as LinkIcon, ArrowUpCircle, SlidersHorizontal, CalendarDays, Wallet, HandCoins, Banknote, type LucideIcon } from "lucide-react";

type NavLink = { label: string; href: string; Icon: LucideIcon; external?: boolean };

const adminLinks: NavLink[] = [
  { label: "Dashboard", href: "/sub-admin", Icon: LayoutDashboard },
  { label: "Users", href: "/sub-admin/users", Icon: Users },
  { label: "Manage matches", href: "/sub-admin/matches", Icon: CalendarDays },
  { label: "Naira Deposits", href: "/sub-admin/naira-deposits", Icon: Banknote },
  { label: "Open bets", href: "/sub-admin/open-bets", Icon: Ticket },
  { label: "Sales", href: "/sub-admin/transactions", Icon: ArrowLeftRight },
  { label: "Withdrawals", href: "/sub-admin/withdrawals", Icon: ArrowUpCircle },
  { label: "Commissions", href: "/sub-admin/commissions", Icon: HandCoins },
  { label: "Partner analytics", href: "/sub-admin/partners", Icon: UserPlus },
  { label: "Sub-admins", href: "/sub-admin/staff", Icon: UserPlus },
  { label: "Settings", href: "/sub-admin/settings", Icon: SlidersHorizontal }
];

const subAdminLinks: NavLink[] = [
  { label: "My dashboard", href: "/sub-admin", Icon: LayoutDashboard },
  { label: "Users", href: "/sub-admin/users", Icon: Users },
  { label: "Manage matches", href: "/sub-admin/matches", Icon: CalendarDays },
  { label: "Open bets", href: "/sub-admin/open-bets", Icon: Ticket },
  { label: "My sales", href: "/sub-admin/transactions", Icon: ArrowLeftRight },
  { label: "Wallet", href: "/sub-admin/wallet", Icon: Wallet },
  { label: "Book & share", href: "/sub-admin/referral", Icon: LinkIcon }
];

export default function AdminShell({ children, title, description }: { children: React.ReactNode; title: string; description?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<"admin" | "sub_admin">("sub_admin");
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    try {
      const cached = window.localStorage.getItem("alphabet:staff-role");
      if (cached === "admin" || cached === "sub_admin") setRole(cached);
    } catch {
      // Storage can be unavailable in private browsing.
    }
    fetch("/api/staff/profile", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ role: "admin" | "sub_admin" }> : null)
      .then((profile) => {
        if (!profile?.role) return;
        setRole(profile.role);
        try { window.localStorage.setItem("alphabet:staff-role", profile.role); } catch { /* ignore */ }
      })
      .catch(() => undefined);
  }, []);

  // Close the mobile menu on any outside tap, and on Escape.
  useEffect(() => {
    if (!menuOpen) return;

    function onOutside(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (sidebarRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Also close when the user navigates to a new page.
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  // Keep the page behind the drawer from scrolling, and move focus inside it.
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    if (menuOpen) {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const frame = window.requestAnimationFrame(() => {
        sidebarRef.current?.querySelector<HTMLElement>("a, button")?.focus();
      });
      return () => {
        window.cancelAnimationFrame(frame);
        document.body.style.overflow = previousOverflow;
      };
    }
    return () => { previousFocus?.focus(); };
  }, [menuOpen]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try { window.localStorage.removeItem("alphabet:staff-role"); } catch { /* ignore */ }
    await createSupabaseBrowserClient().auth.signOut();
    router.replace("/sub-admin/login");
    router.refresh();
  }

  const isAdmin = role === "admin";
  const workspaceLabel = isAdmin ? "ADMIN" : "SUB-ADMIN";
  const roleLabel = isAdmin ? "Admin" : "Sub Admin";
  const roleDescription = isAdmin ? "Platform administrator" : "Operations workspace";
  const links = isAdmin ? adminLinks : subAdminLinks;
  return (
    <div className="admin-layout">
      {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <aside className={`admin-sidebar ${menuOpen ? "is-open" : ""}`} ref={sidebarRef}>
        <Link href="/" className="admin-logo">Alpha<span>Bet</span><small>{workspaceLabel}</small></Link>
        <div className="admin-profile"><div className="profile-avatar">{isAdmin ? "AD" : "SA"}</div><div><strong>{roleLabel}</strong><span>{roleDescription}</span></div></div>
        <p className="nav-caption">WORKSPACE</p>
        <nav className="admin-nav">
          {links.map(({ label, href, Icon, external }) => <Link key={href} href={href} className={pathname === href ? "selected" : ""} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}><Icon size={19} /><span>{label}</span></Link>)}
        </nav>
        <div className="sidebar-bottom"><Link href="/" title="Return to the sportsbook"><ArrowLeft size={18} />Back to website</Link><button type="button" className="admin-logout" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button></div>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <button
            ref={buttonRef}
            className={`mobile-menu ${menuOpen ? "is-open" : ""}`}
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <Link href="/" className="topbar-brand" aria-label="AlphaBet home">Alpha<span>Bet</span></Link>
          <Link href="/sub-admin" className="breadcrumb"><span>Admin</span><span>/</span> <strong>{title}</strong></Link>
          <div className="topbar-actions"><div className="top-avatar" aria-hidden="true">{isAdmin ? "AD" : "SA"}</div></div>
        </header>
        <div className="admin-content">
          <div className="page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div></div>
          {children}
        </div>
      </main>
    </div>
  );
}
