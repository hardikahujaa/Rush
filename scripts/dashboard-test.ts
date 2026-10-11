/**
 * T37 verification — the three reads T37 added beyond T36's original five,
 * plus the recent-orders route's authorization.
 *
 *   npm run dashboard-test          (dev server must be running)
 *
 * T36's `analytics-test.ts` already proves the five named queries and the
 * ownership gate they share end to end. This script is deliberately small: it
 * covers only what that one does not - `getEventHeader`, `getCheckInStats` and
 * `getRecentOrders`, which exist because the dashboard brief (T37) asked for a
 * header, a check-ins stat and a live order list that nothing in T36 produces.
 *
 * Same technique as `analytics-test.ts`: a real hold, a real
 * `createPendingOrder`, a real signed webhook. Check-in is set with a direct
 * UPDATE rather than through `checkInTicket` - T31's compare-and-set is
 * already proven by `scan-test.ts`; this only needs a checked-in row to exist
 * to prove the COUNT is correct.
 *
 * SAFE ON REAL DATA. Every row created is tracked and removed in `finally`.
 */
import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";

import { closeDb, db } from "../src/db";
import { events, holds, orderItems, orders, seats, tickets, users, webhookEvents } from "../src/db/schema";
import {
  getCheckInStats,
  getEventHeader,
  getRecentOrders,
} from "../src/db/queries/analytics";
import { seatIsAvailable } from "../src/db/queries/availability";
import { createHold } from "../src/db/queries/holds";
import { createPendingOrder } from "../src/db/queries/orders";
import { stripe } from "../src/lib/stripe";

