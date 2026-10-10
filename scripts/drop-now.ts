/**
 * DEV-ONLY: move an event's drop to right now, so the waiting room is live.
 *
 *   npm run drop-now                      list live events and their windows
 *   npm run drop-now -- <eventId>         set drop_at = now()
 *   npm run drop-now -- <eventId> --reset push drop_at a day out again
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * The queue only runs inside a window: from ten minutes before `drop_at` until
 * thirty minutes after. That is correct behaviour and it makes the feature
 * impossible to demonstrate on demand - every seeded event dropped weeks ago,
 * so `/events/<id>/seats` is ungated and `/events/<id>/queue` redirects
 * straight back to it, which looks exactly like the feature not working.
 *
 * It also clears the event's Redis queue, so each run starts from an empty line
 * rather than inheriting admitted slots from the last attempt.
 *
 * ── TO SEE THE QUEUE WITH ONE BROWSER ─────────────────────────────────────
 * Put `QUEUE_CAPACITY=1` in `.env.local` and restart `next dev`. Then the first
 * tab is admitted and the second genuinely waits - with the default capacity of
 * 50 you would need fifty-one browsers to see a queue at all.
 */
import { eq, sql } from "drizzle-orm";

import { closeDb, db } from "../src/db";
import { events } from "../src/db/schema";
import {
  QUEUE_CAPACITY,
  QUEUE_CLOSES_AFTER_DROP_MINUTES,
  QUEUE_OPENS_BEFORE_DROP_MINUTES,
  isQueueConfigured,
  queueDepth,
  resetQueue,
} from "../src/lib/queue";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function when(date: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date);
}

async function list() {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      dropAt: events.dropAt,
      status: events.status,
    })
    .from(events)
    .where(eq(events.status, "live"))
    .orderBy(events.dropAt);

  console.log("\n  Live events:\n");
  for (const row of rows) {
    const drop = row.dropAt.getTime();
    const open =
      Date.now() >= drop - QUEUE_OPENS_BEFORE_DROP_MINUTES * 60_000 &&
      Date.now() <= drop + QUEUE_CLOSES_AFTER_DROP_MINUTES * 60_000;

    console.log(`    ${row.id}`);
    console.log(
      `      ${row.title}  ·  drops ${when(row.dropAt)}  ·  queue ${
        open ? "OPEN" : "closed"
      }`,
    );
  }
  console.log("\n  Usage: npm run drop-now -- <eventId>\n");
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("drop-now is a development helper and will not run in production");
  }

  const id = process.argv[2]?.trim();
  const reset = process.argv.includes("--reset");

  if (!id) return list();

  if (!UUID.test(id)) {
    console.error(`\n  "${id}" is not a uuid. Mock events have no drop to move.\n`);
    return list();
  }

  const [updated] = await db
    .update(events)
    .set({
      /* `now()` in SQL rather than `new Date()` - the database's clock is the
         one `isQueueWindowOpen` is compared against through `drop_at`, and the
         two machines are only approximately in agreement. */
      dropAt: reset ? sql`now() + interval '1 day'` : sql`now()`,
      /* A `scheduled` or `draft` event is never queued however its drop is set,
         so moving the date alone would leave the window silently shut. */
      status: "live",
    })
    .where(eq(events.id, id))
    .returning({ id: events.id, title: events.title, dropAt: events.dropAt });

  if (!updated) {
    console.error(`\n  No event with id ${id}.\n`);
    return list();
  }

  /* A fresh line every time. Without this, slots admitted during the previous
     run are still occupying capacity and the next demo starts mid-queue for no
     visible reason. */
  await resetQueue(id);

  console.log(`\n  ${updated.title}`);
  console.log(`    drop_at  ${when(updated.dropAt)}`);
  console.log(
    `    window   ${QUEUE_OPENS_BEFORE_DROP_MINUTES} min before → ${QUEUE_CLOSES_AFTER_DROP_MINUTES} min after`,
  );
  console.log(`    capacity ${QUEUE_CAPACITY}`);
  console.log(`    redis    ${isQueueConfigured() ? "configured" : "NOT CONFIGURED — queue disabled"}`);

  const depth = await queueDepth(id);
  if (depth) console.log(`    queue    ${depth.waiting} waiting, ${depth.admitted} admitted`);

  if (reset) {
    console.log("\n  Queue closed again. The seat map is ungated.\n");
  } else {
    console.log(`\n  Open  /events/${id}/seats`);
    console.log("  With capacity reached you are redirected to the lobby at");
    console.log(`        /events/${id}/queue\n`);
  }
}

main()
  .catch((error) => {
    console.error("\n  FAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  /* `closeDb()` and not `process.exit()`: on Windows, exiting while the
     Postgres pool still has a socket open aborts the process with a libuv
     assertion instead of a clean exit. */
  .finally(() => closeDb());
