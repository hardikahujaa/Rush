/**
 * T21 — 50-user concurrency stress test.
 *
 *   npm run race-test
 *
 * Fires fifty simultaneous hold attempts, from fifty distinct users, at ONE seat.
 * Exactly one may win. This is the proof RUSH exists to produce.
 *
 * ── IT CALLS THE REAL TRANSACTION ─────────────────────────────────────────
 * `createHold` is imported from src/db/queries/holds.ts — the same function the
 * route handler calls. Nothing is re-implemented here, so a pass means the
 * shipped code is safe, not that a copy of it is.
 *
 * ── IT CAN FAIL ───────────────────────────────────────────────────────────
 * Every count is asserted and the process exits non-zero when any of them is
 * wrong. The verification line is printed only when the database itself has
 * confirmed a single live hold. A stress test that cannot go red is a
 * screenshot of nothing.
 *
 * ── WHY FIFTY USERS ARE CREATED RATHER THAN INVENTED ──────────────────────
 * `holds.user_id` is a foreign key to public.users. Fifty fabricated uuids would
 * every one of them fail with 23503, and the run would report 0 winners, 0
 * conflicts and 50 errors — indistinguishable, at a glance, from a broken lock.
 * So fifty real rows are inserted and removed again.
 *
 * SAFE ON REAL DATA. public.users has no foreign key to auth.users, and the
 * delete-sync trigger runs auth -> public only, so no authentication account is
 * touched. Everything created here is removed in the finally block.
 */
// Sizes the pool to 50. Must stay the FIRST import: it has to run before the
// db module is constructed, which is the only time DB_POOL_MAX is read.
import "./_race-pool";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../src/db";
import { events, holds, seats, users } from "../src/db/schema";
import { createHold, HoldError } from "../src/db/queries/holds";

const USER_COUNT = 50;
const TEST_EMAIL_DOMAIN = "@rush.test";

/* ── instrumentation ────────────────────────────────────────────────────── */

let inFlight = 0;
let peakInFlight = 0;

type Attempt =
  | { kind: "win"; userId: string; ms: number; startedAt: number }
  | { kind: "conflict"; ms: number; startedAt: number }
  | { kind: "other"; code: string; ms: number; startedAt: number }
  | { kind: "error"; message: string; ms: number; startedAt: number };

/**
 * One hold attempt, measured.
 *
 * The in-flight counter is what keeps the headline honest. Fifty promises
 * starting is not fifty transactions running: the pool, and Supabase's own
 * connection multiplexing, both sit in between. Tracking the peak means the
 * output reports what actually happened rather than what was requested.
 */
async function attempt(userId: string, seatId: string): Promise<Attempt> {
  const startedAt = performance.now();
  inFlight++;
  if (inFlight > peakInFlight) peakInFlight = inFlight;

  try {
    await createHold({ userId, seatIds: [seatId] });
    return { kind: "win", userId, ms: performance.now() - startedAt, startedAt };
  } catch (error) {
    const ms = performance.now() - startedAt;
    if (error instanceof HoldError) {
      return error.failure.code === "SEATS_UNAVAILABLE"
        ? { kind: "conflict", ms, startedAt }
        : { kind: "other", code: error.failure.code, ms, startedAt };
    }
    return {
      kind: "error",
      message: (error as Error)?.message ?? String(error),
      ms,
      startedAt,
    };
  } finally {
    inFlight--;
  }
}

/* ── output helpers ─────────────────────────────────────────────────────── */

const W = 62;
const line = (ch: string) => ch.repeat(W);
const pad = (label: string, value: string | number, width = 30) =>
  `  ${label.padEnd(width)} ${value}`;

const failures: string[] = [];
function assert(condition: boolean, description: string) {
  if (!condition) failures.push(description);
  return condition;
}

/* ── state to unwind ────────────────────────────────────────────────────── */

const createdUserIds: string[] = [];
let targetSeatId: string | null = null;
let originalSeatStatus: "available" | "held" | "sold" = "available";

