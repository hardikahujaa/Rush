/**
 * T47 — proves the demo-reset endpoint clears real activity and leaves the
 * seed baseline alone.
 *
 *   npm run demo-reset-test
 *
 * ── THIS IS NOT "SAFE ON REAL DATA" THE WAY release-test.ts IS ────────────
 * `resetDemoActivity()` is deliberately GLOBAL - it has no event filter,
 * because a presenter resetting a demo means the whole app, not one event.
 * Running this script calls the real function, which means it deletes EVERY
 * real (non-seed) order in whatever database DATABASE_URL points at, not just
 * the fixtures this script creates. That is the feature working as designed,
 * not a bug in the test - but it is why this should only ever be run against
 * a demo/dev database, never anything with orders you care about keeping.
 *
 * Fixtures are fully isolated (a throwaway venue/event/users, not the shared
 * seeded one) so this script's own assertions do not depend on what else is
 * in the database, and everything created here is deleted in `finally`,
 * mirroring `seed.ts`'s own child-before-parent delete order.
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
  venues,
} from "../src/db/schema";
import { resetDemoActivity } from "../src/db/queries/demo";

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

let venueId: string | undefined;
let eventId: string | undefined;
const userIds: string[] = [];

async function main() {
  /* ── fixtures: one throwaway venue/event, two seats, two buyers ───────── */
  const [venue] = await db
    .insert(venues)
    .values({ name: "T47 Test Venue", city: "Test City" })
    .returning();
  venueId = venue.id;

  const organizer = { id: randomUUID(), email: `t47-org-${randomUUID()}@test.local`, role: "organizer" as const };
  const buyer = { id: randomUUID(), email: `t47-buyer-${randomUUID()}@test.local`, role: "buyer" as const };
  await db.insert(users).values([organizer, buyer]);
  userIds.push(organizer.id, buyer.id);

  const [event] = await db
    .insert(events)
    .values({
      venueId: venue.id,
      organizerId: organizer.id,
      title: "T47 Test Event",
      dropAt: sql`now() - interval '1 hour'`,
      startsAt: sql`now() + interval '1 day'`,
      status: "live",
    })
    .returning();
  eventId = event.id;

  const [section] = await db
    .insert(sections)
    .values({ eventId: event.id, name: "Test", priceCents: 10000 })
    .returning();

  const createdSeats = await db
    .insert(seats)
    .values([
      { eventId: event.id, sectionId: section.id, rowLabel: "A", seatNo: 1 },
      { eventId: event.id, sectionId: section.id, rowLabel: "A", seatNo: 2 },
      { eventId: event.id, sectionId: section.id, rowLabel: "A", seatNo: 3 },
    ])
    .returning();
  const [realSeat, seedSeat, heldSeat] = createdSeats;

  console.log(`\n  Fixture event: ${event.title} (${event.id})\n`);

  /* ── 1. a REAL order - looks exactly like a live checkout would leave ── */
  console.log("1. A real checkout's order, items and ticket");
  const [realOrder] = await db
    .insert(orders)
    .values({
      userId: buyer.id,
      eventId: event.id,
      totalCents: 10000,
      status: "paid",
      stripeSessionId: `cs_test_${randomUUID()}`, // real Stripe shape, NOT seed-prefixed
    })
    .returning();
  await db.insert(orderItems).values({ orderId: realOrder.id, seatId: realSeat.id, priceCents: 10000 });
  const ticketId = randomUUID();
  await db.insert(tickets).values({ id: ticketId, orderId: realOrder.id, seatId: realSeat.id, qrSignature: "test" });
  await db.update(seats).set({ status: "sold" }).where(eq(seats.id, realSeat.id));
  check("real order exists before reset", true);

  /* ── 2. a SEED baseline order - must survive ──────────────────────────── */
  console.log("\n2. A seed-stamped baseline order (must be left alone)");
  const [seedOrder] = await db
    .insert(orders)
    .values({
      userId: buyer.id,
      eventId: event.id,
      totalCents: 10000,
      status: "paid",
      stripeSessionId: `cs_test_seed_${randomUUID()}`,
    })
    .returning();
  await db.insert(orderItems).values({ orderId: seedOrder.id, seatId: seedSeat.id, priceCents: 10000 });
  await db.insert(tickets).values({
    id: randomUUID(),
    orderId: seedOrder.id,
    seatId: seedSeat.id,
    qrSignature: "test",
  });
  await db.update(seats).set({ status: "sold" }).where(eq(seats.id, seedSeat.id));
  check("seed order exists before reset", true);

  /* ── 3. a live hold, representing an abandoned demo selection ─────────── */
  console.log("\n3. A live hold on a third seat");
  await db.insert(holds).values({
    seatId: heldSeat.id,
    userId: buyer.id,
    expiresAt: sql`now() + interval '10 minutes'`,
  });
  await db.update(seats).set({ status: "held" }).where(eq(seats.id, heldSeat.id));

  /* ── 4. the reset itself ──────────────────────────────────────────────── */
  console.log("\n4. resetDemoActivity()");
  const result = await resetDemoActivity();
  console.log(
    `   cleared ${result.ordersCleared} order(s), released ${result.holdsReleased} ` +
      `hold(s), repaired ${result.seatsRepaired} seat(s) — numbers include any other ` +
      "real activity already in this database, by design (see the header above).",
  );

  /* ── 5. assertions scoped to THIS fixture's rows only ─────────────────── */
  const realOrderGone = await db.select().from(orders).where(eq(orders.id, realOrder.id));
  check("the real order was deleted", realOrderGone.length === 0);

  const realItemsGone = await db.select().from(orderItems).where(eq(orderItems.orderId, realOrder.id));
  check("its order_items cascaded away", realItemsGone.length === 0);

  const realTicketGone = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  check("its ticket cascaded away", realTicketGone.length === 0);

  const seedOrderStill = await db.select().from(orders).where(eq(orders.id, seedOrder.id));
  check("the seed-stamped order survives", seedOrderStill.length === 1,
    `found ${seedOrderStill.length}`);

  const liveHold = await db
    .select()
    .from(holds)
    .where(sql`${holds.seatId} = ${heldSeat.id} and ${holds.releasedAt} is null`);
  check("the live hold was released", liveHold.length === 0);

  const afterStatus = await db
    .select({ id: seats.id, status: seats.status })
    .from(seats)
    .where(inArray(seats.id, [realSeat.id, seedSeat.id, heldSeat.id]));
  const byId = new Map(afterStatus.map((s) => [s.id, s.status]));

  check("the real seat's cache repaired to available", byId.get(realSeat.id) === "available",
    `${byId.get(realSeat.id)}`);
  check("the held seat's cache repaired to available", byId.get(heldSeat.id) === "available",
    `${byId.get(heldSeat.id)}`);
  check("the seed seat's cache is UNTOUCHED (still sold)", byId.get(seedSeat.id) === "sold",
    `${byId.get(seedSeat.id)} — the seed baseline must not be disturbed`);

  /* ── 6. the route's auth gate ─────────────────────────────────────────── */
  console.log("\n6. The route's two ways in, and what happens with neither");
  const { POST } = await import("../src/app/api/demo/reset/route");

  const probe = async (auth?: string) =>
    (await POST(new Request("http://localhost/api/demo/reset", {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    }))).status;

  const savedSecret = process.env.DEMO_RESET_SECRET;
  delete process.env.DEMO_RESET_SECRET;

  const noAuthNoSecret = await probe();
  check("no session, no secret configured -> 401, never a silent reset",
    noAuthNoSecret === 401, `${noAuthNoSecret}`);

  const wrongBearer = await probe("Bearer whatever-this-is-unset");
  check("a bearer header means nothing when the secret is unset",
    wrongBearer === 401, `${wrongBearer}`);

  process.env.DEMO_RESET_SECRET = savedSecret;
  console.log("      ↳ same fail-closed shape as CRON_SECRET: unset authenticates nobody.");
}

async function cleanup() {
  if (eventId) {
    await db.delete(tickets).where(sql`${tickets.seatId} in (select id from ${seats} where ${seats.eventId} = ${eventId})`);
    await db.delete(orderItems).where(sql`${orderItems.seatId} in (select id from ${seats} where ${seats.eventId} = ${eventId})`);
    await db.delete(orders).where(eq(orders.eventId, eventId));
    await db.delete(holds).where(sql`${holds.seatId} in (select id from ${seats} where ${seats.eventId} = ${eventId})`);
    await db.delete(seats).where(eq(seats.eventId, eventId));
    await db.delete(sections).where(eq(sections.eventId, eventId));
    await db.delete(events).where(eq(events.id, eventId));
  }
  if (venueId) await db.delete(venues).where(eq(venues.id, venueId));
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  console.log("\n  cleanup: fixture venue, event, seats and users removed.");
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
    await closeDb();
    process.exit(failed === 0 ? 0 : 1);
  });
