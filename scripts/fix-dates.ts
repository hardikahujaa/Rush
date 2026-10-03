/**
 * Push every event's dates into the future WITHOUT wiping anything.
 *
 *   npm run fix-dates
 *
 * ── WHY THIS EXISTS RATHER THAN "JUST RE-SEED" ─────────────────────────────
 * `src/db/seed.ts` already generates dates relative to `Date.now()`, so a fresh
 * seed is always correct. The problem is that it *clears first* - tickets,
 * orderItems, orders, holds, seats, sections, events, venues - so re-seeding to
 * fix a stale timestamp also destroys every real order and ticket your own
 * account has bought. That is a bad trade for a clock problem.
 *
 * This touches the `events` table and nothing else.
 *
 * ── HOW THE SHIFT IS CHOSEN ────────────────────────────────────────────────
 * One uniform interval applied to every row, anchored so the `live` event lands
 * exactly where the seed would have put it (starts 3 days out). Because the
 * SAME interval moves every column of every event, each relative gap survives
 * untouched: the ended show stays ended, the scheduled one stays undropped, and
 * the distance between `drop_at` and `starts_at` is preserved per event. Setting
 * each row independently would quietly flatten that structure, and
 * `src/lib/event-lookup.ts` relies on the mix to exercise both CTA branches.
 *
 * Naturally idempotent: run it twice and the second shift is ~0, because the
 * anchor is already in the right place.
 */
import { sql } from "drizzle-orm";

import { db } from "../src/db";

type Row = {
  id: string;
  title: string;
  status: string;
  drop_at: Date;
  starts_at: Date;
};

/** How far ahead of now the live event should start - the seed's own number. */
const LIVE_STARTS_IN_DAYS = 3;

function fmt(d: Date) {
  return d.toISOString().slice(0, 16).replace("T", " ");
}

async function snapshot(): Promise<Row[]> {
  return db.execute<Row>(sql`
    select id, title, status, drop_at, starts_at
    from events order by starts_at
  `) as unknown as Promise<Row[]>;
}

async function main() {
  const before = await snapshot();
  if (before.length === 0) throw new Error("no events — run `npm run db:seed` first");

  const [{ now }] = (await db.execute<{ now: Date }>(
    sql`select now() as now`,
  )) as unknown as { now: Date }[];

  /* Anchor on the live event; fall back to the latest-starting one so this
     still does something sensible on a database with no live row. */
  const anchor =
    before.find((e) => e.status === "live") ?? before[before.length - 1];

  const target = new Date(
    new Date(now).getTime() + LIVE_STARTS_IN_DAYS * 86_400_000,
  );
  const shiftMs = target.getTime() - new Date(anchor.starts_at).getTime();

  console.log(`\n  db now        : ${fmt(new Date(now))}`);
  console.log(`  anchor event  : ${anchor.title} (${anchor.status})`);
  console.log(
    `  shift         : ${(shiftMs / 86_400_000).toFixed(2)} days ` +
      `(${shiftMs > 0 ? "forward" : "backward"})\n`,
  );

  console.log("  BEFORE");
  for (const e of before) {
    console.log(
      `    ${e.status.padEnd(10)} drop ${fmt(new Date(e.drop_at))}  starts ${fmt(new Date(e.starts_at))}  ${e.title}`,
    );
  }

  if (Math.abs(shiftMs) < 60_000) {
    console.log("\n  Already current — nothing to do.\n");
    return;
  }

  /* Interval arithmetic in Postgres, so the shift is computed against the same
     clock every other timestamp in this database is compared to. Doing the
     addition in JS would reintroduce exactly the app-server-clock drift that
     createHold and the hold expiry deliberately avoid. */
  const seconds = Math.round(shiftMs / 1000);
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      update events
      set drop_at   = drop_at   + make_interval(secs => ${seconds}),
          starts_at = starts_at + make_interval(secs => ${seconds})
    `);
  });

  const after = await snapshot();
  console.log("\n  AFTER");
  for (const e of after) {
    const dropped = new Date(e.drop_at) <= new Date(now);
    console.log(
      `    ${e.status.padEnd(10)} drop ${fmt(new Date(e.drop_at))}  starts ${fmt(new Date(e.starts_at))}  ` +
        `${dropped ? "[dropped]" : "[upcoming]"}  ${e.title}`,
    );
  }

  /* Prove the blast radius was the events table only. The whole point of this
     script over a re-seed is that these numbers do not move. */
  const [counts] = (await db.execute<{
    orders: number;
    tickets: number;
    items: number;
    users: number;
  }>(sql`
    select (select count(*)::int from orders)      as orders,
           (select count(*)::int from tickets)     as tickets,
           (select count(*)::int from order_items) as items,
           (select count(*)::int from users)       as users
  `)) as unknown as { orders: number; tickets: number; items: number; users: number }[];

  console.log(
    `\n  UNTOUCHED: ${counts.orders} orders, ${counts.tickets} tickets, ` +
      `${counts.items} order items, ${counts.users} users.`,
  );

  const live = after.find((e) => e.status === "live");
  if (live) {
    console.log(`\n  Buyable seat map — open this directly:`);
    console.log(`    http://localhost:3000/events/${live.id}/seats\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  });
