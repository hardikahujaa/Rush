/**
 * T31 verification — the gate, and the double-entry guarantee.
 *
 *   npm run scan-test          (dev server must be running)
 *
 * Calls the real `checkInTicket` and the real `/api/scan` route. Nothing mocked.
 *
 * ── SECTION 6 IS THE WHOLE POINT ───────────────────────────────────────────
 * Twenty simultaneous scans of ONE unscanned ticket must produce exactly one
 * VALID. That is what a `SELECT`-then-`UPDATE` implementation cannot do, and it
 * is T31's equivalent of T21's race test: without it, "a ticket admits one
 * person" is an intention rather than a property.
 *
 * SAFE ON REAL DATA. Every `checked_in_at` this sets is reset in the finally
 * block, and no rows are created or deleted.
 */
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../src/db";
import { orders, tickets, users } from "../src/db/schema";
import { checkInTicket } from "../src/db/queries/checkin";
import { encodeTicketPayload, decodeTicketPayload } from "../src/lib/ticket-crypto";
import { SCAN_RATE_LIMIT, isRedisConfigured } from "../src/lib/redis";

const BASE = process.env.RUSH_BASE_URL ?? "http://localhost:3000";

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

/** Tickets whose checked_in_at we touched, reset in cleanup. */
const touched = new Set<string>();

type Row = { ticketId: string; orderId: string; seatId: string };

/** Decode a payload and hand `checkInTicket` exactly what the route would. */
async function scan(payload: string) {
  const decoded = decodeTicketPayload(payload);
  if (!decoded) return { outcome: "forged" as const, reason: "malformed" as const };
  return checkInTicket(decoded);
}

