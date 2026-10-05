import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { holdIsLive } from "@/db/queries/availability";
import {
  events,
  holds,
  orderItems,
  orders,
  seats,
  sections,
  tickets,
  users,
  venues,
} from "@/db/schema";

/**
 * Stripe's own floor, not a number we picked: `Checkout.Session.expires_at`
 * must be 30 minutes to 24 hours from creation (confirmed against the
 * installed SDK's type comment, not memory - see PLAN.md's T27 note). Our
 * hold lives ten. Without reconciling the two, a hold can lazily expire under
 * a buyer who is still sitting on an open, unexpired Stripe page - another
 * user can then legitimately take and pay for the same seat, and when the
 * first buyer also finishes paying, one of the two webhooks loses to
 * `one_sold_seat` with real money already moved. `createPendingOrder` closes
 * this by extending the caller's holds to the SAME instant the Stripe session
 * will expire, inside the same transaction that verifies them.
 */
export const CHECKOUT_WINDOW_MINUTES = 30;
/** Covers the gap between "Postgres computed this instant" and "Stripe's
 *  clock agrees the session has expired" - never subtracted, only added. */
export const CHECKOUT_BUFFER_SECONDS = 60;

/* ── failures ───────────────────────────────────────────────────────────── */

export type OrderFailure =
  | { code: "SEATS_NOT_FOUND"; seatIds: string[] }
  | { code: "MIXED_EVENTS" }
  | { code: "HOLDS_INVALID"; seatIds: string[] };

/** Same role as HoldError in holds.ts: abort the transaction and carry which
 *  seats were the problem, so the UI can say something more useful than
 *  "something went wrong". */
export class OrderError extends Error {
  constructor(readonly failure: OrderFailure) {
    super(failure.code);
    this.name = "OrderError";
  }
}

/* ── result ─────────────────────────────────────────────────────────────── */

export type CheckoutLineItem = {
  seatId: string;
  sectionName: string;
  rowLabel: string;
  seatNo: number;
  priceCents: number;
};

export type PendingOrder = {
  orderId: string;
  eventId: string;
  eventTitle: string;
  totalCents: number;
  /** The single instant both the extended hold AND the Stripe session must
   *  expire at - the route builds the Checkout Session with this exact value. */
  expiresAt: Date;
  lineItems: CheckoutLineItem[];
};

/**
 * Turn a live hold into a pending order, ready to hand to Stripe.
 *
 * ── WHY THIS NEVER TOUCHES order_items ──────────────────────────────────────
 * `order_items` carries `one_sold_seat`, an UNCONDITIONAL unique index on
 * seat_id (schema.ts) - unlike `holds`, which is only unique while
 * `released_at IS NULL`. There is no partial-index escape hatch: insert a row
 * here before payment is confirmed, and if the Stripe session is ever
 * abandoned, expires, or fails, that seat can never be inserted into
 * order_items again, by anyone, ever. `seatIsSold()` in availability.ts has no
 * idea an order is still 'pending' - it only asks whether a row exists. One
 * abandoned checkout would permanently remove a seat from inventory.
 *
 * So this function creates only the `orders` row - enough to give Stripe a
 * durable id for `metadata.orderId` and to freeze the server-computed total.
 * `order_items` is written later, by the webhook, at the one instant that
 * actually earns the word "sold": a confirmed `checkout.session.completed`.
 */