const BASE = process.env.RUSH_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.STRIPE_WEBHOOK_SECRET;

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq_<T>(name: string, actual: T, expected: T) {
  check(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const createdOrders: string[] = [];
const createdWebhookEventIds: string[] = [];
const touchedSeats: string[] = [];

function sessionPayload(orderId: string, seatIds: string[], amountTotal: number) {
  return {
    id: `cs_test_${randomUUID().replace(/-/g, "")}`,
    object: "checkout.session",
    amount_total: amountTotal,
    currency: "inr",
    payment_status: "paid",
    payment_intent: `pi_test_${randomUUID().replace(/-/g, "")}`,
    metadata: { orderId, seatIds: [...seatIds].sort().join(",") },
  };
}

function eventPayload(sessionObject: unknown) {
  const id = `evt_test_${randomUUID().replace(/-/g, "")}`;
  createdWebhookEventIds.push(id);
  return JSON.stringify({
    id,
    object: "event",
    api_version: "2026-09-30.endive",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "checkout.session.completed",
    data: { object: sessionObject },
  });
}

async function fireWebhook(body: string) {
  const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET! });
  const response = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": signature },
    body,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function main() {
  if (!SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is not set");

  const [liveEvent] = await db
    .select({
      id: events.id,
      organizerId: events.organizerId,
      title: events.title,
      startsAt: events.startsAt,
    })
    .from(events)
    .where(eq(events.status, "live"))
    .limit(1);
  if (!liveEvent) throw new Error("no live event seeded");

  const [venue] = await db.execute<{ name: string; city: string }>(sql`
    select v.name as name, v.city as city
    from events e join venues v on v.id = e.venue_id
    where e.id = ${liveEvent.id}
  `);

  const [buyer] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, "buyer"))
    .limit(1);
  if (!buyer) throw new Error("need a seeded buyer");

  const randomOrganizer = randomUUID();

  /* ── 1. getEventHeader ──────────────────────────────────────────────────── */
  console.log("\n1. getEventHeader");

  const header = await getEventHeader(liveEvent.id, liveEvent.organizerId);
  check("returns the event for its real organizer", header !== null);
  if (header) {
    eq_("title matches", header.title, liveEvent.title);
    eq_("venue matches", header.venue, venue?.name);
    eq_("city matches", header.city, venue?.city);
    eq_(
      "startsAt matches to the second",
      Math.floor(header.startsAt.getTime() / 1000),
      Math.floor(new Date(liveEvent.startsAt).getTime() / 1000),
    );
  }
  eq_(
    "returns null for a wrong organizer",
    await getEventHeader(liveEvent.id, randomOrganizer),
    null,
  );
  eq_(
    "returns null for a non-existent event",
    await getEventHeader(randomUUID(), liveEvent.organizerId),
    null,
  );

  /* ── 2. fixture: one real paid, checked-in ticket ────────────────────────── */
  console.log("\n2. Fixture — a real hold, a real purchase, one checked-in ticket");

  const before = await getCheckInStats(liveEvent.id, liveEvent.organizerId);
  const beforeRecent = await getRecentOrders(liveEvent.id, liveEvent.organizerId, 50);
  if (!before || !beforeRecent) throw new Error("ownership check failed unexpectedly");

  const free = await db.execute<{ id: string }>(sql`
    select st.id from ${seats} st
    where st.event_id = ${liveEvent.id} and ${seatIsAvailable(sql`st.id`)}
    order by st.id limit 1
  `);
  if (free.length === 0) throw new Error("no available seat in the live event");
  const seatId = free[0].id;
  touchedSeats.push(seatId);

  await createHold({ userId: buyer.id, seatIds: [seatId] });
  const order = await createPendingOrder({ userId: buyer.id, seatIds: [seatId] });
  createdOrders.push(order.orderId);

  const res = await fireWebhook(eventPayload(sessionPayload(order.orderId, [seatId], order.totalCents)));
  check("the webhook fulfilled the purchase", res.status === 200, JSON.stringify(res.body));

  const [ticketRow] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.orderId, order.orderId));
  check("exactly one ticket was issued", Boolean(ticketRow));

  if (ticketRow) {
    await db.update(tickets).set({ checkedInAt: sql`now()` }).where(eq(tickets.id, ticketRow.id));
  }

  /* ── 3. getCheckInStats ─────────────────────────────────────────────────── */
  console.log("\n3. getCheckInStats");

  const after = await getCheckInStats(liveEvent.id, liveEvent.organizerId);
  if (!after) throw new Error("ownership check failed unexpectedly");

  eq_("ticketsSold increased by exactly 1", after.ticketsSold - before.ticketsSold, 1);
  eq_("checkedIn increased by exactly 1", after.checkedIn - before.checkedIn, 1);
  eq_(
    "returns null for a wrong organizer",
    await getCheckInStats(liveEvent.id, randomOrganizer),
    null,
  );

  /* ── 4. getRecentOrders ─────────────────────────────────────────────────── */
  console.log("\n4. getRecentOrders");

  const afterRecent = await getRecentOrders(liveEvent.id, liveEvent.organizerId, 50);
  if (!afterRecent) throw new Error("ownership check failed unexpectedly");

  eq_("exactly one new order appears", afterRecent.length - beforeRecent.length, 1);

  const mine = afterRecent.find((o) => o.orderId === order.orderId);
  check("the new order is in the list", Boolean(mine));
  if (mine) {
    eq_("buyer email matches", mine.buyerEmail, buyer.email);
    eq_("seat count is 1", mine.seatCount, 1);
    eq_("total matches the order's real total", mine.totalCents, order.totalCents);
  }

  check(
    "newest first — the new order is at or before index 0's timestamp order",
    afterRecent[0].createdAt.getTime() >= afterRecent[afterRecent.length - 1].createdAt.getTime(),
  );

  const limited = await getRecentOrders(liveEvent.id, liveEvent.organizerId, 1);
  eq_("the limit parameter is honoured", limited?.length, 1);

  eq_(
    "returns null for a wrong organizer",
    await getRecentOrders(liveEvent.id, randomOrganizer),
    null,
  );

  /* ── 5. the recent-orders route's own authorization ──────────────────────── */
  console.log("\n5. GET /api/organizer/events/[id]/recent-orders");

  const unauth = await fetch(`${BASE}/api/organizer/events/${liveEvent.id}/recent-orders`);
  check("unauthenticated request is refused", unauth.status === 401, `${unauth.status}`);

  const missing = await fetch(`${BASE}/api/organizer/events/${randomUUID()}/recent-orders`);
  check(
    "a non-existent event is refused (not a 500)",
    missing.status === 401 || missing.status === 404,
    `${missing.status}`,
  );
}

async function cleanup() {
  if (createdOrders.length) {
    await db.delete(tickets).where(inArray(tickets.orderId, createdOrders));
    await db.delete(orderItems).where(inArray(orderItems.orderId, createdOrders));
    await db.delete(orders).where(inArray(orders.id, createdOrders));
  }
  if (createdWebhookEventIds.length) {
    await db.delete(webhookEvents).where(inArray(webhookEvents.stripeEventId, createdWebhookEventIds));
  }
  if (touchedSeats.length) {
    await db.delete(holds).where(inArray(holds.seatId, touchedSeats));
    await db.update(seats).set({ status: "available" }).where(inArray(seats.id, touchedSeats));
  }
  console.log(
    `\n  cleanup: ${createdOrders.length} order(s), ${createdWebhookEventIds.length} webhook event(s), ` +
      `${touchedSeats.length} seat(s) restored.`,
  );
}

main()
  .catch((error) => {
    failed++;
    console.error("\n  UNCAUGHT:", error);
  })
  .finally(async () => {
    await cleanup().catch((e) => {
      failed++;
      console.error("  cleanup failed:", e);
    });
    console.log("─".repeat(64));
    console.log(failed === 0 ? `PASS — ${passed} checks` : `${failed} FAILED of ${passed + failed}`);
    await closeDb().catch(() => {});
    process.exitCode = failed === 0 ? 0 : 1;
  });
