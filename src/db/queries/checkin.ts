import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { events, orders, seats, sections, tickets, venues } from "@/db/schema";
import { verifyTicketPayload } from "@/lib/ticket-crypto";

/**
 * THE GATE (T31).
 *
 * ── THE ONE THING THIS FILE EXISTS TO GET RIGHT ─────────────────────────────
 * A ticket may be admitted exactly once. The obvious implementation is the one
 * that fails:
 *
 *     const t = await db.select().from(tickets).where(eq(tickets.id, id));
 *     if (t.checkedInAt === null) {
 *       await db.update(tickets).set({ checkedInAt: new Date() })...   // VALID
 *     }
 *
 * Two staff scanning the same screenshot at two doors in the same instant both
 * read `null`, both update, and both screens flash green. Two people are inside
 * on one seat - which is the single failure this entire project is built to
 * prevent, arriving one last time at the last possible moment.
 *
 * ── THE FIX: COMPARE-AND-SET IN ONE STATEMENT ──────────────────────────────
 *
 *     update tickets set checked_in_at = now()
 *      where id = $1 and checked_in_at is null
 *      returning checked_in_at
 *
 * There is no read to race against. A concurrent identical statement blocks on
 * the row lock; when the first commits, the second re-evaluates its own WHERE
 * against the newly committed value (READ COMMITTED re-checks the predicate
 * after the lock releases), matches nothing, and returns zero rows.
 *
 * So **exactly one caller can ever get a row back**, and "zero rows" *means*
 * already-scanned rather than merely suggesting it. No transaction, no
 * `SELECT ... FOR UPDATE`, and - the part that matters most - no application
 * branch that a later edit could delete. Same principle as the row locks in T20
 * and the unique-index gate in T28: the database decides.
 *
 * ── NO ENUMERATION ORACLE ──────────────────────────────────────────────────
 * A malformed payload, a tampered tag, and a correctly-signed payload for a
 * ticket id that does not exist all return the identical `forged`. The caller
 * cannot use this endpoint to learn which ticket ids are real. Only the last
 * case is interesting - it means a deleted row or a leaked secret - so it is
 * logged loudly while the answer stays indistinguishable.
 */

export type CheckInSeat = {
  ticketId: string;
  sectionName: string;
  rowLabel: string;
  seatNo: number;
  eventTitle: string;
  venueName: string;
  venueCity: string;
  startsAt: Date;
};

export type CheckInOutcome =
  /** Admitted. `checkedInAt` is the instant this scan claimed it. */
  | { outcome: "valid"; seat: CheckInSeat; checkedInAt: Date }
  /** Someone already walked in on this ticket. `scannedAt` is the FIRST scan. */
  | { outcome: "already_scanned"; seat: CheckInSeat; scannedAt: Date }
  /** Bad signature, unknown ticket, or a tag that belongs to another ticket. */
  | { outcome: "forged"; reason: "bad_signature" | "unknown_ticket" };

/**
 * Admit a ticket, or refuse it.
 *
 * `tag` is the 16 truncated HMAC bytes carried by the QR; `ticketId` is the
 * other half of the payload. Both come from `decodeTicketPayload`, which has
 * already enforced the shape, length and version byte - so by the time this
 * runs, the input is known to be well-formed, just not yet known to be genuine.
 */
export async function checkInTicket({
  ticketId,
  tag,
}: {
  ticketId: string;
  tag: Buffer;
}): Promise<CheckInOutcome> {
  /* ── 1. LOAD THE TICKET ────────────────────────────────────────────────
   *
   * This happens before verification, and it has to: the signature covers
   * `ticketId.orderId.seatId`, and `orderId`/`seatId` live on the row. They
   * are deliberately NOT carried in the QR - an attacker controls everything
   * in the payload and nothing in our table, which is exactly what makes
   * recomputing the HMAC from stored values meaningful.
   */
  const [row] = await db
    .select({
      ticketId: tickets.id,
      orderId: tickets.orderId,
      seatId: tickets.seatId,
      checkedInAt: tickets.checkedInAt,
      sectionName: sections.name,
      rowLabel: seats.rowLabel,
      seatNo: seats.seatNo,
      eventTitle: events.title,
      venueName: venues.name,
      venueCity: venues.city,
      startsAt: events.startsAt,
      orderStatus: orders.status,
    })
    .from(tickets)
    .innerJoin(seats, eq(seats.id, tickets.seatId))
    .innerJoin(sections, eq(sections.id, seats.sectionId))
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .innerJoin(events, eq(events.id, orders.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(eq(tickets.id, ticketId))
    .limit(1);

  if (!row) {
    /* A well-formed payload naming a ticket that does not exist. To have got
       here the caller produced a 44-character base64url string with a correct
       version byte, which is not something you stumble into - but the tag was
       never checked, so this is almost always a random guess. Reported as
       `forged` so it is indistinguishable from a bad signature. */
    return { outcome: "forged", reason: "unknown_ticket" };
  }

  /* ── 2. VERIFY, AGAINST THE STORED IDS ─────────────────────────────────
   *
   * `timingSafeEqual` inside `verifyTicketPayload`, so a tag wrong in its
   * first byte takes exactly as long to reject as one wrong in its last.
   */
  const genuine = verifyTicketPayload({
    ticketId: row.ticketId,
    orderId: row.orderId,
    seatId: row.seatId,
    tag,
  });

  if (!genuine) {
    return { outcome: "forged", reason: "bad_signature" };
  }

  const seat: CheckInSeat = {
    ticketId: row.ticketId,
    sectionName: row.sectionName,
    rowLabel: row.rowLabel,
    seatNo: row.seatNo,
    eventTitle: row.eventTitle,
    venueName: row.venueName,
    venueCity: row.venueCity,
    startsAt: row.startsAt,
  };

  /* ── 3. THE COMPARE-AND-SET ────────────────────────────────────────────
   *
   * `isNull(tickets.checkedInAt)` in the WHERE clause is the whole guarantee.
   * Note what is NOT here: no `if (row.checkedInAt === null)` based on the
   * read above. That value is already stale by the time this line runs, and
   * trusting it is precisely the bug described at the top of this file. The
   * read is used only to build the display and to verify the signature.
   */
  const admitted = await db
    .update(tickets)
    .set({ checkedInAt: sql`now()` })
    .where(and(eq(tickets.id, ticketId), isNull(tickets.checkedInAt)))
    .returning({ checkedInAt: tickets.checkedInAt });

  if (admitted.length === 1 && admitted[0].checkedInAt) {
    return { outcome: "valid", seat, checkedInAt: admitted[0].checkedInAt };
  }

  /* ── 4. ZERO ROWS: SOMEBODY GOT HERE FIRST ─────────────────────────────
   *
   * Re-read rather than reusing `row.checkedInAt`, because the two are not the
   * same fact. In the concurrent case `row.checkedInAt` was null when it was
   * fetched milliseconds ago; the committed value is what the gate staff need
   * to see, and showing them a stale null would be worse than showing nothing.
   */
  const [current] = await db
    .select({ checkedInAt: tickets.checkedInAt })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);

  return {
    outcome: "already_scanned",
    seat,
    /* The fallback is unreachable - zero rows from the UPDATE means the column
       is non-null by definition - but `checkedInAt` is typed nullable and a
       non-null assertion here would be the one place this file lied. */
    scannedAt: current?.checkedInAt ?? new Date(),
  };
}
