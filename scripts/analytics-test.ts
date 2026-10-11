/**
 * T36 verification — the five organizer analytics queries.
 *
 *   npm run analytics-test          (dev server must be running)
 *
 * Calls the real `createHold` / `createPendingOrder` and fires REAL signed
 * Stripe webhook payloads at the real `/api/webhooks/stripe` route — the exact
 * technique `webhook-test.ts` uses — so every number this asserts comes from
 * the production fulfilment path, not a shortcut insert.
 *
 * ── WHY EVERYTHING IS A DELTA, NOT AN ABSOLUTE VALUE ───────────────────────
 * The event this runs against already carries whatever earlier test runs and
 * seed data left behind. Asserting "revenue is exactly ₹X" would be asserting
 * about the database's entire history, not about this task. Every check below
 * snapshots the five queries BEFORE touching anything, runs a known fixture,
 * snapshots again AFTER, and asserts the DIFFERENCE — which is true regardless
 * of what else has ever happened to this event.
 *
 * ── THE FIXTURE IS THE PROOF, NOT JUST SETUP ───────────────────────────────
 * Two scenarios, deliberately shaped to break a naive implementation:
 *
 *   Seat 1 (section A): buyer A holds it and abandons it (released, no sale).
 *     Buyer B then holds and buys it. A STRANGER'S abandoned hold must not be
 *     counted as a conversion, and must not be mistaken for the hold that
 *     actually converted.
 *
 *   Seat 2 (section B, a DIFFERENT section): buyer B holds it, changes their
 *     mind, releases it, then holds it AGAIN and buys it. The SAME user now
 *     has two hold rows on one seat — one abandoned, one converted. A join on
 *     (seat_id, user_id) alone cannot tell them apart; only `ROW_NUMBER() …
 *     ORDER BY created_at DESC` picks the right one. Section 7 runs the naive
 *     join directly and shows it overcounts, which is what makes this a
 *     negative control rather than just a second happy-path case.
 *
 * Both converting holds are backdated by the same known offset before their
 * webhook fires, so the average-hold-to-purchase assertion has a real,
 * tight expected value instead of "some positive number".
 *
 * ── A FALSE PASS THIS SCRIPT ITSELF PRODUCED, ON ITS FIRST RUN ─────────────
 * `sessionPayload`'s `amount_total` defaulted to 0, copying `webhook-test.ts`'s
 * helper without copying the override every one of ITS success-path calls
 * applies. The webhook correctly recomputes and verifies the price server-side
 * (CLAUDE.md: "never trust the client for price") and refused to fulfil a
 * session claiming ₹0 - so both orders stayed `'pending'` with no
 * `order_items` at all, and every real assertion should have failed.
 *
 * Instead the revenue check passed, because it compared `after - before`
 * against a number read from the very same empty `order_items` the bug
 * produced: 0 vs 0. The other seven assertions downstream of that one all
 * failed loudly, which is what caught it - but the fix is also recorded in the
 * assertion itself, in section 5: the expected delta now comes from `sections`,
 * fetched before either order_item exists, so a fixture that silently does
 * nothing can no longer agree with itself.
 *
 * SAFE ON REAL DATA. Every row this creates is tracked and removed in the
 * finally block; `check-seed.mjs` is the way to confirm nothing was left
 * behind.
 */
import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";

import { closeDb, db } from "../src/db";
import {
  events,
  holds,
  orderItems,
  orders,
  seats,
  sections,
  tickets,
  users,
  webhookEvents,
} from "../src/db/schema";
import {
  getAvgHoldToPurchase,
  getConversionFunnel,
  getEventRevenue,
  getSalesOverTime,
  getSectionSellThrough,
} from "../src/db/queries/analytics";
import { seatIsAvailable } from "../src/db/queries/availability";
import { createHold, releaseHolds } from "../src/db/queries/holds";
import { createPendingOrder } from "../src/db/queries/orders";
import { stripe } from "../src/lib/stripe";

const BASE = process.env.RUSH_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/** The backdate applied to each converting hold, in seconds. */
const BACKDATE_SECONDS = 90;
/** Slack around BACKDATE_SECONDS to absorb the script's own execution time. */
const TOLERANCE_SECONDS = 20;

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

/* ── signed webhook delivery, mirroring webhook-test.ts ─────────────────── */