export async function createPendingOrder({
  userId,
  seatIds,
}: {
  userId: string;
  /** Already de-duplicated and sorted by `checkoutSchema`. */
  seatIds: string[];
}): Promise<PendingOrder> {
  return db.transaction(async (tx) => {
    /* ── 1. LOCK THE SEATS, SAME ORDER AS createHold ──────────────────────
     * Identical reasoning to holds.ts: `ORDER BY id` is what makes the lock
     * order deterministic across every transaction that might touch these
     * rows - this one, a concurrent createHold, or a concurrent release -
     * so a cycle between them cannot form. */
    const locked = await tx
      .select({ id: seats.id, eventId: seats.eventId })
      .from(seats)
      .where(inArray(seats.id, seatIds))
      .orderBy(seats.id)
      .for("update");

    if (locked.length !== seatIds.length) {
      const found = new Set(locked.map((s) => s.id));
      throw new OrderError({
        code: "SEATS_NOT_FOUND",
        seatIds: seatIds.filter((id) => !found.has(id)),
      });
    }

    const eventId = locked[0].eventId;
    if (locked.some((s) => s.eventId !== eventId)) {
      // One order spanning two events has no single event_id to record -
      // the orders table cannot represent it, same reasoning as createHold.
      throw new OrderError({ code: "MIXED_EVENTS" });
    }

    /* ── 2. EVERY SEAT MUST CARRY A LIVE HOLD OWNED BY THIS USER ──────────
     *
     * The join's `isNull(holds.releasedAt)` means at most one hold row can
     * match per seat - `one_live_hold_per_seat` guarantees that - so this is
     * never ambiguous. `holdIsLive` is the same predicate every other
     * availability decision in the app uses; a seat whose hold already
     * expired is correctly treated as not-held-by-anyone, same as everywhere
     * else, rather than specially trusted because it happens to be this
     * user's stale row.
     *
     * Price is read from `sections` through this same join - never from the
     * request. The standing CLAUDE.md rule ("never trust the client for
     * price") applies here exactly as it does in createHold.
     */
    const holdRows = await tx
      .select({
        seatId: seats.id,
        sectionName: sections.name,
        rowLabel: seats.rowLabel,
        seatNo: seats.seatNo,
        priceCents: sections.priceCents,
        holdUserId: holds.userId,
        live: sql<boolean>`${holdIsLive(sql`${holds}`)}`,
      })
      .from(seats)
      .innerJoin(sections, eq(sections.id, seats.sectionId))
      .leftJoin(holds, and(eq(holds.seatId, seats.id), isNull(holds.releasedAt)))
      .where(inArray(seats.id, seatIds))
      .orderBy(sections.priceCents, seats.rowLabel, seats.seatNo);

    const invalid: string[] = [];
    const lineItems: CheckoutLineItem[] = [];

    for (const row of holdRows) {
      /* `row.live` is SQL NULL (falsy in JS) whenever no hold row matched the
         join at all, and `row.holdUserId` is NULL in that same case - so both
         halves of this condition fail together for "nobody holds this seat",
         not just for "someone else does" or "it expired". */
      if (row.holdUserId === userId && row.live) {
        lineItems.push({
          seatId: row.seatId,
          sectionName: row.sectionName,
          rowLabel: row.rowLabel,
          seatNo: row.seatNo,
          priceCents: row.priceCents,
        });
      } else {
        invalid.push(row.seatId);
      }
    }

    if (invalid.length > 0) {
      /* Named, not vague - the UI can send the user back to the seat map with
         exactly the seats that are no longer theirs, instead of discarding a
         selection that may still be mostly valid. */
      throw new OrderError({ code: "HOLDS_INVALID", seatIds: invalid.sort() });
    }

    /* ── 3. ONE SHARED EXPIRY, FOR THE HOLD AND FOR STRIPE ────────────────
     *
     * From the DATABASE clock, same reasoning as createHold: comparing
     * against Postgres's now() rather than the app server's means every
     * later "is this still live?" check agrees, regardless of which Vercel
     * instance's clock might be off.
     */
    const clock = await tx.execute<{ now: string | Date }>(sql`select now() as now`);
    const expiresAt = new Date(
      new Date(clock[0].now).getTime() +
        CHECKOUT_WINDOW_MINUTES * 60_000 +
        CHECKOUT_BUFFER_SECONDS * 1000,
    );

    /* Extends rows the caller already owns - an UPDATE, never an INSERT, so
       `one_live_hold_per_seat` (which only guards a second INSERT) is not in
       play. Safe to do with the seat locks from step 1 still held: no
       concurrent transaction can be mid-decision about these holds. */
    await tx
      .update(holds)
      .set({ expiresAt })
      .where(
        and(
          inArray(holds.seatId, seatIds),
          eq(holds.userId, userId),
          isNull(holds.releasedAt),
        ),
      );

    const totalCents = lineItems.reduce((sum, item) => sum + item.priceCents, 0);

    const eventRows = await tx
      .select({ title: events.title })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    /* ── 4. THE PENDING ORDER ITSELF ───────────────────────────────────── */
    const [order] = await tx
      .insert(orders)
      .values({ userId, eventId, totalCents, status: "pending" })
      .returning({ id: orders.id });

    return {
      orderId: order.id,
      eventId,
      eventTitle: eventRows[0]?.title ?? "Rush event",
      totalCents,
      expiresAt,
      lineItems,
    };
  });
}

