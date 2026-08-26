"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import type { NavLink } from "@/components/nav/mobile-nav";

/**
 * Desktop navigation links.
 *
 * A client component only because the active link depends on the current URL,
 * which a server component cannot see. The links themselves are passed down from
 * the server, so the role logic that decides WHICH links exist stays on the
 * server where it belongs.
 */
export function NavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname();

  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
      {links.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative rounded-md px-3 py-1.5 text-sm transition-colors",
              active
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {link.label}
            {/* An underline that sits in the bar's bottom edge rather than under
                the text. It reads as the tab being connected to the page below,
                which is what "you are here" actually means. */}
            {active && (
              <span
                aria-hidden="true"
                className="absolute inset-x-3 -bottom-[21px] h-px bg-primary"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
