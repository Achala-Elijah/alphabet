"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, Users, ArrowLeftRight, Menu, Bell, Search, ChevronDown, ArrowLeft, Ticket, UserPlus, Link as LinkIcon, ArrowUpCircle, SlidersHorizontal, CalendarDays, Wallet, HandCoins, type LucideIcon } from "lucide-react";

type NavLink = { label: string; href: string; Icon: LucideIcon; external?: boolean };

const adminLinks: NavLink[] = [
  { label: "Dashboard", href: "/sub-admin", Icon: LayoutDashboard },
  { label: "Users", href: "/sub-admin/users", Icon: Users },
  { label: "Match management", href: "/sub-admin/matches", Icon: CalendarDays },
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
  { label: "Open bets", href: "/sub-admin/open-bets", Icon: Ticket },
  { label: "My sales", href: "/sub-admin/transactions", Icon: ArrowLeftRight },
  { label: "Wallet", href: "/sub-admin/wallet", Icon: Wallet },
  { label: "Book & share", href: "/sub-admin/referral", Icon: LinkIcon }
];

export default function AdminShell({ children, title, description }: { children: React.ReactNode; title: string; description?: string }) {
  const pathname = usePathname();
  const [role, setRole] = useState<"admin" | "sub_admin">("sub_admin");

  useEffect(() => {
    fetch("/api/staff/profile", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ role: "admin" | "sub_admin" }> : null)
      .then((profile) => { if (profile?.role) setRole(profile.role); })
      .catch(() => undefined);
  }, []);

  const isAdmin = role === "admin";
  const workspaceLabel = isAdmin ? "ADMIN" : "SUB-ADMIN";
  const roleLabel = isAdmin ? "Admin" : "Sub Admin";
  const roleDescription = isAdmin ? "Platform administrator" : "Operations workspace";
  const links = isAdmin ? adminLinks : subAdminLinks;
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <Link href="/" className="admin-logo">Alpha<span>Bet</span><small>{workspaceLabel}</small></Link>
        <div className="admin-profile"><div className="profile-avatar">{isAdmin ? "AD" : "SA"}</div><div><strong>{roleLabel}</strong><span>{roleDescription}</span></div><ChevronDown size={16} /></div>
        <p className="nav-caption">WORKSPACE</p>
        <nav className="admin-nav">
          {links.map(({ label, href, Icon, external }) => <Link key={href} href={href} className={pathname === href ? "selected" : ""} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}><Icon size={19} /><span>{label}</span></Link>)}
        </nav>
        <div className="sidebar-bottom"><Link href="/" title="Return to the sportsbook without signing out"><ArrowLeft size={18} />Back to website</Link><Link href="/sub-admin/login" className="admin-logout">Sign out</Link></div>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <button className="mobile-menu" aria-label="Menu"><Menu size={22} /></button>
          <div className="breadcrumb">Dashboard <span>/</span> <strong>{title}</strong></div>
          <div className="topbar-actions"><button className="admin-search"><Search size={17} /><span>Search...</span><kbd>⌘ K</kbd></button><button className="notification"><Bell size={19} /><i /></button><div className="top-avatar">{isAdmin ? "AD" : "SA"}</div></div>
        </header>
        <div className="admin-content">
          <div className="page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div><span className="demo-label">UI DEMO</span></div>
          {children}
        </div>
      </main>
    </div>
  );
}
