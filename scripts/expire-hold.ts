/**
 * Makes the countdown testable in seconds instead of ten minutes.
 *
 *   npm run expire-hold                 # show every live hold
 *   npm run expire-hold -- 130          # age them to expire in 130s (urgency state)
 *   npm run expire-hold -- 5            # age them to expire in 5s (zero trigger)
 *   npm run expire-hold -- 0            # expire immediately
 *
 * Sitting through a real ten-minute hold to check that the timer turns red at
 * two minutes is not a test anyone runs twice, so it never gets run. Rewriting
 * `expires_at` moves the clock instead of the tester.
 *
 * It also prints what `getActiveHoldsForUser` returns, which is what the seat
 * page uses to resume a countdown after a refresh - so a wrong answer here is
 * visible before it becomes a wrong timer.
 */
import { eq, sql } from "drizzle-orm";

import { db } from "../src/db";
import { holds, seats, sections, users } from "../src/db/schema";
import { holdIsLive } from "../src/db/queries/availability";
import { getActiveHoldsForUser } from "../src/db/queries/holds";

const seconds = process.argv[2] !== undefined ? Number(process.argv[2]) : null;

async function main() {
  if (seconds !== null && !Number.isFinite(seconds)) {
    throw new Error(`"${process.argv[2]}" is not a number of seconds`);
  }

  /* Every live hold, whoever owns it, so you can see what state you are in. */
  const live = await db
    .select({
      holdId: holds.id,
      userId: holds.userId,
      email: users.email,
      eventId: seats.eventId,
      section: sections.name,
      row: seats.rowLabel,
      seatNo: seats.seatNo,
      expiresAt: holds.expiresAt,
    })
    .from(holds)
    .innerJoin(seats, eq(seats.id, holds.seatId))
    .innerJoin(sections, eq(sections.id, seats.sectionId))
    .innerJoin(users, eq(users.id, holds.userId))
    .where(sql`${holdIsLive(sql`${holds}`)}`)
    .orderBy(holds.expiresAt);

  if (live.length === 0) {
    console.log("\n  No live holds.");
    console.log("  Sign in, pick seats and press Hold seats, then run this again.\n");
    return;
  }

  console.log(`\n  ${live.length} live hold${live.length === 1 ? "" : "s"}:\n`);
  for (const h of live) {
    const left = Math.round((h.expiresAt.getTime() - Date.now()) / 1000);
    console.log(
      `    ${h.email.padEnd(24)} ${h.section} ${h.row}${h.seatNo}`.padEnd(52) +
        `expires in ${left}s`,
    );
  }

  if (seconds === null) {
    console.log("\n  Pass a number of seconds to move the clock, e.g.");
    console.log("    npm run expire-hold -- 130   (crosses the 2-minute urgency line)");
    console.log("    npm run expire-hold -- 5     (watch it hit zero)\n");
  } else {
    await db
      .update(holds)
      .set({ expiresAt: sql`now() + make_interval(secs => ${seconds})` })
      .where(sql`${holdIsLive(sql`${holds}`)}`);

    console.log(`\n  Moved ${live.length} hold(s) to expire in ${seconds}s.`);
    console.log("  Reload the seat page to see the timer pick up the new value.\n");
  }

  /* The same call the seats page makes. If this disagrees with the list above,
     the resume-after-refresh path is broken and the timer would lie. */
  const owner = live[0];
  const resumed = await getActiveHoldsForUser(owner.userId, owner.eventId);
  console.log("  getActiveHoldsForUser (what the page reads on refresh):");
  if (!resumed) {
    console.log("    null — NOTHING WOULD RESUME. The query is wrong.\n");
    process.exitCode = 1;
  } else {
    const left = Math.round((resumed.expiresAt.getTime() - Date.now()) / 1000);
    console.log(
      `    ${resumed.seats.length} seat(s), earliest expiry in ${left}s, ` +
        `total ${resumed.totalCents / 100} INR\n`,
    );
  }
}

main()
  .catch((error) => {
    console.error("\n  FAILED:", (error as Error)?.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
