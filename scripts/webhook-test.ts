/**
 * T28 verification — the idempotent Stripe webhook.
 *
 *   npm run webhook-test          (dev server must be running)
 *
 * Fires REAL signed payloads over REAL HTTP at the REAL route, signed with the
 * REAL `STRIPE_WEBHOOK_SECRET` via the Stripe SDK's own
 * `generateTestHeaderString`. Nothing is mocked and nothing is stubbed: the
 * signature verification, the tolerance window, the idempotency gate, the
 * transaction and every index are all the production article.
 *
 * ── WHY THIS AND NOT `stripe trigger` ──────────────────────────────────────
 * The Stripe CLI can replay canned events, but it cannot make two deliveries of
 * ONE event land on the handler simultaneously - and that is the single most
 * important thing to prove here, because the concurrent duplicate is exactly
 * what a `SELECT`-then-`INSERT` idempotency check fails to stop. Section 7
 * below is the webhook's equivalent of T21's race test.
 *
 * SAFE ON REAL DATA. Every hold, order, ticket and webhook_events row created
 * here is recorded and removed in the finally block, and seat statuses are
 * restored. Re-run scripts/check-seed.mjs afterwards to confirm.
 */
import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../src/db";
import {
  events,
  holds,
  orderItems,
  orders,
  seats,
  tickets,
  users,
  webhookEvents,
} from "../src/db/schema";
import { seatIsAvailable } from "../src/db/queries/availability";
import { createHold } from "../src/db/queries/holds";
import { createPendingOrder } from "../src/db/queries/orders";
import { SIGNATURE_TOLERANCE_SECONDS } from "../src/db/queries/webhooks";
import { verifyTicket } from "../src/lib/qr";
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

const createdOrders: string[] = [];
const createdEventIds: string[] = [];
const touchedSeats: string[] = [];

/* ── building signed events ─────────────────────────────────────────────── */

type SessionOverrides = {
  id?: string;
  amount_total?: number | null;
  payment_status?: string;
  metadata?: Record<string, string> | null;
};

/** A Checkout Session payload carrying only the fields the handler reads. */
function sessionPayload(orderId: string, seatIds: string[], o: SessionOverrides = {}) {
  return {
    id: o.id ?? `cs_test_${randomUUID().replace(/-/g, "")}`,
    object: "checkout.session",
    amount_total: o.amount_total === undefined ? 0 : o.amount_total,
    currency: "inr",
    payment_status: o.payment_status ?? "paid",
    payment_intent: `pi_test_${randomUUID().replace(/-/g, "")}`,
    metadata:
      o.metadata === undefined
        ? { orderId, seatIds: [...seatIds].sort().join(",") }
        : o.metadata,
  };
}

function eventPayload(type: string, sessionObject: unknown, eventId?: string) {
  const id = eventId ?? `evt_test_${randomUUID().replace(/-/g, "")}`;
  createdEventIds.push(id);
  return JSON.stringify({
    id,
    object: "event",
    api_version: "2026-09-30.endive",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: { object: sessionObject },
  });
}

/**
 * POST a payload with a signature generated from the real secret.
 *
 * `signAs` lets a test sign one body and send a different one - which is how
 * tampering is proven rather than asserted.
 */
