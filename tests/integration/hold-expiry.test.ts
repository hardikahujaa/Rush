import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db";
import { seatIsAvailable, seatStatusExpr } from "@/db/queries/availability";
import { releaseExpiredHolds } from "@/db/queries/holds";
import { events, holds, sections, seats, venues } from "@/db/schema";

/**
 * T22/T25's lazy expiry, proved against the REAL dev Postgres rather than a
 * pure-JS stand-in for it.
 *
 * "A hold is live iff `released_at IS NULL AND expires_at > now()`" is a
 * database rule (`holdIsLive` in availability.ts, compared against
 * Postgres's own clock) - reimplementing that comparison in JavaScript and
 * testing the reimplementation would prove nothing about the actual SQL
 * these queries run. So this test owns a small, disposable fixture (one
 * venue/event/section/two seats) and exercises the exported SQL fragments
 * and `releaseExpiredHolds()` directly, the same way every `scripts/*.ts`
 * test in this repo already does - just with real `expect()` assertions.
 */

const FIXTURE_TITLE = "VITEST INTEGRATION — hold-expiry — safe to delete";
const ORGANIZER_ID = "00000000-0000-4000-8000-000000000001";

let eventId: string;
let expiredSeatId: string;
let liveSeatId: string;
let userId: string;

beforeAll(async () => {
  const [venue] = await db
    .insert(venues)
    .values({ name: "Vitest Fixture Venue", city: "Vitest City" })
    .returning();

  const [event] = await db
    .insert(events)
    .values({
      title: FIXTURE_TITLE,
      venueId: venue.id,
      organizerId: ORGANIZER_ID,
      dropAt: new Date(Date.now() - 60 * 60 * 1000),
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
      status: "live",
    })
    .returning();
  eventId = event.id;

  const [section] = await db
    .insert(sections)
    .values({ eventId, name: "General", priceCents: 10000 })
    .returning();

  const [expiredSeat, liveSeat] = await db
    .insert(seats)
    .values([
      { eventId, sectionId: section.id, rowLabel: "A", seatNo: 1 },
      { eventId, sectionId: section.id, rowLabel: "A", seatNo: 2 },
    ])
    .returning();
  expiredSeatId = expiredSeat.id;
  liveSeatId = liveSeat.id;

  userId = ORGANIZER_ID; // any existing users.id works as the hold's owner

  await db.insert(holds).values([
    {
      seatId: expiredSeatId,
      userId,
      expiresAt: new Date(Date.now() - 60_000), // expired a minute ago
    },
    {
      seatId: liveSeatId,
      userId,
      expiresAt: new Date(Date.now() + 10 * 60_000), // live for 10 more minutes
    },
  ]);
});

afterAll(async () => {
  // holds/seats/sections cascade from events; events->venues is "restrict",
  // so the venue is deleted last, same order reset-load-test.ts uses.
  const eventRow = await db
    .select({ venueId: events.venueId })
    .from(events)
    .where(eq(events.id, eventId));
  await db.delete(events).where(eq(events.id, eventId));
  if (eventRow[0]) {
    await db.delete(venues).where(eq(venues.id, eventRow[0].venueId));
  }
  await closeDb();
});

describe("lazy expiry (read-time)", () => {
  it("treats an expired hold's seat as available, with no write", async () => {
    const [row] = await db.execute<{ available: boolean; status: string }>(sql`
      select
        ${seatIsAvailable(sql`st.id`)}  as available,
        ${seatStatusExpr(sql`st.id`)}   as status
      from ${seats} st
      where st.id = ${expiredSeatId}
    `);
    expect(row.available).toBe(true);
    expect(row.status).toBe("available");
  });

  it("still treats a live hold's seat as held, so the test above isn't vacuous", async () => {
    const [row] = await db.execute<{ available: boolean; status: string }>(sql`
      select
        ${seatIsAvailable(sql`st.id`)}  as available,
        ${seatStatusExpr(sql`st.id`)}   as status
      from ${seats} st
      where st.id = ${liveSeatId}
    `);
    expect(row.available).toBe(false);
    expect(row.status).toBe("held");
  });
});

describe("releaseExpiredHolds (the cron body)", () => {
  it("releases the expired hold and leaves the live one untouched", async () => {
    await releaseExpiredHolds();

    const rows = await db
      .select({ seatId: holds.seatId, releasedAt: holds.releasedAt })
      .from(holds)
      .where(inArray(holds.seatId, [expiredSeatId, liveSeatId]));

    const expiredRow = rows.find((r) => r.seatId === expiredSeatId);
    const liveRow = rows.find((r) => r.seatId === liveSeatId);

    expect(expiredRow?.releasedAt).not.toBeNull();
    expect(liveRow?.releasedAt).toBeNull();
  });
});
