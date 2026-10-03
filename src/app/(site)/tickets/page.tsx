import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, MapPin, ShieldCheck, TicketX } from "lucide-react";

import { TicketCard } from "@/components/tickets/ticket-card";
import { getTicketsForUser } from "@/db/queries/tickets";
import { requireUser } from "@/lib/auth";
import { encodeTicketPayload } from "@/lib/ticket-crypto";

export const metadata: Metadata = {
  title: "Your tickets",
  /* Per-user entry credentials. Nothing here belongs in a search index. */
  robots: { index: false, follow: false },
};

function formatWhen(date: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date);
}

/**
 * /tickets - the signed QR for every seat this user has paid for.
 *
 * ── AUTHORISATION IS TWO LAYERS ────────────────────────────────────────────
 *   1. `src/proxy.ts` already matches `/tickets` (it has since T15), so a
 *      signed-out visitor is redirected before this file runs.
 *   2. `requireUser()` here, then `getTicketsForUser`, which carries BOTH
 *      `orders.user_id = $me` and `orders.status = 'paid'` in its WHERE clause.
 *      This is the layer that actually enforces it - it runs inside the thing
 *      being protected, so no matcher typo can route around it.
 *
 * ── THE SIGNING HAPPENS HERE, ON THE SERVER ────────────────────────────────
 * `encodeTicketPayload` reads `QR_SIGNING_SECRET`, so it can only ever run in
 * this component - `src/lib/ticket-crypto.ts` and `src/lib/qr.ts` are both
 * marked `server-only`, which makes importing them from a client component a
 * build error rather than a silent leak.
 *
 * What reaches the browser is the finished 44-character string per ticket. The
 * full 256-bit `tickets.qr_signature` is never serialised; the payload carries
 * a 128-bit truncation of it.
 */
export default async function TicketsPage() {
  const user = await requireUser();
  const groups = await getTicketsForUser(user.id);

  const total = groups.reduce((n, g) => n + g.tickets.length, 0);

  return (
    <main className="mx-auto max-w-5xl px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
      <header>
        <h1 className="text-metal text-balance text-3xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-4xl">
          Your tickets
        </h1>
        {total > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            <span className="tabular-nums text-foreground">{total}</span>{" "}
            {total === 1 ? "ticket" : "tickets"} across{" "}
            <span className="tabular-nums">{groups.length}</span>{" "}
            {groups.length === 1 ? "event" : "events"}
          </p>
        )}
      </header>

      {total === 0 ? (
        /* The designed empty state. An empty black page reads as a bug, and a
           buyer who has just paid and sees nothing will assume it is one. */
        <div className="glass mt-10 rounded-2xl border-gold/20 px-6 py-14 text-center">
          <TicketX
            className="mx-auto size-7 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="mt-4 text-sm text-foreground">No tickets yet</p>
          <p className="mx-auto mt-2 max-w-sm text-pretty text-xs leading-relaxed text-muted-foreground">
            Tickets appear here the moment a payment is confirmed. If you have
            just paid and this looks empty, give the confirmation a few seconds
            and refresh.
          </p>
          <Link
            href="/"
            className="btn-gold-outline mt-6 inline-flex h-11 items-center rounded-xl px-5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Browse events
          </Link>
        </div>
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.eventId} className="mt-10">
              <div className="flex flex-col gap-1.5">
                <h2 className="text-lg font-semibold tracking-tight text-gold-champagne">
                  {group.eventTitle}
                </h2>
                <div className="flex flex-col gap-1.5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:gap-6">
                  <p className="flex items-center gap-2">
                    <CalendarDays
                      className="size-4 shrink-0 text-gold"
                      aria-hidden="true"
                    />
                    {formatWhen(group.startsAt)}
                  </p>
                  <p className="flex items-center gap-2">
                    <MapPin
                      className="size-4 shrink-0 text-gold"
                      aria-hidden="true"
                    />
                    {group.venueName}, {group.venueCity}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                {group.tickets.map((ticket, index) => (
                  <TicketCard
                    key={ticket.ticketId}
                    index={index}
                    ticket={{
                      ticketId: ticket.ticketId,
                      sectionName: ticket.sectionName,
                      rowLabel: ticket.rowLabel,
                      seatNo: ticket.seatNo,
                      priceCents: ticket.priceCents,
                      checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
                      /* Signed here. The secret stays on this side. */
                      payload: encodeTicketPayload({
                        ticketId: ticket.ticketId,
                        orderId: ticket.orderId,
                        seatId: ticket.seatId,
                      }),
                    }}
                  />
                ))}
              </div>
            </section>
          ))}

          {/*
            THE DISCLAIMER, SAYING SOMETHING TRUE.

            "Do not screenshot" on its own is advice nobody follows, because it
            does not explain anything - and screenshotting a ticket is in fact
            a sensible thing to do when the venue has no signal.

            The real risk is specific: a QR is a BEARER credential and check-in
            is single-use (T31 sets `checked_in_at` exactly once). So the danger
            is not the screenshot existing, it is the screenshot being SHARED -
            whoever is scanned first takes the seat, and the rightful holder is
            then turned away with ALREADY USED. That is worth saying plainly.
          */}
          <div className="glass mt-12 flex items-start gap-3 rounded-xl px-4 py-3.5">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-gold"
              aria-hidden="true"
            />
            <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
              Each code is signed and can be scanned <strong>once</strong>. Keep
              a screenshot for yourself if signal at the venue is poor &mdash;
              but never share the image. Whoever is scanned first is let in, and
              the ticket will then be refused for everyone else, including you.
            </p>
          </div>
        </>
      )}
    </main>
  );
}
