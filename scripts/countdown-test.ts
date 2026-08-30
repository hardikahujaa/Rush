/**
 * T24 — proves the countdown can be resumed after a refresh, and that it
 * refuses to resume one that has already run out.
 *
 *   npm run countdown-test
 *
 * The reload-safety claim is entirely about `getActiveHoldsForUser`: the seats
 * page calls it on every render and seeds the timer from whatever it returns.
 * So the two things worth asserting are that a live hold comes back with the
 * right expiry, and that an expired one comes back as null.
 *
 * That second assertion is the whole argument against localStorage. A cached
 * `expiresAt` cannot know the hold died; it would count down seats Postgres
 * released twenty minutes ago and offer a Proceed to Payment button for
 * tickets nobody owns. Reading the database cannot do that, and this proves it.
 *
 * SAFE ON REAL DATA. One hold is created and removed, and the seat's status is
 * snapshotted and restored in the finally block.
 */
import { eq, sql } from "drizzle-orm";

import { db } from "../src/db";
import { events, holds, seats, users } from "../src/db/schema";
import { seatIsAvailable } from "../src/db/queries/availability";
import { createHold, getActiveHoldsForUser } from "../src/db/queries/holds";

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

let seatIds: string[] = [];
let originalStatus: "available" | "held" | "sold" = "available";

async function main() {
  const [event] = await db
    .select({ id: events.id, title: events.title })
    .from(events)
    .where(eq(events.status, "live"))
    .limit(1);
  if (!event) throw new Error("No live event seeded");

  const [buyer] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, "buyer"))
    .limit(1);

  const free = await db.execute<{ id: string; status: "available" | "held" | "sold" }>(sql`
    select st.id, st.status from ${seats} st
    where st.event_id = ${event.id} and ${seatIsAvailable(sql`st.id`)}
    order by st.id limit 2
  `);
  if (free.length < 2) throw new Error("need two free seats");
  seatIds = free.map((r) => r.id);
  originalStatus = free[0].status;

  console.log(`\n  Event: ${event.title}`);
  console.log(`  Buyer: ${buyer.email}\n`);

  /* ── 1. nothing to resume before a hold exists ──────────────────────── */
  console.log("1. Before any hold");
  const none = await getActiveHoldsForUser(buyer.id, event.id);
  check("returns null — the page renders no countdown", none === null,
    none ? `${none.seats.length} seats returned` : "");

  /* ── 2. a live hold is resumable ────────────────────────────────────── */
  console.log("\n2. After holding two seats");
  const created = await createHold({ userId: buyer.id, seatIds: [...seatIds].sort() });

  const resumed = await getActiveHoldsForUser(buyer.id, event.id);
  check("the hold comes back", resumed !== null);
  check("with both seats", resumed?.seats.length === 2, `${resumed?.seats.length}`);
  check("with the same total the API returned",
    resumed?.totalCents === created.totalCents,
    `${resumed?.totalCents} vs ${created.totalCents}`);

  /* Within a second of each other - both come from the same DB row. */
  const drift = Math.abs(
    (resumed?.expiresAt.getTime() ?? 0) - created.expiresAt.getTime(),
  );
  check("with the same expiry the API returned", drift < 1000, `${drift}ms apart`);

  const minutes = ((resumed?.expiresAt.getTime() ?? 0) - Date.now()) / 60000;
  check("which is still ~10 minutes out", minutes > 9 && minutes <= 10.5,
    `${minutes.toFixed(2)}m`);

  /* ── 3. a hold in the urgency window still resumes ──────────────────── */
  console.log("\n3. Inside the 2-minute urgency window");
  await db.update(holds)
    .set({ expiresAt: sql`now() + make_interval(secs => 90)` })
    .where(eq(holds.userId, buyer.id));

  const urgent = await getActiveHoldsForUser(buyer.id, event.id);
  const secsLeft = ((urgent?.expiresAt.getTime() ?? 0) - Date.now()) / 1000;
  check("still resumable", urgent !== null);
  check("and reports ~90s, so the UI would show its urgent state",
    secsLeft > 80 && secsLeft <= 91, `${secsLeft.toFixed(0)}s`);

  /* ── 4. AN EXPIRED HOLD MUST NOT RESUME ─────────────────────────────── */
  console.log("\n4. Once it has expired");
  console.log("   (this is what localStorage would get wrong)");
  await db.update(holds)
    .set({ expiresAt: sql`now() - interval '1 minute'` })
    .where(eq(holds.userId, buyer.id));

  const dead = await getActiveHoldsForUser(buyer.id, event.id);
  check("returns null — no phantom countdown for released seats", dead === null,
    dead ? "IT RESUMED A DEAD HOLD" : "");

  /* And the row is still there, unreleased - proof the null came from the
     expiry test in the query, not from anything deleting it. */
  const rows = await db
    .select({ id: holds.id, releasedAt: holds.releasedAt })
    .from(holds)
    .where(eq(holds.userId, buyer.id));
  check("the hold row still exists, still unreleased",
    rows.length === 2 && rows.every((r) => r.releasedAt === null),
    `${rows.length} rows`);
  console.log("      ↳ nothing was cleaned up; the query simply stopped counting it.");
}

async function cleanup() {
  if (seatIds.length) {
    await db.delete(holds).where(sql`${holds.seatId} in ${seatIds}`);
    await db.update(seats).set({ status: originalStatus })
      .where(sql`${seats.id} in ${seatIds}`);
  }
  console.log(`\n  cleanup: holds removed, seats restored to '${originalStatus}'.`);
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
