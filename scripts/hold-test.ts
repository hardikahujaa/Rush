/**
 * T20 verification — exercises the REAL createHold transaction.
 *
 * Not a re-implementation. This imports the same function the route handler
 * calls, so what passes here is what ships. `server-only` resolves to an empty
 * module under the react-server condition, which is why the run command carries
 * it:
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/hold-test.ts
 *
 * SAFE ON REAL DATA. Every row this creates is recorded and removed in the
 * finally block, and seat statuses are snapshotted before they are touched and
 * restored afterwards. Re-run scripts/check-seed.mjs after it to confirm.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../src/db";
import { events, holds, seats, users } from "../src/db/schema";
import { seatIsAvailable } from "../src/db/queries/availability";
import { createHold, HoldError } from "../src/db/queries/holds";

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

/** Runs createHold and reports the failure code instead of throwing. */
async function attempt(userId: string, seatIds: string[]) {
  try {
    const result = await createHold({ userId, seatIds: [...seatIds].sort() });
    return { ok: true as const, result };
  } catch (error) {
    if (error instanceof HoldError) {
      return { ok: false as const, code: error.failure.code, failure: error.failure };
    }
    console.error("    RAW ERROR:", (error as Error)?.message ?? error);
    return { ok: false as const, code: "THREW", failure: error };
  }
}

const createdHoldIds = new Set<string>();
const touchedSeats = new Map<string, "available" | "held" | "sold">();

