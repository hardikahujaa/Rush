import Link from "next/link";

import { Logo } from "@/components/layout/navbar/logo";

/**
 * Site footer. Pitch black, minimal.
 *
 * Grouped by what someone is trying to do - get help, check a rule, do business
 * with us - rather than by which team owns the page. Support leads because a
 * person reading a ticketing footer is more often stuck than curious.
 *
 * TODO: these routes do not exist yet. They are deliberately real paths rather
 * than "#", so the information architecture is already correct and each page can
 * be filled in without touching this file.
 */
const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Support",
    links: [
      { label: "Help centre", href: "/help" },
      { label: "24/7 live chat", href: "/help/chat" },
      { label: "FAQs", href: "/help/faq" },
      { label: "Track an order", href: "/dashboard" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms & conditions", href: "/legal/terms" },
      { label: "Privacy policy", href: "/legal/privacy" },
      { label: "Refund & cancellation", href: "/legal/refunds" },
      { label: "Accessibility", href: "/legal/accessibility" },
    ],
  },
  {
    heading: "Business",
    links: [
      { label: "List your event", href: "/organizer" },
      { label: "Become a partner", href: "/business/partners" },
      { label: "Corporate enquiries", href: "/business/corporate" },
      { label: "Press kit", href: "/business/press" },
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
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="inline-block py-0.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:underline"
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

        <p className="mt-6 text-xs text-muted-foreground">
          © {year} RUSH. Built for drops that sell out in seconds.
        </p>
      </div>
    </footer>
  );
}