/**
 * Record the Stripe session id once Stripe has actually answered.
 *
 * Deliberately a plain UPDATE outside any transaction, called from the route
 * AFTER the network call to Stripe - see the route for why the Stripe call
 * itself must never happen while a DB transaction (and its row locks) is
 * open.
 */
export async function attachStripeSession(
  orderId: string,
  stripeSessionId: string,
): Promise<void> {
  await db.update(orders).set({ stripeSessionId }).where(eq(orders.id, orderId));
}

/**
 * Undo step 4 above when the Stripe call that was supposed to follow it
 * fails. Guarded by `status = 'pending' AND stripe_session_id IS NULL` so
 * this can never delete an order that somehow did get a session attached, or
 * stopped being pending, between the two steps - that would be deleting a
 * real, in-flight order instead of an orphan.
 */
export async function deleteOrphanedPendingOrder(orderId: string): Promise<void> {
  await db
    .delete(orders)
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.status, "pending"),
        isNull(orders.stripeSessionId),
      ),
    );
}

/* ── reading an order back (T29) ────────────────────────────────────────── */

export type OrderSeatLine = {
  seatId: string;
  sectionName: string;
  rowLabel: string;
  seatNo: number;
  priceCents: number;
  /** Null until the webhook has issued tickets - i.e. until payment landed. */
  ticketId: string | null;
};

export type OrderView = {
  orderId: string;
  status: "pending" | "paid" | "failed" | "refunded";
  totalCents: number;
  createdAt: Date;
  eventId: string;
  eventTitle: string;
  venueName: string;
  venueCity: string;
  startsAt: Date;
  seats: OrderSeatLine[];
};

/**
 * One order, for ONE user, with its seats and (once paid) its tickets.
 *
 * ── OWNERSHIP IS A WHERE CLAUSE, NOT A BRANCH ──────────────────────────────
 * `user_id = $me` sits inside the query rather than being checked by the
 * caller afterwards. Same reasoning as `releaseHolds` in queries/holds.ts: an
 * order belonging to somebody else simply does not match, so there is no
 * `if (order.userId !== user.id)` for a future edit to forget, and no window
 * between reading and deciding.
 *
 * That matters more here than it looks. An order id is a uuid in a URL that
 * gets pasted into chats and screenshots. Without this clause, anyone holding
 * the link could read another person's seat numbers, what they paid, and their
 * ticket ids - and ticket ids are half of what a QR encodes.
 *
 * Returns null for "no such order" AND for "not yours", deliberately
 * indistinguishable: the caller renders notFound() either way. A 403 would
 * confirm the order exists, which is itself a small leak.
 *
 * ── WHY SEATS COME FROM order_items, NOT FROM THE HOLDS ────────────────────
 * `order_items` is the permanent record written by the webhook at confirmed
 * payment (T28); the holds are released seconds later and tell you nothing
 * about what was bought. Reading the holds would make this page go blank the
 * moment the purchase actually succeeded.
 *
 * The LEFT JOIN onto tickets is what lets this page be honest while the
 * webhook is still in flight: a pending order has order lines but no tickets,
 * so `ticketId` is null and the UI shows "confirming" rather than inventing a
 * ticket that does not exist yet.
 */
