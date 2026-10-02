/**
 * T27 verification — exercises the REAL createPendingOrder transaction and the
 * REAL buildCheckoutSession Stripe call (the same functions the route calls,
 * not re-implementations), plus one HTTP pass at the route itself for the
 * rate-limit boundary.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/checkout-test.ts
 *   (dev server must be running for the rate-limit section - see T23's
 *   ratelimit-test.ts for why an unauthenticated probe is the right one)
 *
 * This is where T27's two corrections to the brief are proven, not just
 * asserted:
 *
 *   - Defect 1 (order_items would permanently brick a seat if created before
 *     payment): tests 7g/7o prove createPendingOrder never writes order_items,
 *     including on a repeat call against the same still-held seats.
 *   - Defect 2 (Stripe's 30-minute session floor outlives the 10-minute
 *     hold): tests 7e/7h/7k prove the hold's expires_at and the real Stripe
 *     session's expires_at land on the exact same instant.
 *
 * SAFE ON REAL DATA. Every hold and order this creates is recorded and removed
 * in the finally block; seat statuses are restored. Re-run
 * scripts/check-seed.mjs after it to confirm.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../src/db";
import { events, holds, orderItems, orders, seats, sections, users } from "../src/db/schema";
import { seatIsAvailable } from "../src/db/queries/availability";
import { createHold } from "../src/db/queries/holds";
import { createPendingOrder, OrderError, attachStripeSession } from "../src/db/queries/orders";
import { buildCheckoutSession } from "../src/lib/checkout-session";
import { CHECKOUT_RATE_LIMIT, isRedisConfigured } from "../src/lib/redis";

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

/** Runs createPendingOrder and reports the failure code instead of throwing. */
async function attempt(userId: string, seatIds: string[]) {
  try {
    const result = await createPendingOrder({ userId, seatIds: [...seatIds].sort() });
    return { ok: true as const, result };
  } catch (error) {
    if (error instanceof OrderError) return { ok: false as const, failure: error.failure };
    throw error;
  }
}

async function priceForSeats(seatIds: string[]): Promise<number> {
  const rows = await db
    .select({ priceCents: sections.priceCents })
    .from(seats)
    .innerJoin(sections, eq(sections.id, seats.sectionId))
    .where(inArray(seats.id, seatIds));
  return rows.reduce((sum, r) => sum + r.priceCents, 0);
}

const touchedSeats: string[] = [];
const createdOrders: string[] = [];

