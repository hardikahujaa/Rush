/**
 * T22 — proves the READ path honours expiry, with no cron job.
 *
 *   npm run expiry-test
 *
 * `hold-test.ts` proves the WRITE path releases an expired hold when someone
 * asks for the seat again. That is a different claim. This one asks: with
 * nobody asking, no cleanup task, and no write of any kind, does an expired
 * hold stop hiding its seat?
 *
 * ── THE ASSERTION THAT MATTERS ────────────────────────────────────────────
 * After the hold expires, `seats.status` still reads 'held' - nothing has
 * rewritten it, and nothing will. The seat map nevertheless reports the seat as
 * available. That single pair of facts IS lazy expiry: the cache says taken,
 * the source of truth says free, and every query believes the source of truth.
 *
 * SAFE ON REAL DATA. One hold is created and deleted, one seat's status is
 * snapshotted and restored, and the cleanup runs in a finally block.
 */
import { eq, sql } from "drizzle-orm";

import { db } from "../src/db";
import { holds, seats, users } from "../src/db/schema";
import { seatIsAvailable } from "../src/db/queries/availability";
import { createHold } from "../src/db/queries/holds";
import { getSeatMapForEvent } from "../src/db/queries/seats";
import { getEventById } from "../src/db/queries/events";

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

/** What every surface currently says about one seat. */
async function readAll(eventId: string, seatId: string) {
  const map = await getSeatMapForEvent(eventId);
  const detail = await getEventById(eventId);
  if (!map || !detail) throw new Error("event vanished mid-test");

  const seat = map.seats.find((s) => s.id === seatId);
  if (!seat) throw new Error("target seat missing from the map");

  const totals = map.tiers.reduce(
    (acc, t) => ({
      total: acc.total + t.stats.total,
      available: acc.available + t.stats.available,
      held: acc.held + t.stats.held,
      sold: acc.sold + t.stats.sold,
    }),
    { total: 0, available: 0, held: 0, sold: 0 },
  );

  const [cache] = await db
    .select({ status: seats.status })
    .from(seats)
    .where(eq(seats.id, seatId));

  return {
    mapStatus: seat.status,
    totals,
    detailSeatsLeft: detail.sections.reduce((n, s) => n + s.seatsLeft, 0),
    /** The render cache. Watched, never trusted. */
    cacheStatus: cache.status,
    tierOfSeat: map.tiers.find((t) => t.id === seat.tierId)!,
  };
}

let targetSeatId: string | null = null;
let originalStatus: "available" | "held" | "sold" = "available";
let createdHoldIds: string[] = [];

