import Link from "next/link";

import { DropTicker } from "@/components/nav/drop-ticker";
import { MobileNav, type NavLink } from "@/components/nav/mobile-nav";
import { NavLinks } from "@/components/nav/nav-links";
import { NavItem, NavShell } from "@/components/nav/nav-shell";
import { UserMenu } from "@/components/nav/user-menu";
import { Wordmark } from "@/components/nav/wordmark";
import { Button } from "@/components/ui/button";
import { getNextDrop } from "@/db/queries/events";
import { getCurrentUser } from "@/lib/auth";

/**
 * The site navigation bar.
 *
 * A SERVER component, which is what lets it read the signed-in user and the next
 * drop straight from the database with no loading state and no request from the
 * browser. The bar arrives already knowing who you are.
 *
 * Only the parts that genuinely need the browser are client components: the
 * scroll-reactive shell, the countdown, the dropdown, the sheet, and the active
 * link. The role logic that decides which links exist stays here on the server -
 * a client component receiving the user's role could be tampered with, and while
 * every route is enforced server-side anyway, there is no reason to ship the
 * decision to the browser at all.
 */
export async function Navbar() {
  /**
   * Both fetched concurrently. Run in sequence these would be two round trips
   * stacked one after the other on every single page load; awaited together they
   * cost one.
   */
  const [user, nextDrop] = await Promise.all([getCurrentUser(), getNextDrop()]);

  const links: NavLink[] = [
    { href: "/events", label: "Events" },
    ...(user ? [{ href: "/tickets", label: "Tickets" }] : []),
    ...(user?.role === "organizer"
      ? [{ href: "/organizer", label: "Organizer" }]
      : []),
    ...(user?.role === "staff" || user?.role === "organizer"
      ? [{ href: "/scan", label: "Scan" }]
      : []),
  ];

  return (
    <NavShell>
      <NavItem index={0}>
        <Wordmark />
      </NavItem>

      <NavItem index={1}>
        <NavLinks links={links} />
      </NavItem>

      {/* Pushes everything after it to the right edge. */}
      <div className="flex-1" />

      {nextDrop && (
        <NavItem index={2}>
          <DropTicker
            eventId={nextDrop.id}
            title={nextDrop.title}
            venue={`${nextDrop.venue}, ${nextDrop.city}`}
            dropAtIso={nextDrop.dropAt.toISOString()}
            isLive={nextDrop.isLive}
          />
        </NavItem>
      )}

      <NavItem index={3} className="flex items-center gap-2">
        {user ? (
          <UserMenu email={user.email} name={user.name} role={user.role} />
        ) : (
          <>
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link href="/signup">Get started</Link>
            </Button>
          </>
        )}
        <MobileNav
          links={links}
          user={user ? { email: user.email, name: user.name, role: user.role } : null}
        />
      </NavItem>
    </NavShell>
  );
}