async function post(
  body: string,
  opts: { signAs?: string; secret?: string; timestamp?: number; signature?: string } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (opts.signature !== undefined) {
    headers["stripe-signature"] = opts.signature;
  } else {
    headers["stripe-signature"] = stripe.webhooks.generateTestHeaderString({
      payload: opts.signAs ?? body,
      secret: opts.secret ?? SECRET!,
      timestamp: opts.timestamp,
    });
  }

  const response = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers,
    body,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/* ── database readback helpers ──────────────────────────────────────────── */

async function orderRow(orderId: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return row;
}

async function ticketRows(orderId: string) {
  return db.select().from(tickets).where(eq(tickets.orderId, orderId));
}

async function itemCount(seatIds: string[]) {
  const rows = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(inArray(orderItems.seatId, seatIds));
  return rows.length;
}

async function availableCount(seatIds: string[]) {
  const rows = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from ${seats} st
    where st.id in ${seatIds} and ${seatIsAvailable(sql`st.id`)}
  `);
  return Number(rows[0].n);
}

/** Hold seats, then open a pending order for them - the T20 -> T27 path. */
async function heldOrder(userId: string, seatIds: string[]) {
  touchedSeats.push(...seatIds);
  await createHold({ userId, seatIds: [...seatIds].sort() });
  const order = await createPendingOrder({ userId, seatIds: [...seatIds].sort() });
  createdOrders.push(order.orderId);
  return order;
}

async function main() {
  if (!SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is not set");

  const [liveEvent] = await db
    .select({ id: events.id, title: events.title })
    .from(events)
    .where(eq(events.status, "live"))
    .limit(1);
  if (!liveEvent) throw new Error("No live event seeded");

  /**
   * ONE BUYER PER PHASE, and that is not incidental.
   *
   * Several phases deliberately leave a live hold behind - the unpaid session
   * and the amount-mismatch session both end with the seats still held, which
   * is the correct outcome. Reusing one buyer across all of them hits T20's
   * four-seats-per-user-per-event cap on the fifth seat, and the suite fails
   * with SEAT_LIMIT_EXCEEDED on a test that was never about the cap.
   *
   * (That is exactly what happened on the first run of this script, and the
   * cap was right: the test was wrong.)
   */
  const buyers = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, "buyer"))
    .orderBy(users.email)
    .limit(5);
  if (buyers.length < 5) throw new Error("need five seeded buyers");
  const [unpaidBuyer, tamperBuyer, paidBuyer, raceBuyer, expiryBuyer] = buyers;

  const free = await db.execute<{ id: string }>(sql`
    select st.id from ${seats} st
    where st.event_id = ${liveEvent.id} and ${seatIsAvailable(sql`st.id`)}
    order by st.id limit 12
  `);
  if (free.length < 12) throw new Error("need twelve free seats");
  const pool = free.map((r) => r.id);

  console.log(`\n  Event: ${liveEvent.title}`);
  console.log(`  Buyers: ${buyers.map((b) => b.email).join(", ")}`);
  console.log(`  Route: ${BASE}/api/webhooks/stripe\n`);

  /* ── 1. SIGNATURE IS THE AUTHENTICATION ──────────────────────────────── */
  console.log("1. Signature verification (the only auth this route has)");

  const dummy = eventPayload("checkout.session.completed", sessionPayload(randomUUID(), []));

  /* No stripe-signature header at all - sent raw rather than through post(),
     which always attaches one. */
  const noHeader = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: dummy,
  });
  check("no stripe-signature header is rejected 400", noHeader.status === 400, `${noHeader.status}`);

  const garbage = await post(dummy, { signature: "t=1,v1=deadbeef" });
  check("a garbage signature is rejected 400", garbage.status === 400, `${garbage.status}`);

  const wrongSecret = await post(dummy, { secret: "whsec_not_the_real_secret" });
  check(
    "a signature from the WRONG secret is rejected 400",
    wrongSecret.status === 400,
    `${wrongSecret.status}`,
  );

  /* Sign one body, send another - the forgery that a naive "just parse the
     JSON" handler would happily accept. */
  const tamperedBody = eventPayload(
    "checkout.session.completed",
    sessionPayload(randomUUID(), []),
  );
  const tampered = await post(tamperedBody, { signAs: dummy });
  check(
    "a TAMPERED body (valid signature for different bytes) is rejected 400",
    tampered.status === 400,
    `${tampered.status}`,
  );

  /* The timestamp is inside the signed material, so a captured payload cannot
     be replayed later - this is the anti-replay property of the scheme. */
  const stale = await post(dummy, {
    timestamp: Math.floor(Date.now() / 1000) - (SIGNATURE_TOLERANCE_SECONDS + 600),
  });
  check(
    `a STALE payload (older than the ${SIGNATURE_TOLERANCE_SECONDS}s tolerance) is rejected 400`,
    stale.status === 400,
    `${stale.status}`,
  );
  console.log("      ↳ a captured payload cannot be resent tomorrow.");

  /* ── 2. valid signature, event we do not act on ──────────────────────── */
  console.log("\n2. A validly signed event type this app ignores");
  const ignored = await post(
    eventPayload("payment_intent.created", { id: "pi_x", object: "payment_intent" }),
  );
  check("answers 200 so Stripe stops retrying it", ignored.status === 200, `${ignored.status}`);
  check("and says it ignored it", ignored.body?.ignored === "payment_intent.created");

  /* ── 3. metadata that cannot be used ─────────────────────────────────── */
  console.log("\n3. A signed session with no usable metadata");
  const noMeta = await post(
    eventPayload("checkout.session.completed", sessionPayload("", [], { metadata: null })),
  );
  check("answers 200 (no retry can add metadata)", noMeta.status === 200, `${noMeta.status}`);
  check("and reports bad_metadata", noMeta.body?.ignored === "bad_metadata");

  /* ── 4. completed-but-unpaid MUST NOT fulfil ─────────────────────────── */
  console.log("\n4. `completed` with payment_status=unpaid (the free-ticket trap)");
  const unpaidSeats = [pool[0], pool[1]];
  const unpaidOrder = await heldOrder(unpaidBuyer.id, unpaidSeats);
  const unpaidRes = await post(
    eventPayload(
      "checkout.session.completed",
      sessionPayload(unpaidOrder.orderId, unpaidSeats, {
        payment_status: "unpaid",
        amount_total: unpaidOrder.totalCents,
      }),
    ),
  );
  check("answers 200", unpaidRes.status === 200, `${unpaidRes.status}`);
  check(
    "but the order is NOT paid",
    (await orderRow(unpaidOrder.orderId))?.status === "pending",
    "AN UNPAID SESSION WAS FULFILLED",
  );
  check("and no tickets were issued", (await ticketRows(unpaidOrder.orderId)).length === 0);
  console.log("      ↳ `completed` means the flow finished, not that money moved.");

  /* ── 5. amount tampering ─────────────────────────────────────────────── */
  console.log("\n5. A session claiming a different amount than the order");
  const tamperSeats = [pool[2], pool[3]];
  const tamperOrder = await heldOrder(tamperBuyer.id, tamperSeats);
  const tamperRes = await post(
    eventPayload(
      "checkout.session.completed",
      sessionPayload(tamperOrder.orderId, tamperSeats, { amount_total: 100 }),
    ),
  );
  check("answers 200", tamperRes.status === 200, `${tamperRes.status}`);
  check("outcome is mismatch", tamperRes.body?.outcome === "mismatch", tamperRes.body?.outcome);
  check(
    "the order was NOT marked paid for the wrong amount",
    (await orderRow(tamperOrder.orderId))?.status === "pending",
  );
  check("and no tickets were issued", (await ticketRows(tamperOrder.orderId)).length === 0);

  /* ── 6. THE HAPPY PATH ───────────────────────────────────────────────── */
  console.log("\n6. A genuine paid session");
  const paidSeats = [pool[4], pool[5]];
  const paidOrder = await heldOrder(paidBuyer.id, paidSeats);
  const sessionObj = sessionPayload(paidOrder.orderId, paidSeats, {
    amount_total: paidOrder.totalCents,
  });
  const paidBody = eventPayload("checkout.session.completed", sessionObj);
  const paidRes = await post(paidBody);

  check("answers 200", paidRes.status === 200, `${paidRes.status}`);
  check("outcome is fulfilled", paidRes.body?.outcome === "fulfilled", paidRes.body?.outcome);

  const paidRow = await orderRow(paidOrder.orderId);
  check("the order is now 'paid'", paidRow?.status === "paid", paidRow?.status);
  check("order_items exist, one per seat", (await itemCount(paidSeats)) === 2);

  const seatStatuses = await db
    .select({ status: seats.status })
    .from(seats)
    .where(inArray(seats.id, paidSeats));
  check("seats.status is 'sold'", seatStatuses.every((s) => s.status === "sold"));

  const liveHolds = await db
    .select({ id: holds.id })
    .from(holds)
    .where(and(inArray(holds.seatId, paidSeats), sql`${holds.releasedAt} is null`));
  check("the holds were released", liveHolds.length === 0, `${liveHolds.length} still live`);

  const issued = await ticketRows(paidOrder.orderId);
  check("two tickets were created", issued.length === 2, `${issued.length}`);
  check(
    "every ticket's HMAC signature actually verifies",
    issued.every((t) => verifyTicket(t.id, t.orderId, t.seatId, t.qrSignature)),
    "A TICKET SIGNATURE IS INVALID — it would be rejected at the gate",
  );
  check(
    "a forged signature does NOT verify",
    !verifyTicket(issued[0].id, issued[0].orderId, issued[0].seatId, "0".repeat(64)),
  );
  check(
    "the seats are no longer available",
    (await availableCount(paidSeats)) === 0,
  );

  /* ── 7. IDEMPOTENCY — the reason this task exists ────────────────────── */
  console.log("\n7. Replaying the SAME event id (Stripe's retry)");
  const replay = await post(paidBody);
  check("answers 200", replay.status === 200, `${replay.status}`);
  check("outcome is replayed", replay.body?.outcome === "replayed", replay.body?.outcome);
  check(
    "STILL exactly two tickets — no duplicates",
    (await ticketRows(paidOrder.orderId)).length === 2,
    "DUPLICATE TICKETS ISSUED FOR ONE PAYMENT",
  );
  check("still exactly two order_items", (await itemCount(paidSeats)) === 2);

  console.log("\n   A DIFFERENT event id for the same already-paid order");
  const resend = await post(
    eventPayload("checkout.session.completed", sessionObj),
  );
  check("answers 200", resend.status === 200, `${resend.status}`);
  check(
    "outcome is already_paid (the second line of defence)",
    resend.body?.outcome === "already_paid",
    resend.body?.outcome,
  );
  check(
    "still exactly two tickets",
    (await ticketRows(paidOrder.orderId)).length === 2,
    "A DASHBOARD RESEND DUPLICATED THE TICKETS",
  );
  console.log("      ↳ webhook_events catches the same id; this catches a new id.");

  /* ── 8. THE CONCURRENT DUPLICATE — what a SELECT pre-check misses ────── */
  console.log("\n8. 20 deliveries of ONE event, fired simultaneously");
  console.log("   (the race a `SELECT ... WHERE stripe_event_id` check loses)");
  const raceSeats = [pool[6], pool[7]];
  const raceOrder = await heldOrder(raceBuyer.id, raceSeats);
  const raceBody = eventPayload(
    "checkout.session.completed",
    sessionPayload(raceOrder.orderId, raceSeats, { amount_total: raceOrder.totalCents }),
  );
  /* One signature, reused - byte-identical deliveries, exactly as a retry
     storm would look. */
  const raceSig = stripe.webhooks.generateTestHeaderString({
    payload: raceBody,
    secret: SECRET,
  });

  const RACERS = 20;
  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: RACERS }, () =>
      fetch(`${BASE}/api/webhooks/stripe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": raceSig },
        body: raceBody,
      }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
    ),
  );
  const elapsed = Math.round(performance.now() - started);

  const outcomes = results.reduce<Record<string, number>>((acc, r) => {
    const key = r.body?.outcome ?? `http_${r.status}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\n      ${RACERS} concurrent deliveries in ${elapsed} ms`);
  console.log(`      outcomes: ${JSON.stringify(outcomes)}\n`);

  check("every delivery answered 200", results.every((r) => r.status === 200));
  check(
    "EXACTLY ONE said 'fulfilled'",
    outcomes.fulfilled === 1,
    `${outcomes.fulfilled ?? 0} fulfilled — the idempotency gate leaked`,
  );
  check(
    `the other ${RACERS - 1} were absorbed as replayed/already_paid`,
    (outcomes.replayed ?? 0) + (outcomes.already_paid ?? 0) === RACERS - 1,
    JSON.stringify(outcomes),
  );

  const raceTickets = await ticketRows(raceOrder.orderId);
  check(
    "DB VERIFICATION: exactly two tickets for two seats",
    raceTickets.length === 2,
    `${raceTickets.length} tickets — ONE PAYMENT ISSUED ${raceTickets.length} TICKETS`,
  );
  check("exactly two order_items", (await itemCount(raceSeats)) === 2);
  check(
    "exactly one webhook_events row for that event id",
    (
      await db
        .select({ id: webhookEvents.id })
        .from(webhookEvents)
        .where(eq(webhookEvents.stripeEventId, JSON.parse(raceBody).id))
    ).length === 1,
  );
  check("the order is paid exactly once", (await orderRow(raceOrder.orderId))?.status === "paid");

  /* ── 9. expiry ───────────────────────────────────────────────────────── */
  console.log("\n9. `checkout.session.expired` on an unpaid order");
  const expSeats = [pool[8], pool[9]];
  const expOrder = await heldOrder(expiryBuyer.id, expSeats);

  /* The hold is pinned to the session's expiry by T27, so force it past now()
     to model the state the real event arrives in. */
  await db
    .update(holds)
    .set({ expiresAt: sql`now() - interval '1 minute'` })
    .where(inArray(holds.seatId, expSeats));

  const beforeExpiry = await availableCount(expSeats);
  check(
    "the seats are ALREADY available before the event arrives (T22 lazy expiry)",
    beforeExpiry === 2,
    `${beforeExpiry}/2 — availability wrongly depends on this webhook`,
  );

  const expRes = await post(
    eventPayload(
      "checkout.session.expired",
      sessionPayload(expOrder.orderId, expSeats, { amount_total: expOrder.totalCents }),
    ),
  );
  check("answers 200", expRes.status === 200, `${expRes.status}`);
  check("outcome is expired", expRes.body?.outcome === "expired", expRes.body?.outcome);
  check(
    "the order is marked 'failed', not left pending forever",
    (await orderRow(expOrder.orderId))?.status === "failed",
  );
  const expHolds = await db
    .select({ id: holds.id })
    .from(holds)
    .where(and(inArray(holds.seatId, expSeats), sql`${holds.releasedAt} is null`));
  check("the expired holds now carry released_at", expHolds.length === 0);
  const expStatuses = await db
    .select({ status: seats.status })
    .from(seats)
    .where(inArray(seats.id, expSeats));
  check(
    "the stale seats.status cache was repaired",
    expStatuses.every((s) => s.status === "available"),
    expStatuses.map((s) => s.status).join(","),
  );

  /* ── 10. expiry must never touch a PAID order ────────────────────────── */
  console.log("\n10. A late `expired` event for an order that was PAID");
  const lateRes = await post(
    eventPayload(
      "checkout.session.expired",
      sessionPayload(paidOrder.orderId, paidSeats, { amount_total: paidOrder.totalCents }),
    ),
  );
  check("answers 200", lateRes.status === 200, `${lateRes.status}`);
  check(
    "outcome is already_paid — the seats are NOT released",
    lateRes.body?.outcome === "already_paid",
    lateRes.body?.outcome,
  );
  check(
    "the paid order is still paid",
    (await orderRow(paidOrder.orderId))?.status === "paid",
    "A LATE EXPIRY EVENT REVOKED A PAID ORDER",
  );
  check("and its seats are still sold", (await availableCount(paidSeats)) === 0);
  console.log("      ↳ out-of-order delivery cannot take a valid ticket away.");
}

async function cleanup() {
  if (createdEventIds.length) {
    await db.delete(webhookEvents).where(inArray(webhookEvents.stripeEventId, createdEventIds));
  }
  if (createdOrders.length) {
    // order_items and tickets cascade from orders (see schema.ts FKs).
    await db.delete(orders).where(inArray(orders.id, createdOrders));
  }
  if (touchedSeats.length) {
    await db.delete(holds).where(inArray(holds.seatId, touchedSeats));
    await db.update(seats).set({ status: "available" }).where(inArray(seats.id, touchedSeats));
  }
  console.log(
    `\n  cleanup: ${createdOrders.length} order(s), ${createdEventIds.length} webhook event(s), ` +
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
    process.exit(failed === 0 ? 0 : 1);
  });