function sessionPayload(orderId: string, seatIds: string[], amountTotal: number) {
  return {
    id: `cs_test_${randomUUID().replace(/-/g, "")}`,
    object: "checkout.session",
    /* Must equal the order's real total. The webhook recomputes and verifies
       this server-side (CLAUDE.md: "never trust the client for price") - a
       mismatch is correctly treated as suspicious and fulfilment is refused,
       which is exactly what silently happened the first time this script ran
       with the lazy default of 0. */
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
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: SECRET!,
  });
  const response = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": signature },
    body,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Hold, then immediately buy — the real T20 -> T28 path, end to end. */
async function holdAndBuy(userId: string, seatIds: string[], backdateSeconds: number) {
  touchedSeats.push(...seatIds);
  await createHold({ userId, seatIds: [...seatIds].sort() });

  /* Backdated AFTER creation, the same technique `realtime-test.ts` uses on
     `expires_at` — this is the one fact the test controls that the real app
     never would, and it is what turns "the average is positive" into "the
     average is 90 seconds, provably". */
  await db
    .update(holds)
    .set({ createdAt: sql`now() - interval '${sql.raw(String(backdateSeconds))} seconds'` })
    .where(inArray(holds.seatId, seatIds));

  const order = await createPendingOrder({ userId, seatIds: [...seatIds].sort() });
  createdOrders.push(order.orderId);

  const body = eventPayload(sessionPayload(order.orderId, seatIds, order.totalCents));
  const res = await fireWebhook(body);
  return { order, res };
}

/** Hold, then give it back — never reaches checkout. */
async function holdAndAbandon(userId: string, seatId: string) {
  touchedSeats.push(seatId);
  await createHold({ userId, seatIds: [seatId] });
  await releaseHolds({ userId, seatIds: [seatId] });
}

type Snapshot = {
  revenueCents: number;
  paidOrders: number;
  holdsCreated: number;
  holdsConverted: number;
  avgSeconds: number | null;
  sampleSize: number;
  sections: Map<string, { totalSeats: number; soldSeats: number }>;
};

async function snapshot(eventId: string, organizerId: string): Promise<Snapshot> {
  const [revenue, funnel, avg, sections] = await Promise.all([
    getEventRevenue(eventId, organizerId),
    getConversionFunnel(eventId, organizerId),
    getAvgHoldToPurchase(eventId, organizerId),
    getSectionSellThrough(eventId, organizerId),
  ]);
  if (!revenue || !funnel || !avg || !sections) throw new Error("snapshot: owned-event check failed");

  return {
    revenueCents: revenue.revenueCents,
    paidOrders: revenue.paidOrders,
    holdsCreated: funnel.holdsCreated,
    holdsConverted: funnel.holdsConverted,
    avgSeconds: avg.avgSeconds,
    sampleSize: avg.sampleSize,
    sections: new Map(sections.map((s) => [s.sectionId, { totalSeats: s.totalSeats, soldSeats: s.soldSeats }])),
  };
}

