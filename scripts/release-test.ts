/**
 * T25 — proves voluntary release is safe, owned, and idempotent.
 *
 *   npm run release-test
 *
 * The directive for this task was "zero sabotage": a user may only release
 * their own holds. That rule lives in the UPDATE's WHERE clause rather than in
 * a JavaScript check, so the test that matters is the adversarial one - user B
 * naming user A's seats and changing nothing.
 *
 * SAFE ON REAL DATA. Every hold created here is removed and every seat status
 * restored in the finally block.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../src/db";
import { events, holds, seats, users } from "../src/db/schema";
import { seatIsAvailable } from "../src/db/queries/availability";
import { createHold, releaseExpiredHolds, releaseHolds } from "../src/db/queries/holds";

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

let touched: string[] = [];

/** Live (unreleased, unexpired) hold rows for these seats. */
async function liveHoldCount(seatIds: string[]) {
  const rows = await db
    .select({ id: holds.id })
    .from(holds)
    .where(
      and(
        inArray(holds.seatId, seatIds),
        sql`${holds.releasedAt} is null`,
        sql`${holds.expiresAt} > now()`,
      ),
    );
  return rows.length;
}

async function main() {
  const [event] = await db
    .select({ id: events.id, title: events.title })
    .from(events)
    .where(eq(events.status, "live"))
    .limit(1);
  if (!event) throw new Error("No live event seeded");

  const buyers = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, "buyer"))
    .limit(2);
  const [alice, bob] = buyers;

  const free = await db.execute<{ id: string }>(sql`
    select st.id from ${seats} st
    where st.event_id = ${event.id} and ${seatIsAvailable(sql`st.id`)}
    order by st.id limit 6
  `);
  if (free.length < 6) throw new Error("need six free seats");
  touched = free.map((r) => r.id);

  const A = touched.slice(0, 3);   // Alice's seats
  const B = touched.slice(3, 6);   // for the expiry-cleanup case

  console.log(`\n  Event: ${event.title}`);
  console.log(`  Alice: ${alice.email}   Bob: ${bob.email}\n`);

  /* ── 1. hold, then confirm the seats really are held ─────────────────── */
  console.log("1. Alice holds three seats");
  await createHold({ userId: alice.id, seatIds: [...A].sort() });
  check("three live holds exist", (await liveHoldCount(A)) === 3);

  const cached = await db
    .select({ status: seats.status })
    .from(seats)
    .where(inArray(seats.id, A));
  check("seats.status cache says held", cached.every((r) => r.status === "held"));

  /* ── 2. ZERO SABOTAGE ────────────────────────────────────────────────── */
  console.log("\n2. Bob tries to release Alice's seats");
  console.log("   (the whole point of putting user_id in the WHERE clause)");
  const sabotage = await releaseHolds({ userId: bob.id, seatIds: A });

  check("Bob releases nothing", sabotage.released.length === 0,
    `he released ${sabotage.released.length}`);
  check("Alice's holds are untouched", (await liveHoldCount(A)) === 3,
    "HER SEATS WERE TAKEN FROM HER");
  check("and no seat status was altered", sabotage.statusRepaired === 0);

  /* ── 3. the owner can ─────────────────────────────────────────────────── */
  console.log("\n3. Alice releases her own seats");
  const mine = await releaseHolds({ userId: alice.id, seatIds: A });
  check("all three released", mine.released.length === 3, `${mine.released.length}`);
  check("no live holds remain", (await liveHoldCount(A)) === 0);
  check("seats.status repaired to available", mine.statusRepaired === 3,
    `${mine.statusRepaired} repaired`);

  const after = await db
    .select({ status: seats.status })
    .from(seats)
    .where(inArray(seats.id, A));
  check("the cache actually reads 'available'",
    after.every((r) => r.status === "available"),
    after.map((r) => r.status).join(","));

  const bookable = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from ${seats} st
    where st.id in ${A} and ${seatIsAvailable(sql`st.id`)}
  `);
  check("and they are genuinely bookable again", Number(bookable[0].n) === 3);

  /* ── 4. idempotent ────────────────────────────────────────────────────── */
  console.log("\n4. Alice releases the same seats again");
  const again = await releaseHolds({ userId: alice.id, seatIds: A });
  check("returns zero rather than failing", again.released.length === 0);
  console.log("      ↳ a retry after a dropped connection must not look like an error.");

  /* ── 5. the cron's job ────────────────────────────────────────────────── */
  console.log("\n5. Cron cleanup on an expired hold");
  await createHold({ userId: bob.id, seatIds: [...B].sort() });
  await db
    .update(holds)
    .set({ expiresAt: sql`now() - interval '1 minute'` })
    .where(inArray(holds.seatId, B));

  /* Before cleanup: the row is expired-but-unreleased and the cache is stale,
     yet the seat is ALREADY available. That is T22, and it is why this job is
     cosmetic. */
  const beforeCron = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from ${seats} st
    where st.id in ${B} and ${seatIsAvailable(sql`st.id`)}
  `);
  check("expired seats are available BEFORE cleanup runs",
    Number(beforeCron[0].n) === 3,
    "availability wrongly depends on the cron job");

  const cron = await releaseExpiredHolds();
  check("cleanup marks the expired rows released", cron.released >= 3, `${cron.released}`);
  check("and repairs their stale status", cron.statusRepaired >= 3, `${cron.statusRepaired}`);

  const stillNull = await db
    .select({ id: holds.id })
    .from(holds)
    .where(and(inArray(holds.seatId, B), sql`${holds.releasedAt} is null`));
  check("no unreleased expired rows left behind", stillNull.length === 0,
    `${stillNull.length} remain`);

  /* ── 6. the cron route fails CLOSED with no secret ────────────────────── */
  console.log("\n6. Cron route when CRON_SECRET is not set");
  console.log("   (the hole in `Bearer ${process.env.CRON_SECRET}`)");

  /* The route captures the secret at module load, so it has to be unset BEFORE
     the import - hence a dynamic one. This is the case that cannot be tested
     over HTTP against a server that already has the variable. */
  const saved = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;

  const { GET } = await import("../src/app/api/cron/cleanup/route");
  const probe = async (auth?: string) =>
    (await GET(new Request("http://localhost/api/cron/cleanup",
      { headers: auth ? { authorization: auth } : {} }))).status;

  const noHeader = await probe();
  const undefinedProbe = await probe("Bearer undefined");
  const emptyProbe = await probe("Bearer ");

  process.env.CRON_SECRET = saved;

  check("no header is rejected", noHeader === 401, `${noHeader}`);
  check("`Bearer undefined` is rejected", undefinedProbe === 401,
    undefinedProbe === 200
      ? "AUTHENTICATED WITH A LITERAL 'undefined' — the interpolation hole is live"
      : `${undefinedProbe}`);
  check("`Bearer ` (empty) is rejected", emptyProbe === 401, `${emptyProbe}`);
  console.log("      ↳ a missing secret fails closed instead of becoming a guessable string.");
}

async function cleanup() {
  if (touched.length) {
    await db.delete(holds).where(inArray(holds.seatId, touched));
    await db.update(seats).set({ status: "available" })
      .where(inArray(seats.id, touched));
  }
  console.log(`\n  cleanup: holds removed, ${touched.length} seats restored.`);
}

main()
  .catch((error) => {
    failed++;
    console.error("\n  UNCAUGHT:", error);
  })
  .finally(async () => {
    await cleanup().catch((e) => { failed++; console.error("  cleanup failed:", e); });
    console.log("─".repeat(64));
    console.log(failed === 0 ? `PASS — ${passed} checks` : `${failed} FAILED of ${passed + failed}`);
    process.exit(failed === 0 ? 0 : 1);
  });
