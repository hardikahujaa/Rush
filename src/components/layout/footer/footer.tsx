import Link from "next/link";

import { Logo } from "@/components/layout/navbar/logo";

/**
 * Site footer. Pitch black, minimal.
 *
 * Grouped by what someone is trying to do - get help, check a rule, do business
 * with us - rather than by which team owns the page. Support leads because a
 * person reading a ticketing footer is more often stuck than curious.
 *
 * ── A LINK WITHOUT A PAGE IS NOT A LINK (T17) ─────────────────────────────
 * These used to be real `href`s to routes that do not exist - ten of them -
 * on the theory that the information architecture should be correct in advance.
 * A dead-link crawl of the homepage found them, and in a live demo every one is
 * a 404 a step away from the thing being demonstrated.
 *
 * So `href` is now optional. An entry with one is an anchor; an entry without
 * renders as plain text, keeping the column, the heading, the label and the
 * rhythm exactly as designed. The information architecture is still visible and
 * still correct - it just no longer promises navigation it cannot deliver. Give
 * one of these a page and adding its `href` back is a one-line change.
 */
type FooterLink = { label: string; href?: string };

const COLUMNS: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "Support",
    links: [
      { label: "Help centre" },
      { label: "24/7 live chat" },
      { label: "FAQs" },
      { label: "Track an order", href: "/dashboard" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms & conditions" },
      { label: "Privacy policy" },
      { label: "Refund & cancellation" },
      { label: "Accessibility" },
    ],
  },
  {
    heading: "Business",
    links: [
      { label: "List your event", href: "/organizer" },
      { label: "Browse all events", href: "/events" },
      { label: "Corporate enquiries" },
      { label: "Press kit" },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative border-t border-white/8 bg-black">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[1fr_2fr]">
          <div>
            <Logo />
            <p className="mt-5 max-w-xs text-pretty text-sm leading-relaxed text-muted-foreground">
              High-demand ticketing that does not oversell. Seats are held the
              moment you pick them and released the moment you do not.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <nav key={col.heading} aria-labelledby={`f-${col.heading}`}>
                <h2
                  id={`f-${col.heading}`}
                  className="text-[11px] font-medium uppercase tracking-[0.16em] text-foreground"
                >
                  {col.heading}
                </h2>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {l.href ? (
                        <Link
                          href={l.href}
                          className="inline-block py-0.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:underline"
                        >
                          {l.label}
                        </Link>
                      ) : (
                        /* Dimmer than a real link and NOT focusable, so keyboard
                           and screen-reader users are not walked through four
                           items that go nowhere. `title` says why on hover for
                           anyone who tries to click it. */
                        <span
                          title="Coming soon"
                          className="inline-block cursor-default py-0.5 text-sm text-muted-foreground/45"
                        >
                          {l.label}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="rule-fade mt-14 h-px" />

        <p className="mt-6 text-xs text-muted-foreground">
          © {year} RUSH. Built for drops that sell out in seconds.
        </p>
      </div>
    </footer>
  );
}
