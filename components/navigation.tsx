"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, LayoutGrid, Settings2 } from "lucide-react";
import clsx from "clsx";

const links = [
  { href: "/", label: "Campaigns", icon: LayoutGrid },
  { href: "/campaigns/new", label: "Creative brief", icon: Clapperboard },
  { href: "/settings", label: "Workspace settings", icon: Settings2 },
];

export function Navigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="navigation">
      {links.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/"
            ? pathname === "/" ||
              (pathname.startsWith("/campaigns/") && pathname !== "/campaigns/new")
            : pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={clsx("nav-link", active && "active")}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
            {active && <span className="nav-dot" />}
          </Link>
        );
      })}
    </nav>
  );
}
