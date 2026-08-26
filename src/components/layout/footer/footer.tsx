import Link from "next/link";

import { NewsletterForm } from "@/components/layout/footer/newsletter-form";
import { Logo } from "@/components/layout/navbar/logo";

/**
 * Site footer.
 *
 * Grouped by what someone is trying to do — get help, check a rule, do business
 * with us — rather than by which team owns the page. Support comes first because
 * a person reading a ticketing footer is more often stuck than curious.
 *
 * TODO: these routes do not exist yet. They are structural, and each will 404
 * until built; they are deliberately not "#" so the information architecture is
 * already correct and the pages can be filled in without touching this file.
 */

const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Support",
    links: [
      { label: "Help centre", href: "/help" },
      { label: "24/7 live chat", href: "/help/chat" },
      { label: "FAQs", href: "/help/faq" },
      { label: "Track an order", href: "/dashboard" },
      { label: "Ticket transfer", href: "/help/transfer" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms & conditions", href: "/legal/terms" },
      { label: "Privacy policy", href: "/legal/privacy" },
      { label: "Refund & cancellation", href: "/legal/refunds" },
      { label: "Cookie preferences", href: "/legal/cookies" },
      { label: "Accessibility", href: "/legal/accessibility" },
    ],
  },
  {
    heading: "Business",
    links: [
      { label: "List your event", href: "/organizer" },
      { label: "Become a partner", href: "/business/partners" },
      { label: "Corporate enquiries", href: "/business/corporate" },
      { label: "Venue solutions", href: "/business/venues" },
      { label: "Press kit", href: "/business/press" },
    ],
  },
];

/** Inline SVG rather than an icon package — brand marks should not drift. */
function XLogo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function InstagramLogo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative mt-16 border-t border-border/60">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_2fr]">
          {/* Brand + newsletter */}
          <div>
            <Logo />
            <p className="mt-5 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
              High-demand ticketing that does not oversell. Seats are held the
              moment you pick them and released the moment you do not.
            </p>

            <div className="mt-8">
              <p className="text-sm font-medium">Early VIP access</p>
              <p className="mb-3 mt-1 text-xs text-muted-foreground">
                Drop alerts before they are public. No noise.
              </p>
              <NewsletterForm />
            </div>

            <div className="mt-8 flex items-center gap-2">
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="RUSH on X"
                className="flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <XLogo className="size-4" />
              </a>
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="RUSH on Instagram"
                className="flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <InstagramLogo className="size-4" />
              </a>
            </div>
          </div>

          {/* Link columns */}
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
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:underline"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="rule-fade mt-14 h-px" />

        <div className="mt-6 flex flex-col items-start justify-between gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>© {year} RUSH. Built for drops that sell out in seconds.</p>
          <p className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-live"
            />
            All systems operational
          </p>
        </div>
      </div>
    </footer>
  );
}
