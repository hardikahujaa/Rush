import { Database, Lock, QrCode, ServerCog } from "lucide-react";

import { BentoGrid, BentoGridItem } from "@/components/home/bento-grid";
import { Reveal } from "@/components/home/reveal";
import { StackMarquee } from "@/components/home/stack-marquee";

/**
 * "Engineered for Scale" (T39 step 3 - the faculty bait).
 *
 * ── THE FOUR CLAIMS ARE REAL, NOT MARKETING COPY ───────────────────────────
 * Each panel names something this codebase actually does, with a one-line
 * mechanism rather than an adjective, because this is the section a
 * professor reads most carefully - and this project's own standing rule
 * (first written down for the T35 waiting-room ticker, after an earlier
 * version of this project deleted a fabricated urgency counter on exactly
 * this principle) is that nothing on this page claims work that is not
 * happening:
 *
 *   - row-level locking      -> T20/T21: SELECT ... FOR UPDATE, seats locked
 *                                in ascending id order so no cycle can form;
 *                                proven by the race test (1 winner, 49
 *                                conflicts, 0 errors, every run).
 *   - the waiting room       -> T34: a Redis sorted set scored by an atomic
 *                                INCR sequence, not a timestamp - ties and
 *                                clock skew are both structurally impossible.
 *   - QR tickets              -> T30: HMAC-SHA256 over {ticketId.orderId.
 *                                seatId}, verified with timingSafeEqual.
 *                                Nothing about a ticket's validity is looked
 *                                up anywhere - it is in the signature.
 *   - Server Components       -> true of most of this app's own pages
 *                                (seat map, event detail, this very page).
 *
 * ── SERVER COMPONENT, NOT CLIENT ───────────────────────────────────────────
 * `BentoGrid`/`BentoGridItem` are plain layout - no hooks, no "use client" of
 * their own. Only the leaves that need motion (`Reveal`, and `StackMarquee`
 * for the strip underneath) carry a client boundary; the grid and its text
 * stay server-rendered, same reasoning as `event-rail.tsx`.
 */

const PANELS = [
  {
    title: "Postgres row-level locking",
    description:
      "Seats are locked with SELECT … FOR UPDATE, in ascending id order, inside one transaction. Proven under 50 concurrent buyers for the same seat: 1 winner, 49 clean conflicts, 0 errors — every run.",
    icon: <Lock className="size-5 text-gold" aria-hidden="true" />,
  },
  {
    title: "Redis sorted-set waiting room",
    description:
      "The queue's score is a Redis INCR sequence, not a timestamp — no ties, no clock skew. Admission is one atomic Lua script, so capacity can never be oversold by a concurrent poll.",
    icon: <ServerCog className="size-5 text-gold" aria-hidden="true" />,
  },
  {
    title: "Stateless cryptographic QR tickets",
    description:
      "Each code is an HMAC-SHA256 signature over the ticket, order and seat — verified with a constant-time compare. Nothing about a ticket's validity is looked up; it's in the signature.",
    icon: <QrCode className="size-5 text-gold" aria-hidden="true" />,
  },
  {
    title: "React Server Components",
    description:
      "The seat map, the event pages, and this page itself render on the server and ship HTML — no client fetch, no loading spinner for data the server already had.",
    icon: <Database className="size-5 text-gold" aria-hidden="true" />,
  },
] as const;

export function EngineeredForScale() {
  return (
    <section className="relative py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gold-champagne">
            Under the hood
          </p>
          <h2 className="mt-2 text-balance text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
            Engineered for scale
          </h2>
          <p className="mt-2 text-pretty text-sm text-muted-foreground">
            Four real mechanisms, not slide-deck adjectives — each one is a
            task in this project&rsquo;s own build log, with a test that
            proves it.
          </p>
        </div>

        <BentoGrid className="mt-10 md:auto-rows-[14rem]">
          {PANELS.map((panel, index) => (
            <Reveal key={panel.title} delay={index * 0.08}>
              <BentoGridItem
                title={panel.title}
                description={panel.description}
                icon={panel.icon}
                className="glass border-gold/15 bg-transparent dark:border-gold/15 dark:bg-transparent dark:shadow-none"
              />
            </Reveal>
          ))}
        </BentoGrid>

        <div className="mt-14">
          <p className="text-center text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Built with
          </p>
          <div className="mt-5">
            <StackMarquee />
          </div>
        </div>
      </div>
    </section>
  );
}