async function main() {
  const [liveEvent] = await db
    .select({ id: events.id, title: events.title })
    .from(events)
    .where(eq(events.status, "live"))
    .limit(1);
  if (!liveEvent) throw new Error("No live event seeded");

  const [otherEvent] = await db
    .select({ id: events.id })
    .from(events)
    .where(sql`${events.id} <> ${liveEvent.id}`)
    .limit(1);
  if (!otherEvent) throw new Error("Need a second event for the mixed-events check");

  const buyers = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, "buyer"))
    .limit(2);
  const [alice, bob] = buyers;

  const free = await db.execute<{ id: string }>(sql`
    select st.id from ${seats} st
    where st.event_id = ${liveEvent.id} and ${seatIsAvailable(sql`st.id`)}
    order by st.id limit 8
  `);
  if (free.length < 8) throw new Error("need eight free seats in the live event");
  const [seatNoHold, seatX, seatY, seatA, seatB] = free.map((r) => r.id);

  const [otherSeat] = await db
    .select({ id: seats.id })
    .from(seats)
    .where(eq(seats.eventId, otherEvent.id))
    .limit(1);

  console.log(`\n  Event: ${liveEvent.title}`);
  console.log(`  Alice: ${alice.email}   Bob: ${bob.email}\n`);

  /* ── 1. a seat that does not exist at all ────────────────────────────── */
  console.log("1. A seat id that doesn't exist");
  const notFound = await attempt(alice.id, ["00000000-0000-4000-8000-000000000000"]);
  check("fails SEATS_NOT_FOUND", !notFound.ok && notFound.failure.code === "SEATS_NOT_FOUND");

  /* ── 2. a real, free seat nobody holds ───────────────────────────────── */
  console.log("\n2. A real seat with no hold at all");
  const noHold = await attempt(alice.id, [seatNoHold]);
  check(
    "fails HOLDS_INVALID, not a crash",
    !noHold.ok && noHold.failure.code === "HOLDS_INVALID",
  );

  /* ── 3. someone else's live hold ─────────────────────────────────────── */
  console.log("\n3. Bob holds a seat; Alice tries to check out with it");
  touchedSeats.push(seatX);
  await createHold({ userId: bob.id, seatIds: [seatX] });
  const stolen = await attempt(alice.id, [seatX]);
  check(
    "fails HOLDS_INVALID naming that seat",
    !stolen.ok &&
      stolen.failure.code === "HOLDS_INVALID" &&
      stolen.failure.seatIds.includes(seatX),
  );

  /* ── 4. an expired-but-unreleased hold - lazy expiry respected HERE too ─ */
  console.log("\n4. Alice's own hold expires before she checks out");
  touchedSeats.push(seatY);
  await createHold({ userId: alice.id, seatIds: [seatY] });
  await db
    .update(holds)
    .set({ expiresAt: sql`now() - interval '1 minute'` })
    .where(eq(holds.seatId, seatY));
  const expired = await attempt(alice.id, [seatY]);
  check(
    "fails HOLDS_INVALID - an expired hold does not count, even hers",
    !expired.ok && expired.failure.code === "HOLDS_INVALID",
  );

  /* ── 5. seats spanning two events ────────────────────────────────────── */
  if (otherSeat) {
    console.log("\n5. Seats from two different events in one checkout");
    const mixed = await attempt(alice.id, [seatA, otherSeat.id]);
    check("fails MIXED_EVENTS", !mixed.ok && mixed.failure.code === "MIXED_EVENTS");
  } else {
    console.log("\n5. (skipped - second event has no seats)");
  }

  /* ── 6. the happy path, checked against the real Stripe test API ────── */
  console.log("\n6. Alice holds two seats and actually checks out");
  touchedSeats.push(seatA, seatB);
  await createHold({ userId: alice.id, seatIds: [seatA, seatB].sort() });

  const expectedTotal = await priceForSeats([seatA, seatB]);
  const pending = await createPendingOrder({ userId: alice.id, seatIds: [seatA, seatB].sort() });
  createdOrders.push(pending.orderId);

  check(
    "total is computed from sections, not any client value",
    pending.totalCents === expectedTotal,
    `${pending.totalCents} vs expected ${expectedTotal}`,
  );

  const minExpiry = Date.now() + 29 * 60_000; // Defect 2: must clear Stripe's 30-min floor
  check(
    "the hold's expiry was extended past Stripe's 30-minute floor",
    pending.expiresAt.getTime() > minExpiry,
    pending.expiresAt.toISOString(),
  );

  const holdRows = await db
    .select({ expiresAt: holds.expiresAt })
    .from(holds)
    .where(and(inArray(holds.seatId, [seatA, seatB]), sql`${holds.releasedAt} is null`));
  check(
    "Postgres actually has the extended expiry, not just the return value",
    holdRows.every((r) => r.expiresAt.getTime() === pending.expiresAt.getTime()),
  );

  const [orderRow] = await db.select().from(orders).where(eq(orders.id, pending.orderId));
  check("orders row exists with status 'pending'", orderRow?.status === "pending");
  check("orders row total matches", orderRow?.totalCents === expectedTotal);
  check("orders row has no stripeSessionId yet", orderRow?.stripeSessionId === null);

  const itemsBefore = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(inArray(orderItems.seatId, [seatA, seatB]));
  check(
    "DEFECT 1 — no order_items were created by a pending order",
    itemsBefore.length === 0,
    `${itemsBefore.length} rows — a pending checkout would have bricked this seat`,
  );

  console.log("\n7. The real Stripe test API (buildCheckoutSession, not a re-implementation)");
  const session = await buildCheckoutSession(pending, alice.email);

  check("a real Stripe session id came back", session.id.startsWith("cs_"), session.id);
  check(
    "the url points at Stripe's hosted checkout",
    (session.url ?? "").startsWith("https://checkout.stripe.com/"),
    session.url ?? "null",
  );
  check(
    "DEFECT 2 — Stripe's own expires_at equals the extended hold's, to the second",
    session.expires_at === Math.floor(pending.expiresAt.getTime() / 1000),
    `stripe=${session.expires_at} hold=${Math.floor(pending.expiresAt.getTime() / 1000)}`,
  );
  check(
    "metadata carries the real orderId and seatIds for the future webhook",
    session.metadata?.orderId === pending.orderId &&
      session.metadata?.seatIds === [seatA, seatB].sort().join(","),
  );
  check(
    "Stripe's own computed total (paise) matches the server total",
    session.amount_total === expectedTotal,
    `stripe=${session.amount_total} server=${expectedTotal}`,
  );

  await attachStripeSession(pending.orderId, session.id);
  const [attached] = await db.select().from(orders).where(eq(orders.id, pending.orderId));
  check("attachStripeSession recorded the real session id", attached?.stripeSessionId === session.id);

  /* ── 8. repeating checkout against the SAME still-held seats ────────── */
  console.log("\n8. Alice hits checkout again for the same seats (e.g. a double-click)");
  const second = await createPendingOrder({ userId: alice.id, seatIds: [seatA, seatB].sort() });
  createdOrders.push(second.orderId);
  check("a second pending order is created without throwing", Boolean(second.orderId));

  const itemsAfter = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(inArray(orderItems.seatId, [seatA, seatB]));
  check(
    "DEFECT 1 again — still zero order_items, no one_sold_seat collision",
    itemsAfter.length === 0,
  );

  /* ── 9. rate limit, same technique as T23's ratelimit-test.ts ────────── */
  console.log(`\n9. Rate limit on /api/checkout (${isRedisConfigured ? "redis" : "in-memory"})`);
  const base = process.env.RUSH_BASE_URL ?? "http://localhost:3000";
  const attempts = CHECKOUT_RATE_LIMIT + 3;
  const xff = "203.0.113.77"; // one caller, below the limiter's auth check

  let sawRateLimited = false;
  let firstRateLimitedAt = -1;
  for (let i = 0; i < attempts; i++) {
    const response = await fetch(`${base}/api/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": xff },
      body: JSON.stringify({ seatIds: ["00000000-0000-4000-8000-000000000000"] }),
    });
    if (response.status === 429) {
      if (!sawRateLimited) firstRateLimitedAt = i + 1;
      sawRateLimited = true;
      check(
        `request ${i + 1} carries Retry-After`,
        response.headers.get("Retry-After") !== null,
      );
    }
  }
  check(
    `the limiter trips at or before request ${CHECKOUT_RATE_LIMIT + 1}`,
    sawRateLimited && firstRateLimitedAt <= CHECKOUT_RATE_LIMIT + 1,
    sawRateLimited ? `first 429 at request ${firstRateLimitedAt}` : "never saw a 429",
  );
}

async function cleanup() {
  if (createdOrders.length) {
    await db.delete(orderItems).where(inArray(orderItems.seatId, touchedSeats));
    await db.delete(orders).where(inArray(orders.id, createdOrders));
  }
  if (touchedSeats.length) {
    await db.delete(holds).where(inArray(holds.seatId, touchedSeats));
    await db
      .update(seats)
      .set({ status: "available" })
      .where(inArray(seats.id, touchedSeats));
  }
  console.log(
    `\n  cleanup: ${createdOrders.length} order(s) and ${touchedSeats.length} seat(s) restored.`,
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