async function main() {
  /* ── setup ────────────────────────────────────────────────────────────── */
  const [event] = await db
    .select({ id: events.id, title: events.title })
    .from(events)
    .where(eq(events.status, "live"))
    .limit(1);

  if (!event) throw new Error("No live event seeded — run npm run db:seed");

  /* Ten distinct buyers. Distinctness matters more than it looks: a "race"
     fired from one account is not a race at all, because the second request
     hits the idempotent-replay path and correctly succeeds against the hold the
     first one just made. Only different users actually contend. */
  const buyers = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, "buyer"))
    .limit(10);

  if (buyers.length < 10) throw new Error("Need ten buyer accounts");
  const [alice, bob, carol, dave, ...racers] = buyers;

  /* Genuinely free seats, by the source of truth rather than the status cache. */
  const free = await db.execute<{ id: string; status: "available" | "held" | "sold" }>(sql`
    select st.id, st.status
    from ${seats} st
    where st.event_id = ${event.id} and ${seatIsAvailable(sql`st.id`)}
    order by st.id
    limit 14
  `);

  if (free.length < 14) throw new Error(`Only ${free.length} free seats — need 14`);
  for (const row of free) touchedSeats.set(row.id, row.status);

  const A = free.slice(0, 4).map((r) => r.id);   // Alice's four
  const B = free.slice(4, 5).map((r) => r.id);   // one more, to breach her cap
  const C = free.slice(5, 6).map((r) => r.id);   // the contended seat
  const E = free.slice(10, 11).map((r) => r.id); // same-user concurrent replay
  const D = free.slice(6, 10).map((r) => r.id);  // the expiry case

  console.log(`\nEvent: ${event.title}`);
  console.log(`Buyers: ${alice.email} / ${bob.email}\n`);

  /* ── 1. happy path ────────────────────────────────────────────────────── */
  console.log("1. Happy path");
  const first = await attempt(alice.id, A);
  check("4 seats held", first.ok && first.result.seats.length === 4,
    first.ok ? "" : first.code);

  if (first.ok) {
    for (const s of first.result.seats) createdHoldIds.add(s.holdId);

    const minutes = (first.result.expiresAt.getTime() - Date.now()) / 60000;
    check("expires in ~10 minutes", minutes > 9 && minutes <= 10.5,
      `got ${minutes.toFixed(2)}m`);
    check("total is the sum of section prices",
      first.result.totalCents ===
        first.result.seats.reduce((n, s) => n + s.priceCents, 0));
    check("not flagged as a replay", first.result.replayed === false);

    const cached = await db
      .select({ status: seats.status })
      .from(seats)
      .where(inArray(seats.id, A));
    check("seats.status cache updated to held",
      cached.every((r) => r.status === "held"));
  }

  /* ── 2. idempotent replay ─────────────────────────────────────────────── */
  console.log("\n2. Same user retries the identical request");
  const replay = await attempt(alice.id, A);
  check("returns success, not a conflict", replay.ok, replay.ok ? "" : replay.code);
  check("flagged as a replay", replay.ok && replay.result.replayed === true);

  const holdRows = await db
    .select({ id: holds.id })
    .from(holds)
    .where(and(inArray(holds.seatId, A), sql`${holds.releasedAt} is null`));
  check("no duplicate hold rows created", holdRows.length === 4,
    `${holdRows.length} live holds for 4 seats`);

  /* ── 3. a different user cannot take them ─────────────────────────────── */
  console.log("\n3. A different user requests the same seats");
  const stolen = await attempt(bob.id, A);
  check("rejected as unavailable",
    !stolen.ok && stolen.code === "SEATS_UNAVAILABLE",
    stolen.ok ? "IT SUCCEEDED — DOUBLE BOOKING" : stolen.code);

  /* ── 4. per-user purchase limit ───────────────────────────────────────── */
  console.log("\n4. Alice tries a 5th seat in a second request");
  const overCap = await attempt(alice.id, B);
  check("rejected as over the limit",
    !overCap.ok && overCap.code === "SEAT_LIMIT_EXCEEDED",
    overCap.ok ? "IT SUCCEEDED — the cap is per-request only" : overCap.code);

  /* ── 5. EXPIRED HOLD MUST BE REUSABLE ─────────────────────────────────── */
  console.log("\n5. An expired hold is released and the seat resells");
  console.log("   (this is the test that fails if expired holds are not released)");
  /* Carol, not Alice - Alice is deliberately at her 4-seat cap from test 1, and
     reusing her here would fail for that reason and hide what is being tested. */
  const held = await attempt(carol.id, D);
  check("Carol holds four seats", held.ok, held.ok ? "" : held.code);

  if (held.ok) {
    for (const s of held.result.seats) createdHoldIds.add(s.holdId);

    // Age the hold past its expiry, exactly as ten real minutes would.
    await db
      .update(holds)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(and(inArray(holds.seatId, D), sql`${holds.releasedAt} is null`));

    const afterExpiry = await attempt(dave.id, D);
    check("Dave can now hold the expired seats", afterExpiry.ok,
      afterExpiry.ok
        ? ""
        : `${afterExpiry.code} — the seat is now permanently unsellable`);

    if (afterExpiry.ok) {
      for (const s of afterExpiry.result.seats) createdHoldIds.add(s.holdId);
      const live = await db
        .select({ id: holds.id })
        .from(holds)
        .where(and(inArray(holds.seatId, D), sql`${holds.releasedAt} is null`));
      check("exactly one live hold per seat afterwards", live.length === 4,
        `${live.length} live holds across 4 seats`);
    }
  }

  /* ── 6. concurrency smoke test ────────────────────────────────────────── */
  console.log(`\n${racers.length} simultaneous requests for ONE seat, from ${racers.length} DIFFERENT users`);
  console.log("   (T21 does the full proof through HTTP; this checks the lock itself)");
  const outcomes = await Promise.all(racers.map((u) => attempt(u.id, C)));
  const winners = outcomes.filter((r) => r.ok);
  for (const w of winners) {
    if (w.ok) for (const s of w.result.seats) createdHoldIds.add(s.holdId);
  }
  check("exactly one request won", winners.length === 1,
    `${winners.length} winners — ${winners.length > 1 ? "DOUBLE BOOKING" : "nobody won"}`);
  check("every loser was told the seat was taken",
    outcomes.filter((r) => !r.ok && r.code === "SEATS_UNAVAILABLE").length ===
      racers.length - 1,
    outcomes.map((r) => (r.ok ? "WON" : r.code)).join(","));

  const liveOnC = await db
    .select({ id: holds.id })
    .from(holds)
    .where(and(inArray(holds.seatId, C), sql`${holds.releasedAt} is null`));
  check("one live hold row exists for the contested seat", liveOnC.length === 1,
    `${liveOnC.length} rows`);

  /* ── 6b. the same user racing themselves ──────────────────────────────── */
  console.log("\n6b. Five simultaneous requests for one seat from the SAME user");
  console.log("    (a retry storm, not contention — all should succeed on one hold)");
  const selfRace = await Promise.all(
    Array.from({ length: 5 }, () => attempt(bob.id, E)),
  );
  for (const r of selfRace) {
    if (r.ok) for (const s2 of r.result.seats) createdHoldIds.add(s2.holdId);
  }
  check("all five succeeded", selfRace.every((r) => r.ok),
    selfRace.map((r) => (r.ok ? "ok" : r.code)).join(","));

  const liveOnE = await db
    .select({ id: holds.id })
    .from(holds)
    .where(and(inArray(holds.seatId, E), sql`${holds.releasedAt} is null`));
  check("but only ONE hold row was created", liveOnE.length === 1,
    `${liveOnE.length} rows — the unique index should permit exactly one`);

  /* ── 7. input guards ──────────────────────────────────────────────────── */
  console.log("\n7. Input guards");
  const ghost = await attempt(alice.id, ["00000000-0000-4000-8000-000000000000"]);
  check("unknown seat id rejected",
    !ghost.ok && ghost.code === "SEATS_NOT_FOUND", ghost.ok ? "accepted" : ghost.code);

  const otherEvent = await db.execute<{ id: string }>(sql`
    select st.id from ${seats} st
    join ${events} e on e.id = st.event_id
    where e.status <> 'live' limit 1
  `);
  if (otherEvent.length) {
    const notLive = await attempt(alice.id, [otherEvent[0].id]);
    check("event that is not on sale rejected",
      !notLive.ok && notLive.code === "EVENT_NOT_ON_SALE",
      notLive.ok ? "accepted" : notLive.code);
  }
}

/* ── teardown ───────────────────────────────────────────────────────────── */
async function cleanup() {
  if (createdHoldIds.size > 0) {
    await db.delete(holds).where(inArray(holds.id, [...createdHoldIds]));
  }
  for (const [seatId, status] of touchedSeats) {
    await db.update(seats).set({ status }).where(eq(seats.id, seatId));
  }
  console.log(
    `\nCleaned up ${createdHoldIds.size} holds, restored ${touchedSeats.size} seats.`,
  );
}

main()
  .catch((error) => {
    failed++;
    console.error("\nUNCAUGHT:", error);
  })
  .finally(async () => {
    await cleanup();
    console.log("─".repeat(64));
    console.log(failed === 0 ? `PASS — ${passed} checks` : `${failed} FAILED of ${passed + failed}`);
    process.exit(failed === 0 ? 0 : 1);
  });