async function main() {
  /* ── setup ──────────────────────────────────────────────────────────── */
  const [event] = await db
    .select({ id: events.id, title: events.title })
    .from(events)
    .where(eq(events.status, "live"))
    .limit(1);

  if (!event) throw new Error("No live event seeded — run npm run db:seed");

  /**
   * The target seat, chosen the way createHold decides — not by
   * `status = 'available'`.
   *
   * That column is a render cache and it lags: an expired hold leaves 'held'
   * behind, and a seat released by T20's transaction can still read 'held' for
   * a moment. Selecting from the cache risks handing this test a seat that is
   * genuinely taken, which would report zero winners and look like a failed
   * lock rather than a badly chosen seat.
   */
  const candidates = await db.execute<{
    id: string;
    status: "available" | "held" | "sold";
  }>(sql`
    select st.id, st.status
    from ${seats} st
    where st.event_id = ${event.id}
      and not exists (select 1 from order_items oi where oi.seat_id = st.id)
      and not exists (
        select 1 from ${holds} h
        where h.seat_id = st.id and h.released_at is null and h.expires_at > now()
      )
    order by st.id
    limit 1
  `);

  if (candidates.length === 0) throw new Error("No genuinely free seat to target");
  targetSeatId = candidates[0].id;
  originalSeatStatus = candidates[0].status;

  /* Any leftovers from an interrupted previous run. Idempotent setup beats a
     script that only works the first time. */
  await db.delete(users).where(sql`${users.email} like ${"%" + TEST_EMAIL_DOMAIN}`);

  const testUsers = Array.from({ length: USER_COUNT }, (_, i) => ({
    id: crypto.randomUUID(),
    email: `race-t21-${String(i).padStart(2, "0")}${TEST_EMAIL_DOMAIN}`,
    name: `Race Tester ${i}`,
    role: "buyer" as const,
  }));

  await db.insert(users).values(testUsers);
  createdUserIds.push(...testUsers.map((u) => u.id));

  /* ── fire ───────────────────────────────────────────────────────────── */
  console.log(`\n  Warming up ${USER_COUNT} distinct users against one seat…`);

  const wallStart = performance.now();
  /* Every promise is constructed before any of them is awaited. An `await`
     inside the loop would stagger the attempts and quietly turn a race into a
     queue. */
  const pending = testUsers.map((u) => attempt(u.id, targetSeatId!));
  const results = await Promise.all(pending);
  const wallMs = performance.now() - wallStart;

  /* ── classify ───────────────────────────────────────────────────────── */
  const winners = results.filter((r) => r.kind === "win");
  const conflicts = results.filter((r) => r.kind === "conflict");
  /* Deliberately separate. Folding an unexpected failure into "conflicts"
     is exactly how a real bug hides inside a green run. */
  const others = results.filter((r) => r.kind === "other");
  const errors = results.filter((r) => r.kind === "error");

  const starts = results.map((r) => r.startedAt);
  const fireSpreadMs = Math.max(...starts) - Math.min(...starts);
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length / 2)];
  const maxLatency = latencies[latencies.length - 1];

  /* ── the assertion that actually matters ────────────────────────────── */
  const liveHolds = await db.execute<{ count: number; owner: string | null }>(sql`
    select count(*)::int as count, min(h.user_id::text) as owner
    from ${holds} h
    where h.seat_id = ${targetSeatId}
      and h.released_at is null
      and h.expires_at > now()
  `);
  const liveHoldCount = Number(liveHolds[0]?.count ?? 0);

  assert(winners.length === 1, `expected exactly 1 winner, got ${winners.length}`);
  assert(conflicts.length === USER_COUNT - 1,
    `expected ${USER_COUNT - 1} conflicts, got ${conflicts.length}`);
  assert(errors.length === 0, `expected 0 unexpected errors, got ${errors.length}`);
  assert(others.length === 0,
    `expected 0 other failures, got ${others.length} (${others.map((o) => (o.kind === "other" ? o.code : "")).join(",")})`);
  assert(liveHoldCount === 1,
    `THE DATABASE DISAGREES: ${liveHoldCount} live holds on one seat`);
  if (winners.length === 1 && winners[0].kind === "win") {
    assert(liveHolds[0]?.owner === winners[0].userId,
      "the live hold belongs to someone other than the reported winner");
  }

  /* ── report ─────────────────────────────────────────────────────────── */
  const ok = failures.length === 0;

  console.log(`\n╔${line("═")}╗`);
  console.log(`║${"  [ RUSH CONCURRENCY ENGINE — T21 STRESS TEST ]".padEnd(W)}║`);
  console.log(`╚${line("═")}╝`);
  console.log(pad("Event:", event.title, 16));
  console.log(pad("Target Seat:", `${targetSeatId}  |  Concurrent Users: ${USER_COUNT}`, 16));
  console.log(`\n  ${line("─")}`);
  console.log(pad("✅ Successes (Winners) :", `${String(winners.length).padStart(3)}     (must be exactly 1)`, 24));
  console.log(pad("🛑 Conflicts (Losers)  :", `${String(conflicts.length).padStart(3)}     (must be exactly ${USER_COUNT - 1})`, 24));
  console.log(pad("⚠️  Server Errors       :", `${String(errors.length + others.length).padStart(3)}     (must be 0)`, 24));
  console.log(`  ${line("─")}`);

  console.log(pad("peak concurrent transactions", `${peakInFlight} of ${USER_COUNT}`));
  console.log(pad("all 50 fired within", `${fireSpreadMs.toFixed(1)} ms`));
  console.log(pad("total wall time", `${wallMs.toFixed(0)} ms`));
  console.log(pad("latency p50 / max", `${p50.toFixed(0)} ms / ${maxLatency.toFixed(0)} ms`));

  if (others.length > 0) {
    console.log(`\n  other failure codes: ${others.map((o) => (o.kind === "other" ? o.code : "")).join(", ")}`);
  }
  if (errors.length > 0) {
    for (const e of errors.slice(0, 3)) {
      if (e.kind === "error") console.log(`  error: ${e.message}`);
    }
  }

  console.log("");
  if (ok) {
    console.log(`  🔒 DB VERIFICATION: ${liveHoldCount} LIVE HOLD VERIFIED. ZERO OVERSELLS.`);
  } else {
    console.log(`  ❌ FAILED — the seat lock did not hold.`);
    for (const f of failures) console.log(`     • ${f}`);
  }
  console.log("");
}