async function main() {
  /* ── setup ──────────────────────────────────────────────────────────── */
  const target = await db.execute<{ id: string; event_id: string; status: "available" | "held" | "sold" }>(sql`
    select st.id, st.event_id, st.status
    from ${seats} st
    join events e on e.id = st.event_id
    where e.status = 'live' and ${seatIsAvailable(sql`st.id`)}
    order by st.id
    limit 1
  `);
  if (target.length === 0) throw new Error("no free seat on a live event");

  targetSeatId = target[0].id;
  originalStatus = target[0].status;
  const eventId = target[0].event_id;

  const [buyer] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, "buyer"))
    .limit(1);

  console.log(`\n  Seat  ${targetSeatId}`);
  console.log(`  Buyer ${buyer.email}\n`);

  /* ── 1. baseline ────────────────────────────────────────────────────── */
  console.log("1. Before any hold");
  const before = await readAll(eventId, targetSeatId);
  check("seat map reports it available", before.mapStatus === "available", before.mapStatus);
  check("counts sum to the seat total",
    before.totals.available + before.totals.held + before.totals.sold === before.totals.total,
    `${before.totals.available}+${before.totals.held}+${before.totals.sold} vs ${before.totals.total}`);

  /* ── 2. hold it ─────────────────────────────────────────────────────── */
  console.log("\n2. After a real hold");
  const result = await createHold({ userId: buyer.id, seatIds: [targetSeatId] });
  createdHoldIds = result.seats.map((s) => s.holdId);

  const during = await readAll(eventId, targetSeatId);
  check("seat map reports it held", during.mapStatus === "held", during.mapStatus);
  check("available count dropped by exactly 1",
    during.totals.available === before.totals.available - 1,
    `${before.totals.available} -> ${during.totals.available}`);
  check("held count rose by exactly 1",
    during.totals.held === before.totals.held + 1,
    `${before.totals.held} -> ${during.totals.held}`);
  check("event detail page agrees",
    during.detailSeatsLeft === before.detailSeatsLeft - 1,
    `${before.detailSeatsLeft} -> ${during.detailSeatsLeft}`);
  check("counts still sum to the seat total",
    during.totals.available + during.totals.held + during.totals.sold === during.totals.total);

  /* ── 3. let it expire — the ONLY write ──────────────────────────────── */
  console.log("\n3. The hold expires (expires_at moved into the past)");
  console.log("   No release, no cleanup, no cron. Nothing else is written.");
  await db
    .update(holds)
    .set({ expiresAt: sql`now() - interval '1 minute'` })
    .where(eq(holds.seatId, targetSeatId));

  const after = await readAll(eventId, targetSeatId);

  check("seat map reports it AVAILABLE again", after.mapStatus === "available", after.mapStatus);
  check("available count restored",
    after.totals.available === before.totals.available,
    `${after.totals.available} vs ${before.totals.available}`);
  check("held count restored",
    after.totals.held === before.totals.held,
    `${after.totals.held} vs ${before.totals.held}`);
  check("event detail page restored",
    after.detailSeatsLeft === before.detailSeatsLeft,
    `${after.detailSeatsLeft} vs ${before.detailSeatsLeft}`);
  check("counts still sum to the seat total",
    after.totals.available + after.totals.held + after.totals.sold === after.totals.total);
  check("the tier legend agrees with the whole-venue count",
    after.tierOfSeat.stats.available === during.tierOfSeat.stats.available + 1,
    `tier ${after.tierOfSeat.name}: ${during.tierOfSeat.stats.available} -> ${after.tierOfSeat.stats.available}`);

  /* ── 4. THE PROOF THAT IT IS LAZY ───────────────────────────────────── */
  console.log("\n4. Why this is lazy expiry and not cleanup");
  const surviving = await db
    .select({ id: holds.id, releasedAt: holds.releasedAt })
    .from(holds)
    .where(eq(holds.seatId, targetSeatId));

  check("the hold row still exists", surviving.length === 1,
    `${surviving.length} rows`);
  check("and is still UNRELEASED (released_at is null)",
    surviving[0]?.releasedAt === null,
    `released_at = ${surviving[0]?.releasedAt}`);
  check("seats.status STILL reads 'held' — the cache was never rewritten",
    after.cacheStatus === "held", after.cacheStatus);
  console.log("      ↳ cache says 'held', source of truth says available,");
  console.log("        and every query believes the source of truth.");

  /* ── 5. and it is genuinely buyable ─────────────────────────────────── */
  console.log("\n5. The freed seat can actually be bought");
  const [other] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "buyer"))
    .limit(2)
    .offset(1);

  const retake = await createHold({ userId: other.id, seatIds: [targetSeatId] });
  createdHoldIds = [...createdHoldIds, ...retake.seats.map((s) => s.holdId)];
  check("a different user holds it successfully", retake.seats.length === 1);

  const live = await db.execute<{ count: number }>(sql`
    select count(*)::int as count from ${holds}
    where seat_id = ${targetSeatId} and released_at is null and expires_at > now()
  `);
  check("exactly one live hold on the seat", Number(live[0].count) === 1,
    `${live[0].count} live holds`);
}

async function cleanup() {
  if (targetSeatId) {
    await db.delete(holds).where(eq(holds.seatId, targetSeatId));
    await db.update(seats).set({ status: originalStatus }).where(eq(seats.id, targetSeatId));
  }
  console.log(
    `\n  cleanup: ${createdHoldIds.length} holds removed, seat restored to '${originalStatus}'.`,
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
    console.log(
      failed === 0
        ? `PASS — ${passed} checks. Expiry is decided at read time, by the query.`
        : `${failed} FAILED of ${passed + failed}`,
    );
    process.exit(failed === 0 ? 0 : 1);
  });