async function main() {
  if (!SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is not set");

  const [liveEvent] = await db
    .select({ id: events.id, organizerId: events.organizerId, title: events.title })
    .from(events)
    .where(eq(events.status, "live"))
    .limit(1);
  if (!liveEvent) throw new Error("no live event seeded");

  const buyers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "buyer"))
    .limit(2);
  if (buyers.length < 2) throw new Error("need at least 2 seeded buyers");
  const [buyerA, buyerB] = buyers.map((b) => b.id);

  /* Two available seats in two DIFFERENT sections, so sell-through can be
     checked per section independently. */
  const freeSeats = await db.execute<{ id: string; section_id: string }>(sql`
    select distinct on (st.section_id) st.id, st.section_id
    from ${seats} st
    where st.event_id = ${liveEvent.id} and ${seatIsAvailable(sql`st.id`)}
    order by st.section_id, st.id
    limit 2
  `);
  if (freeSeats.length < 2) throw new Error("need 2 available seats in 2 different sections");
  const [seat1, seat2] = freeSeats;

  console.log(`\n  Event : ${liveEvent.title}`);
  console.log(`  Seat1 : ${seat1.id}  (section ${seat1.section_id})`);
  console.log(`  Seat2 : ${seat2.id}  (section ${seat2.section_id})\n`);

  const priceRows = await db.execute<{ id: string; price_cents: number }>(sql`
    select id, price_cents from ${sections} where id in (${seat1.section_id}, ${seat2.section_id})
  `);
  const priceBySection = new Map(priceRows.map((r) => [r.id, r.price_cents]));
  const expectedSeat1Price = priceBySection.get(seat1.section_id) ?? 0;
  const expectedSeat2Price = priceBySection.get(seat2.section_id) ?? 0;

  /* ── 1. authorization: the check this task adds beyond the brief ────────── */
  console.log("1. Ownership authorization (not asked for in the brief, added anyway)");

  eq_(
    "a non-existent event returns null, not a crash",
    await getEventRevenue(randomUUID(), liveEvent.organizerId),
    null,
  );
  eq_(
    "the RIGHT organizer sees the event (sanity check before the negative)",
    (await getEventRevenue(liveEvent.id, liveEvent.organizerId)) === null,
    false,
  );
  for (const [name, fn] of [
    ["getEventRevenue", getEventRevenue],
    ["getSectionSellThrough", getSectionSellThrough],
    ["getSalesOverTime", getSalesOverTime],
    ["getConversionFunnel", getConversionFunnel],
    ["getAvgHoldToPurchase", getAvgHoldToPurchase],
  ] as const) {
    check(
      `${name} returns null for a WRONG organizer (a stranger's uuid)`,
      (await fn(liveEvent.id, buyerA)) === null,
      "a different organizer could read this event's revenue",
    );
  }

  /* ── 2. the before snapshot ──────────────────────────────────────────────── */
  console.log("\n2. Snapshot before the fixture");
  const before = await snapshot(liveEvent.id, liveEvent.organizerId);
  console.log(
    `      revenue ${before.revenueCents}  holds ${before.holdsCreated}/${before.holdsConverted}  ` +
      `avg ${before.avgSeconds ?? "null"}s over ${before.sampleSize}`,
  );

  /* ── 3. scenario A: a STRANGER's abandoned hold must not count ──────────── */
  console.log("\n3. Seat 1 — buyer A abandons, buyer B buys");

  await holdAndAbandon(buyerA, seat1.id);
  const { order: order1, res: res1 } = await holdAndBuy(buyerB, [seat1.id], BACKDATE_SECONDS);

  check("the webhook fulfilled seat 1's purchase", res1.status === 200, JSON.stringify(res1.body));

  /* ── 4. scenario B: the SAME user's own abandoned attempt ────────────────
   * This is the one a plain (seat_id, user_id) join gets wrong: buyer B now
   * has TWO hold rows on seat 2, one abandoned and one converted, both
   * belonging to them. */
  console.log("\n4. Seat 2 — buyer B abandons their OWN first attempt, then buys");

  await holdAndAbandon(buyerB, seat2.id);
  const { order: order2, res: res2 } = await holdAndBuy(buyerB, [seat2.id], BACKDATE_SECONDS);

  check("the webhook fulfilled seat 2's purchase", res2.status === 200, JSON.stringify(res2.body));

  /* ── 5. the after snapshot, and the deltas ───────────────────────────────── */
  console.log("\n5. Snapshot after — and the deltas this fixture must produce exactly");
  const after = await snapshot(liveEvent.id, liveEvent.organizerId);

  /* Computed from `sections`, fetched BEFORE either order_item existed - so
     the expectation is independent of the thing being verified. A fixture
     that silently did nothing (as the first run of this script did, before
     `amount_total` was fixed to match the order's real total - see the
     module note) would show up here as `expectedRevenueDelta === 0` and the
     next check now catches that directly, instead of the two sides agreeing
     by both being zero. */
  const expectedRevenueDelta = expectedSeat1Price + expectedSeat2Price;
  check(
    "the fixture actually priced something (catches a silent no-op fixture)",
    expectedRevenueDelta > 0,
    `expected > 0, got ${expectedRevenueDelta}`,
  );
  eq_(
    "revenue increased by exactly the two seats' frozen prices",
    after.revenueCents - before.revenueCents,
    expectedRevenueDelta,
  );
  eq_("paid order count increased by exactly 2", after.paidOrders - before.paidOrders, 2);

  /* THE CORE PROOF. 4 holds were created (A-abandon, B-abandon, B-convert x2).
     Only 2 may count as converted — A's and B's OWN abandoned attempts must
     both be excluded, leaving exactly the two holds that actually produced a
     sale. */
  eq_(
    "exactly 4 holds were created by this fixture",
    after.holdsCreated - before.holdsCreated,
    4,
  );
  eq_(
    "exactly 2 holds converted — both abandoned attempts correctly excluded",
    after.holdsConverted - before.holdsConverted,
    2,
  );

  for (const [label, seat] of [["seat 1's section", seat1], ["seat 2's section", seat2]] as const) {
    const b = before.sections.get(seat.section_id);
    const a = after.sections.get(seat.section_id);
    check(
      `${label}: sold-seats increased by exactly 1, total unchanged`,
      Boolean(b && a && a.soldSeats - b.soldSeats === 1 && a.totalSeats === b.totalSeats),
      `before ${JSON.stringify(b)} after ${JSON.stringify(a)}`,
    );
  }

  /* The weighted-average back-out: both new samples were backdated by the
     SAME offset, so their combined average must sit tightly around it. */
  const sampleDelta = after.sampleSize - before.sampleSize;
  eq_("average's sample size grew by exactly 2", sampleDelta, 2);

  const beforeTotal = (before.avgSeconds ?? 0) * before.sampleSize;
  const afterTotal = (after.avgSeconds ?? 0) * after.sampleSize;
  const newSamplesAvg = sampleDelta > 0 ? (afterTotal - beforeTotal) / sampleDelta : NaN;

  check(
    `the two new samples average ~${BACKDATE_SECONDS}s (not skewed by either abandoned hold)`,
    Math.abs(newSamplesAvg - BACKDATE_SECONDS) <= TOLERANCE_SECONDS,
    `got ${newSamplesAvg.toFixed(1)}s, want ${BACKDATE_SECONDS}s ± ${TOLERANCE_SECONDS}s`,
  );

  /* ── 6. sales over time: the window function's own invariant ────────────── */
  console.log("\n6. Sales over time — the running total must equal the real total");

  const series = await getSalesOverTime(liveEvent.id, liveEvent.organizerId);
  const finalRevenue = await getEventRevenue(liveEvent.id, liveEvent.organizerId);

  check("getSalesOverTime returns at least one bucket", Boolean(series && series.length > 0));
  if (series && finalRevenue) {
    eq_(
      "the LAST bucket's cumulative total equals getEventRevenue's total",
      series[series.length - 1].cumulativeRevenueCents,
      finalRevenue.revenueCents,
    );

    let monotonic = true;
    for (let i = 1; i < series.length; i++) {
      if (series[i].cumulativeRevenueCents < series[i - 1].cumulativeRevenueCents) monotonic = false;
    }
    check("the cumulative column never decreases", monotonic);

    check(
      "the series includes the current hour (the end bound is now(), not an old cap)",
      series[series.length - 1].hour.getTime() >= Date.now() - 2 * 60 * 60 * 1000,
      `last bucket was ${series[series.length - 1].hour.toISOString()}`,
    );

    const perBucketSum = series.reduce((sum, b) => sum + b.revenueCents, 0);
    eq_(
      "per-bucket revenue sums to the same total as the running total",
      perBucketSum,
      finalRevenue.revenueCents,
    );
  }

  /* ── 7. NEGATIVE CONTROL: the join a naive implementation would write ───── */
  console.log("\n7. NEGATIVE CONTROL — the plain (seat_id, user_id) join, with no ROW_NUMBER()");

  const naive = await db.execute<{ matches: string }>(sql`
    select count(*)::bigint as matches
    from order_items oi
    join orders o on o.id = oi.order_id
    join holds h
      on h.seat_id = oi.seat_id
     and h.user_id = o.user_id
     and h.created_at <= o.created_at
    where o.id in (${order1.orderId}, ${order2.orderId})
  `);
  const naiveMatches = Number(naive[0]?.matches ?? 0);

  console.log(`      ↳ naive join matches ${naiveMatches} hold row(s) for 2 order_items`);
  check(
    "the naive join OVERCOUNTS — it matches buyer B's abandoned hold too",
    naiveMatches > 2,
    `expected > 2 (it should double-count seat 2's order_item), got ${naiveMatches}`,
  );
  check(
    "...while the shipped query, proven above, counted exactly 2 — ROW_NUMBER() is what closes the gap",
    after.holdsConverted - before.holdsConverted === 2,
  );

  /* ── 8. sell-through invariants over the WHOLE event ─────────────────────── */
  console.log("\n8. Sell-through sanity, across every section");

  const allSections = await getSectionSellThrough(liveEvent.id, liveEvent.organizerId);
  check("every section's percentage is within [0, 100]", Boolean(
    allSections?.every((s) => s.sellThroughPct >= 0 && s.sellThroughPct <= 100),
  ));
  check("no section reports more sold seats than it has total", Boolean(
    allSections?.every((s) => s.soldSeats <= s.totalSeats),
  ));
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