/* ── teardown ───────────────────────────────────────────────────────────── */

async function cleanup() {
  if (targetSeatId) {
    await db.delete(holds).where(eq(holds.seatId, targetSeatId));
    await db
      .update(seats)
      .set({ status: originalSeatStatus })
      .where(eq(seats.id, targetSeatId));
  }
  if (createdUserIds.length > 0) {
    // holds.user_id cascades, but the holds are already gone by this point.
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }

  const leftover = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.email} like ${"%" + TEST_EMAIL_DOMAIN}`);

  const stillHeld = targetSeatId
    ? await db
        .select({ id: holds.id })
        .from(holds)
        .where(and(eq(holds.seatId, targetSeatId), sql`${holds.releasedAt} is null`))
    : [];

  console.log(
    `  cleanup: ${createdUserIds.length} users removed, seat restored to '${originalSeatStatus}'` +
      ` — ${leftover.length} test users and ${stillHeld.length} holds remain (both must be 0)`,
  );
  if (leftover.length > 0 || stillHeld.length > 0) failures.push("cleanup incomplete");
}

main()
  .catch((error) => {
    failures.push(`uncaught: ${(error as Error)?.message ?? error}`);
    console.error("\n  UNCAUGHT:", error);
  })
  .finally(async () => {
    await cleanup().catch((e) => {
      failures.push("cleanup threw");
      console.error("  cleanup failed:", e);
    });
    console.log("");
    process.exit(failures.length === 0 ? 0 : 1);
  });
