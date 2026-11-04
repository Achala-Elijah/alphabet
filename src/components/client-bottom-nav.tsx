"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { House, Ticket, Gamepad2, CircleDollarSign, UserRound } from "lucide-react";

const items = [
  { label: "Home", href: "/", Icon: House, route: "/", nav: "" },
  { label: "Load Code", href: "/load-code", Icon: Ticket, route: "/load-code", nav: "" },
  { label: "Games", href: "/?nav=games", Icon: Gamepad2, route: "/", nav: "games" },
  { label: "Open Bets", href: "/account?nav=bets", Icon: CircleDollarSign, route: "/account", nav: "bets" },
  { label: "Me", href: "/account", Icon: UserRound, route: "/account", nav: "" }
];

export default function ClientBottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedNav = searchParams.get("nav") || "";

  return (
    <nav className="client-bottom-nav">
      {items.map(({ label, href, Icon, route, nav }) => (
        <Link key={label} href={href} className={pathname === route && selectedNav === nav ? "active" : ""}>
          <Icon size={25} strokeWidth={2} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