export async function getOrderForUser(
  orderId: string,
  userId: string,
): Promise<OrderView | null> {
  const [order] = await db
    .select({
      orderId: orders.id,
      status: orders.status,
      totalCents: orders.totalCents,
      createdAt: orders.createdAt,
      eventId: events.id,
      eventTitle: events.title,
      venueName: venues.name,
      venueCity: venues.city,
      startsAt: events.startsAt,
    })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);

  if (!order) return null;

  const lines = await db
    .select({
      seatId: seats.id,
      sectionName: sections.name,
      rowLabel: seats.rowLabel,
      seatNo: seats.seatNo,
      priceCents: orderItems.priceCents,
      ticketId: tickets.id,
    })
    .from(orderItems)
    .innerJoin(seats, eq(seats.id, orderItems.seatId))
    .innerJoin(sections, eq(sections.id, seats.sectionId))
    .leftJoin(tickets, eq(tickets.seatId, orderItems.seatId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(sections.priceCents, seats.rowLabel, seats.seatNo);

  return { ...order, seats: lines };
}

/**
 * Just the status, for the success page's poll.
 *
 * Kept separate from `getOrderForUser` on purpose: the poll fires every two
 * seconds and only ever asks one question, so it has no business joining four
 * tables to answer it. Ownership is enforced the same way.
 */
export async function getOrderStatusForUser(
  orderId: string,
  userId: string,
): Promise<{ status: OrderView["status"]; ticketCount: number } | null> {
  const [order] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
    .limit(1);

  if (!order) return null;

  const issued = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.orderId, orderId));

  return { status: order.status, ticketCount: issued.length };
}

/* ── the confirmation email's data (T32) ────────────────────────────────── */

export type OrderReceipt = OrderView & {
  buyerEmail: string;
  buyerName: string | null;
};

/**
 * One order with everything the confirmation email needs, including who to
 * send it to.
 *
 * ── WHY THIS IS NOT SCOPED TO A USER, UNLIKE getOrderForUser ───────────────
 * `getOrderForUser` carries `user_id = $me` because it answers a request from a
 * browser. This one is called by the Stripe webhook, which has no user and no
 * session - it has a signature-verified event and an order id. Scoping it to a
 * user would mean the webhook first asking "whose order is this?" and then
 * passing the answer back in as a filter, which is a check that cannot fail and
 * therefore is not a check.
 *
 * It is NOT exported to any route handler, and the module is `server-only`, so
 * the only way to reach it is from server code that already knows why it wants
 * an order.
 *
 * ── WHY THE RECIPIENT COMES FROM OUR DATABASE, NOT FROM STRIPE ─────────────
 * `session.customer_email` is sitting right there in the webhook payload, and
 * using it would be one less join. But it is a copy we handed Stripe at
 * checkout time, and `users.email` is the source of truth - kept in step with
 * `auth.users` by the trigger in migration 0003. Reading the copy would mean a
 * buyer who corrected their address still gets the ticket at the old one.
 */
export async function getOrderForReceipt(
  orderId: string,
): Promise<OrderReceipt | null> {
  const [order] = await db
    .select({
      orderId: orders.id,
      status: orders.status,
      totalCents: orders.totalCents,
      createdAt: orders.createdAt,
      eventId: events.id,
      eventTitle: events.title,
      venueName: venues.name,
      venueCity: venues.city,
      startsAt: events.startsAt,
      buyerEmail: users.email,
      buyerName: users.name,
    })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(users, eq(users.id, orders.userId))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) return null;

  /* The same shape and ordering getOrderForUser produces, so the email and the
     success page describe a purchase identically. `ticketId` is what the QR
     payload is built from, so a line with a null ticket cannot be rendered -
     which only happens if this is called before the webhook issued tickets. */
  const lines = await db
    .select({
      seatId: seats.id,
      sectionName: sections.name,
      rowLabel: seats.rowLabel,
      seatNo: seats.seatNo,
      priceCents: orderItems.priceCents,
      ticketId: tickets.id,
    })
    .from(orderItems)
    .innerJoin(seats, eq(seats.id, orderItems.seatId))
    .innerJoin(sections, eq(sections.id, seats.sectionId))
    .leftJoin(tickets, eq(tickets.seatId, orderItems.seatId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(sections.priceCents, seats.rowLabel, seats.seatNo);

  return { ...order, seats: lines };
}