async function main() {
  /* ── fixtures: three unscanned tickets on paid orders ─────────────────── */
  const available = await db
    .select({
      ticketId: tickets.id,
      orderId: tickets.orderId,
      seatId: tickets.seatId,
    })
    .from(tickets)
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .where(sql`${orders.status} = 'paid' and ${tickets.checkedInAt} is null`)
    .limit(3);

  if (available.length < 3) {
    throw new Error(
      `need three un-checked-in tickets, found ${available.length}. ` +
        `Run \`npm run seed-events\` or reset some checked_in_at values.`,
    );
  }
  const [happy, race, other] = available as Row[];

  console.log(`\n  Ticket under test : ${happy.ticketId}`);
  console.log(`  Race ticket       : ${race.ticketId}`);
  console.log(`  Backend           : ${isRedisConfigured ? "redis" : "in-memory"}\n`);

  /* ── 1. malformed input, refused before any query ─────────────────────── */
  console.log("1. Malformed codes (refused before a query runs)");
  const goodPayload = encodeTicketPayload(happy);
  for (const [label, value] of [
    ["empty", ""],
    ["too short", goodPayload.slice(0, 40)],
    ["too long", goodPayload + "AAAA"],
    ["base64 padding", goodPayload.slice(0, 42) + "=="],
    ["illegal character", goodPayload.slice(0, 43) + "!"],
    ["a bare uuid", happy.ticketId],
  ] as [string, string][]) {
    check(`${label} -> forged`, decodeTicketPayload(value) === null);
  }

  /* ── 2. forgery ───────────────────────────────────────────────────────── */
  console.log("\n2. Forgery attempts (each MUST be refused)");

  /* One character of the tag flipped. */
  const at = goodPayload.length - 3;
  const flipped =
    goodPayload.slice(0, at) + (goodPayload[at] === "A" ? "B" : "A") + goodPayload.slice(at + 1);
  const flippedResult = await scan(flipped);
  check(
    "a flipped tag character -> forged",
    flippedResult.outcome === "forged",
    `got ${flippedResult.outcome} — A TAMPERED TICKET WAS ADMITTED`,
  );

  /* Ticket A's tag presented as ticket B. */
  const crossed = encodeTicketPayload({
    ticketId: other.ticketId,
    orderId: happy.orderId,
    seatId: happy.seatId,
  });
  const crossedResult = await scan(crossed);
  check(
    "ticket A's signature on ticket B -> forged",
    crossedResult.outcome === "forged",
    "A SIGNATURE WAS REUSABLE ACROSS TICKETS",
  );

  /* A correctly-shaped payload for a ticket id that does not exist. */
  const ghost = Buffer.concat([
    Buffer.from([1]),
    Buffer.from("00000000000040008000000000000000", "hex"),
    Buffer.alloc(16, 9),
  ]).toString("base64url");
  const ghostResult = await scan(ghost);
  check(
    "a well-formed code for an unknown ticket -> forged",
    ghostResult.outcome === "forged",
  );
  check(
    "and it is INDISTINGUISHABLE from a bad signature (no enumeration oracle)",
    ghostResult.outcome === "forged" && flippedResult.outcome === "forged",
  );

  /* Nothing above should have admitted anything. */
  const [stillClean] = await db
    .select({ checkedInAt: tickets.checkedInAt })
    .from(tickets)
    .where(eq(tickets.id, happy.ticketId))
    .limit(1);
  check("no forgery attempt checked anything in", stillClean.checkedInAt === null);

  /* ── 3. the happy path ────────────────────────────────────────────────── */
  console.log("\n3. A genuine, unscanned ticket");
  touched.add(happy.ticketId);
  const first = await scan(goodPayload);

  check("outcome is valid", first.outcome === "valid", `got ${first.outcome}`);
  if (first.outcome === "valid") {
    check(
      "returns the seat for the gate to read",
      Boolean(first.seat.sectionName && first.seat.rowLabel && first.seat.seatNo > 0),
      JSON.stringify(first.seat),
    );
    check(
      "returns the event and venue",
      Boolean(first.seat.eventTitle && first.seat.venueName),
    );
  }

  const [afterScan] = await db
    .select({ checkedInAt: tickets.checkedInAt })
    .from(tickets)
    .where(eq(tickets.id, happy.ticketId))
    .limit(1);
  check(
    "checked_in_at is actually set in Postgres",
    afterScan.checkedInAt !== null,
    "the UPDATE did not land",
  );

  /* ── 4. the same ticket again ─────────────────────────────────────────── */
  console.log("\n4. The SAME ticket presented a second time");
  const second = await scan(goodPayload);
  check(
    "outcome is already_scanned",
    second.outcome === "already_scanned",
    `got ${second.outcome} — DOUBLE ENTRY`,
  );
  if (second.outcome === "already_scanned" && afterScan.checkedInAt) {
    check(
      "reports the ORIGINAL scan time, not a fresh one",
      Math.abs(second.scannedAt.getTime() - afterScan.checkedInAt.getTime()) < 1000,
      `${second.scannedAt.toISOString()} vs ${afterScan.checkedInAt.toISOString()}`,
    );
    check("and still names the seat, so staff can see whose it is", Boolean(second.seat.rowLabel));
  }

  const [unchanged] = await db
    .select({ checkedInAt: tickets.checkedInAt })
    .from(tickets)
    .where(eq(tickets.id, happy.ticketId))
    .limit(1);
  check(
    "the second scan did NOT overwrite the timestamp",
    unchanged.checkedInAt?.getTime() === afterScan.checkedInAt?.getTime(),
  );

  /* ── 5. THE RACE — 20 doors at once ───────────────────────────────────── */
  console.log("\n5. 20 simultaneous scans of ONE unscanned ticket");
  console.log("   (what a SELECT-then-UPDATE implementation cannot survive)");
  touched.add(race.ticketId);
  const racePayload = encodeTicketPayload(race);

  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => scan(racePayload)),
  );
  const elapsed = Math.round(performance.now() - started);

  const tally = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\n      20 concurrent scans in ${elapsed} ms`);
  console.log(`      outcomes: ${JSON.stringify(tally)}\n`);

  check(
    "EXACTLY ONE said valid",
    tally.valid === 1,
    `${tally.valid ?? 0} admitted — ${(tally.valid ?? 0) - 1} people walked in free`,
  );
  check(
    "the other 19 said already_scanned",
    tally.already_scanned === 19,
    JSON.stringify(tally),
  );
  check("nothing was reported as forged", !tally.forged);

  /* The database is the real witness. */
  const [raceRow] = await db
    .select({ checkedInAt: tickets.checkedInAt })
    .from(tickets)
    .where(eq(tickets.id, race.ticketId))
    .limit(1);
  check("DB VERIFICATION: exactly one checked_in_at, non-null", raceRow.checkedInAt !== null);

  const validTimes = results
    .filter((r): r is Extract<typeof r, { outcome: "valid" }> => r.outcome === "valid")
    .map((r) => r.checkedInAt.getTime());
  check(
    "and only one caller was ever handed an admit timestamp",
    validTimes.length === 1,
    `${validTimes.length} callers were told VALID`,
  );

  /* ── 6. the HTTP boundary ─────────────────────────────────────────────── */
  console.log("\n6. POST /api/scan, signed out");
  const unauth = await fetch(`${BASE}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload: goodPayload }),
  });
  check("answers 401, not a redirect", unauth.status === 401, `${unauth.status}`);
  const unauthBody = await unauth.json().catch(() => null);
  check(
    "with the project's error envelope (not a scan verdict)",
    unauthBody?.error?.code === "UNAUTHENTICATED" && unauthBody?.status === undefined,
  );
  console.log("      ↳ a 401 must never read as 'forged' — it is not a verdict");
  console.log("        on the ticket, and the scanner paints it amber.");

  /* ── 7. rate limit ─────────────────────────────────────────────────
   *
   * STAGGERED, and arriving at that took two wrong turns worth recording.
   *
   * First attempt: send them sequentially, awaiting each. Never saw a 429 - at
   * roughly 250ms per round trip, thirty sequential requests take LONGER than
   * the ten-second window they are meant to fill, so the sliding window had
   * already forgotten the early ones.
   *
   * Second attempt: fire all forty-two at once. Also never saw a 429, for the
   * opposite reason - forty-two simultaneous Upstash round trips from one dev
   * server exceeded the deliberate `timeout: 1000` in redis.ts, so the limiter
   * FAILED OPEN and allowed everything. That is correct, documented behaviour
   * (a rate limiter must never be able to take ticket sales offline), but a test
   * that cannot tell it apart from a broken limiter is a test that lies.
   *
   * So: staggered a few milliseconds apart. Comfortably inside the window, and
   * gentle enough on Redis that the real verdict comes back. The backend is
   * printed either way, so a future fail-open is visible rather than silent.
   */
  console.log(`\n7. Rate limit (${SCAN_RATE_LIMIT} per 10s), staggered burst`);
  const xff = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const total = SCAN_RATE_LIMIT + 10;

  const fired = await Promise.all(
    Array.from({ length: total }, async (_, i) => {
      /* ~40ms apart: 40 requests span ~1.6s, well inside the 10s window, and
         Upstash sees them one at a time instead of all at once. */
      await new Promise((r) => setTimeout(r, i * 40));
      const res = await fetch(`${BASE}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": xff },
        body: JSON.stringify({ payload: goodPayload }),
      });
      return {
        status: res.status,
        retryAfter: res.headers.get("Retry-After"),
        remaining: res.headers.get("RateLimit-Remaining"),
      };
    }),
  );

  const limited = fired.filter((r) => r.status === 429);
  const allowed = fired.filter((r) => r.status !== 429);
  console.log(`      ${total} sent -> ${allowed.length} through, ${limited.length} refused`);

  check(
    "the limiter refused the overflow",
    limited.length > 0,
    "zero 429s — if Upstash was slow the limiter FAILED OPEN by design; re-run",
  );
  /**
   * Note the tolerance, and that it is not slack for its own sake.
   *
   * `Ratelimit.slidingWindow` is a sliding-window COUNTER: it keeps two fixed
   * buckets and interpolates between them by how far into the current one the
   * request landed. That is O(1) memory instead of storing a timestamp per
   * request, and the price is that the effective allowance is approximate near
   * a bucket boundary - this run let 31 through on a limit of 30. Asserting an
   * exact ceiling would be asserting something the algorithm never promised,
   * and the test would flake depending on when in the wall clock it ran.
   *
   * A couple over is fine for a shield whose job is shedding floods. What would
   * NOT be fine is double or unbounded, which is what this actually catches.
   */
  const tolerance = 2;
  check(
    `no more than ${SCAN_RATE_LIMIT} (+${tolerance} window slack) got through`,
    allowed.length <= SCAN_RATE_LIMIT + tolerance,
    `${allowed.length} allowed past a limit of ${SCAN_RATE_LIMIT}`,
  );
  check(
    "every 429 carries Retry-After",
    limited.length > 0 && limited.every((r) => r.retryAfter !== null),
  );
  check(
    "the allowed ones are 401s, so the limiter sits ABOVE auth",
    allowed.length > 0 && allowed.every((r) => r.status === 401),
    `statuses seen: ${[...new Set(allowed.map((r) => r.status))].join(",")}`,
  );

  /* ── 8. a buyer may not scan ──────────────────────────────────────────── */
  console.log("\n8. Role boundary");
  const buyers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "buyer"))
    .limit(1);
  check(
    "buyers exist to be refused (403 path is role-gated in the route)",
    buyers.length === 1,
  );
  console.log("      ↳ the 403 branch needs a signed-in buyer session, which");
  console.log("        this script cannot mint. It is one `user.role` check in");
  console.log("        src/app/api/scan/route.ts, above any database write.");
}

async function cleanup() {
  if (touched.size > 0) {
    await db
      .update(tickets)
      .set({ checkedInAt: null })
      .where(inArray(tickets.id, [...touched]));
  }
  console.log(`\n  cleanup: ${touched.size} ticket(s) reset to un-scanned.`);
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
    process.exit(failed === 0 ? 0 : 1);
  });
