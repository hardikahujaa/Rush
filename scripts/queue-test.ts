/**
 * T34 verification — FIFO, capacity, bypass prevention, and cleanup.
 *
 *   npm run queue-test            (dev server must be running for section 9)
 *
 * Calls the real `joinQueue` / `pollQueue` against the real Upstash database,
 * the real HMAC codec, and the real route handlers. Nothing is mocked.
 *
 * ── SECTION 5 IS THE WHOLE POINT ───────────────────────────────────────────
 * Thirty simultaneous polls against five free slots must admit exactly five.
 * That is what a read-then-write implementation cannot do, and it is T34's
 * equivalent of T21's race test: without it, "capacity is capacity" is an
 * intention rather than a property. Section 11 then runs the broken version to
 * show what the atomic script is actually buying.
 *
 * ── SAFE ON REAL DATA ──────────────────────────────────────────────────────
 * Every Redis section runs against RANDOM event uuids that belong to no event,
 * so a live queue is never touched, and each key is deleted in cleanup. The two
 * Postgres sections create one hold and release it.
 */
import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";

import { closeDb, db } from "../src/db";
import { events, holds, seats, users } from "../src/db/schema";
import { seatIsAvailable } from "../src/db/queries/availability";
import { createHold, releaseHolds } from "../src/db/queries/holds";
import { getEventForSeats, hasBusinessInFlight } from "../src/db/queries/queue";
import { isRedisConfigured, redis } from "../src/lib/redis";
import {
  QUEUE_CAPACITY,
  QUEUE_CLOSES_AFTER_DROP_MINUTES,
  QUEUE_OPENS_BEFORE_DROP_MINUTES,
  isQueueConfigured,
  isQueueWindowOpen,
  joinQueue,
  leaveQueue,
  pollQueue,
  queueDepth,
  resetQueue,
} from "../src/lib/queue";
import {
  ADMISSION_TTL_SECONDS,
  admissionCookieName,
  isAdmissionSigningConfigured,
  signAdmission,
  verifyAdmission,
} from "../src/lib/queue-token";
import { pollAfterMs, respondToPosition } from "../src/lib/queue-response";

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

/** Queue keys to delete at the end. */
const scratch: string[] = [];
function scratchEvent(): string {
  const id = randomUUID();
  scratch.push(id);
  return id;
}

const uid = () => randomUUID();

/** The raw keys, mirroring `keys()` in lib/queue.ts. */
const K = (eventId: string) => ({
  waiting: `rush:queue:${eventId}:waiting`,
  seen: `rush:queue:${eventId}:seen`,
  admitted: `rush:queue:${eventId}:admitted`,
  rate: `rush:queue:${eventId}:rate`,
  seq: `rush:queue:${eventId}:seq`,
});

async function main() {
  /* ── 1. configuration ───────────────────────────────────────────────────── */
  console.log("\n1. Configuration");

  check("Upstash Redis is configured", isRedisConfigured, "set UPSTASH_REDIS_REST_*");
  check("QUEUE_SIGNING_SECRET is set", isAdmissionSigningConfigured());
  check("so the queue is ENABLED (not silently disabled)", isQueueConfigured());
  check(
    `capacity is a sane number (${QUEUE_CAPACITY})`,
    QUEUE_CAPACITY >= 1 && QUEUE_CAPACITY <= 10_000,
  );
  check(
    "capacity is large enough for the atomicity test",
    QUEUE_CAPACITY >= 10,
    `need >= 10, have ${QUEUE_CAPACITY}`,
  );

  if (!isQueueConfigured() || !redis) {
    console.log("\n  Cannot continue without Redis and a signing secret.\n");
    failed++;
    return;
  }

  /* Bound to a local after the guard. TypeScript loses the null-narrowing of
     an imported binding the moment it is used inside a callback, and most of
     the assertions below read Redis inside a `.map`. */
  const r = redis;

  /* ── 2. the window, which is pure arithmetic ────────────────────────────── */
  console.log("\n2. The drop window");

  const live = { status: "live" as const, source: "database" as const };
  const at = (minutesFromDrop: number) => ({
    ...live,
    dropAt: new Date(Date.now() - minutesFromDrop * 60_000),
  });

  check("open exactly at the drop", isQueueWindowOpen(at(0)));
  check(
    `open ${QUEUE_OPENS_BEFORE_DROP_MINUTES} min BEFORE the drop (people queue early)`,
    isQueueWindowOpen(at(-(QUEUE_OPENS_BEFORE_DROP_MINUTES - 1))),
  );
  check(
    "shut well before the window opens",
    !isQueueWindowOpen(at(-(QUEUE_OPENS_BEFORE_DROP_MINUTES + 5))),
  );
  check(
    `still open ${QUEUE_CLOSES_AFTER_DROP_MINUTES - 1} min after`,
    isQueueWindowOpen(at(QUEUE_CLOSES_AFTER_DROP_MINUTES - 1)),
  );
  check(
    "shut once the rush is over",
    !isQueueWindowOpen(at(QUEUE_CLOSES_AFTER_DROP_MINUTES + 5)),
  );
  check(
    "a mock event is NEVER queued (no rows to protect)",
    !isQueueWindowOpen({ ...at(0), source: "mock" }),
  );
  for (const status of ["draft", "scheduled", "ended"] as const) {
    check(`a '${status}' event is never queued`, !isQueueWindowOpen({ ...at(0), status }));
  }

  /* ── 3. the admission token ─────────────────────────────────────────────── */
  console.log("\n3. The admission token");

  const ev = scratchEvent();
  const alice = uid();
  const bob = uid();

  const pass = signAdmission(ev, alice);
  check("a pass can be signed", pass !== null);

  if (pass) {
    check(
      "it verifies for the right user and event",
      verifyAdmission(pass.value, { eventId: ev, userId: alice }) !== null,
    );
    check(
      "REFUSED for a different user (a stolen cookie is useless)",
      verifyAdmission(pass.value, { eventId: ev, userId: bob }) === null,
    );
    check(
      "REFUSED for a different event (no cross-drop reuse)",
      verifyAdmission(pass.value, { eventId: scratchEvent(), userId: alice }) === null,
    );
    check(
      "REFUSED with the signature tampered",
      verifyAdmission(
        pass.value.slice(0, -1) + (pass.value.endsWith("A") ? "B" : "A"),
        { eventId: ev, userId: alice },
      ) === null,
    );
    check(
      "REFUSED with the expiry edited (it is inside the signed material)",
      verifyAdmission(
        pass.value.replace(
          /\.(\d+)\./,
          `.${Math.floor(Date.now() / 1000) + 86_400}.`,
        ),
        { eventId: ev, userId: alice },
      ) === null,
    );
    check(
      `the TTL is ${ADMISSION_TTL_SECONDS / 60} minutes`,
      Math.abs((pass.expiresAt.getTime() - Date.now()) / 1000 - ADMISSION_TTL_SECONDS) < 5,
    );
  }

  const stale = signAdmission(ev, alice, -60);
  check(
    "an EXPIRED pass is refused",
    stale !== null && verifyAdmission(stale.value, { eventId: ev, userId: alice }) === null,
  );

  for (const [label, forged] of [
    ["empty", ""],
    ["random junk", "not-a-token"],
    ["right shape, wrong signature", `v1.${ev}.${alice}.${Date.now()}.AAAA`],
    ["a future version", `v2.${ev}.${alice}.${Math.floor(Date.now() / 1000) + 600}.AAAA`],
    ["too few fields", `v1.${ev}.${alice}`],
  ] as const) {
    check(
      `forgery refused: ${label}`,
      verifyAdmission(forged, { eventId: ev, userId: alice }) === null,
    );
  }

  check(
    "the cookie name is scoped per event (one drop cannot clobber another)",
    admissionCookieName(ev) !== admissionCookieName(scratchEvent()),
  );

  /* ── 4. FIFO ────────────────────────────────────────────────────────────── */
  console.log("\n4. Strict FIFO");

  const fifoEvent = scratchEvent();
  /* One more than capacity, so nobody is admitted and everybody keeps a rank
     we can read. */
  const ordered = Array.from({ length: QUEUE_CAPACITY + 8 }, uid);

  for (const u of ordered) await joinQueue(fifoEvent, u);

  const ranks = await Promise.all(
    ordered.map((u) => r.zrank(K(fifoEvent).waiting, u)),
  );
  /* The first `capacity` joiners were admitted on the way in - each join also
     admits when a slot is free - so only the tail is still waiting. */
  const tail = ranks.slice(QUEUE_CAPACITY);
  check(
    "sequential joins keep their arrival order exactly",
    tail.every((r, i) => r === i),
    `ranks ${JSON.stringify(tail)}`,
  );
  check(
    `the first ${QUEUE_CAPACITY} joiners were admitted straight through`,
    ranks.slice(0, QUEUE_CAPACITY).every((r) => r === null),
  );

  /* The INCR property: concurrent joins must still get DISTINCT scores. With a
     timestamp score these would tie and be ordered by uuid instead. */
  const burstEvent = scratchEvent();
  const burst = Array.from({ length: 40 }, uid);
  await Promise.all(burst.map((u) => joinQueue(burstEvent, u)));

  const scores = await Promise.all(
    burst.map((u) => r.zscore(K(burstEvent).waiting, u)),
  );
  const present = scores.filter((s) => s !== null) as number[];
  check(
    "40 CONCURRENT joins produce no duplicate scores (INCR, not a clock)",
    new Set(present).size === present.length,
    `${present.length - new Set(present).size} ties`,
  );
  check(
    "all 40 are accounted for (admitted or waiting)",
    present.length + (await r.zcard(K(burstEvent).admitted)) === 40,
  );

  /* NX: rejoining must not cost a place. */
  const nxEvent = scratchEvent();
  const filler = Array.from({ length: QUEUE_CAPACITY }, uid);
  for (const u of filler) await joinQueue(nxEvent, u);

  const sticky = uid();
  await joinQueue(nxEvent, sticky);
  const firstRank = await r.zrank(K(nxEvent).waiting, sticky);

  for (let i = 0; i < 3; i++) await joinQueue(nxEvent, sticky);
  await joinQueue(nxEvent, uid());

  check(
    "re-joining does NOT send you to the back (ZADD NX)",
    (await r.zrank(K(nxEvent).waiting, sticky)) === firstRank,
    `was ${firstRank}, now ${await r.zrank(K(nxEvent).waiting, sticky)}`,
  );

  /* ── 5. THE PROOF: capacity is absolute under concurrency ───────────────── */
  console.log("\n5. Atomicity — 30 simultaneous polls, 5 free slots");

  const raceEvent = scratchEvent();
  const keys = K(raceEvent);

  /* Fill to capacity - 5. Joining admits straight through while slots are
     free, so this needs nothing but joins. */
  const insiders = Array.from({ length: QUEUE_CAPACITY - 5 }, uid);
  for (const u of insiders) await joinQueue(raceEvent, u);

  check(
    `${QUEUE_CAPACITY - 5} admitted, 5 slots left`,
    (await r.zcard(keys.admitted)) === QUEUE_CAPACITY - 5,
    `admitted = ${await r.zcard(keys.admitted)}`,
  );

  /* Thirty more take their place in line WITHOUT being admitted - they cannot
     be, because they join one at a time and only 5 slots exist. The first five
     joins will in fact be admitted on the way in, so they are excluded from
     the burst and we add five more. */
  const contenders: string[] = [];
  while (contenders.length < 30) {
    const u = uid();
    await joinQueue(raceEvent, u);
    if ((await r.zscore(keys.waiting, u)) !== null) contenders.push(u);
  }

  const before = await r.zcard(keys.admitted);
  check("the queue is now full, with 30 people waiting", before === QUEUE_CAPACITY, `${before}`);

  /* Everyone polls in the same instant. */
  const verdicts = await Promise.all(contenders.map((u) => pollQueue(raceEvent, u)));
  const admittedNow = verdicts.filter((v) => v.state === "admitted").length;

  check(
    "exactly 0 admitted while the room is full",
    admittedNow === 0,
    `${admittedNow} got in past capacity`,
  );
  check(
    "and the admitted set never exceeded capacity",
    (await r.zcard(keys.admitted)) === QUEUE_CAPACITY,
  );

  /* Now free exactly five slots and repeat. THIS is the race. */
  await r.zremrangebyrank(keys.admitted, 0, 4);
  check("5 slots freed", (await r.zcard(keys.admitted)) === QUEUE_CAPACITY - 5);

  const round2 = await Promise.all(contenders.map((u) => pollQueue(raceEvent, u)));
  const got = round2.filter((v) => v.state === "admitted").length;

  check(
    "EXACTLY 5 of 30 simultaneous polls were admitted",
    got === 5,
    `${got} admitted — capacity was overshot by ${got - 5}`,
  );
  check(
    "the admitted set is back at exactly capacity",
    (await r.zcard(keys.admitted)) === QUEUE_CAPACITY,
    `${await r.zcard(keys.admitted)}`,
  );

  /* And the five who got in were the five at the FRONT, not five at random. */
  const winners = new Set(
    contenders.filter((_, i) => round2[i].state === "admitted"),
  );
  const expectedWinners = new Set(contenders.slice(0, 5));
  check(
    "and they were the FIVE AT THE FRONT of the line, not five at random",
    winners.size === 5 && [...winners].every((w) => expectedWinners.has(w)),
    `expected ${[...expectedWinners].map((w) => w.slice(0, 8))}, got ${[...winners].map((w) => w.slice(0, 8))}`,
  );

  /* ── 6. lazy capacity recovery, with no cron ────────────────────────────── */
  console.log("\n6. Capacity recovers lazily (no cron, like T22)");

  const expiredHolder = [...(await r.zrange<string[]>(keys.admitted, 0, 0))][0];
  check("picked an admitted user to expire", typeof expiredHolder === "string");

  if (typeof expiredHolder === "string") {
    /* Backdate their admission. Nothing runs; no job is scheduled. */
    await r.zadd(keys.admitted, { score: Date.now() - 1_000, member: expiredHolder });

    const waiter = contenders.find((u) => !winners.has(u))!;
    const verdict = await pollQueue(raceEvent, waiter);

    check(
      "a single poll both expires the stale admission AND fills the slot",
      verdict.state === "admitted",
      `got ${verdict.state}`,
    );
    check(
      "the expired user is gone from the admitted set",
      (await r.zscore(keys.admitted, expiredHolder)) === null,
    );
    check(
      "and capacity is still exactly capacity",
      (await r.zcard(keys.admitted)) === QUEUE_CAPACITY,
    );
  }

  /* ── 7. abandoned spots do not jam the line ─────────────────────────────── */
  console.log("\n7. Abandoned spots are swept (the jam this prevents)");

  const ghostEvent = scratchEvent();
  const gk = K(ghostEvent);

  /* Fill every slot so nobody can be admitted, then put ghosts at the front. */
  for (const u of Array.from({ length: QUEUE_CAPACITY }, uid)) {
    await joinQueue(ghostEvent, u);
  }

  const ghosts = Array.from({ length: 6 }, uid);
  for (const g of ghosts) await joinQueue(ghostEvent, g);

  const realUser = uid();
  await joinQueue(ghostEvent, realUser);

  const rankBehindGhosts = await r.zrank(gk.waiting, realUser);
  check("a live user is queued behind 6 ghosts", rankBehindGhosts === 6, `rank ${rankBehindGhosts}`);

  /* Every ghost closed their tab a while ago. */
  for (const g of ghosts) {
    await r.zadd(gk.seen, { score: Date.now() - 300_000, member: g });
  }

  await pollQueue(ghostEvent, realUser);

  check(
    "one poll sweeps all 6 abandoned spots",
    (await r.zcard(gk.waiting)) === 1,
    `${await r.zcard(gk.waiting)} still waiting`,
  );
  check(
    "and the live user moves to the front",
    (await r.zrank(gk.waiting, realUser)) === 0,
  );
  check(
    "the live user's own spot was NOT swept (polling is a heartbeat)",
    (await r.zscore(gk.waiting, realUser)) !== null,
  );

  /* ── 8. polling does not join; leaving does leave ───────────────────────── */
  console.log("\n8. The poll endpoint is not a second door");

  const doorEvent = scratchEvent();
  const stranger = uid();

  const polled = await pollQueue(doorEvent, stranger);
  check(
    "polling without joining reports not_in_queue",
    polled.state === "not_in_queue",
    `got ${polled.state}`,
  );
  check(
    "and did NOT create a place in line",
    (await r.zcard(K(doorEvent).waiting)) === 0,
  );

  const leaveEvent = scratchEvent();
  for (const u of Array.from({ length: QUEUE_CAPACITY }, uid)) {
    await joinQueue(leaveEvent, u);
  }
  const quitter = uid();
  await joinQueue(leaveEvent, quitter);
  await leaveQueue(leaveEvent, quitter);
  check(
    "leaveQueue removes a waiting spot",
    (await r.zscore(K(leaveEvent).waiting, quitter)) === null,
  );

  const depth = await queueDepth(leaveEvent);
  check(
    "queueDepth reports the line without changing it",
    depth !== null && depth.admitted === QUEUE_CAPACITY && depth.waiting === 0,
    JSON.stringify(depth),
  );

  /* ── 9. the HTTP surface ────────────────────────────────────────────────── */
  console.log("\n9. The endpoints (dev server required)");

  let serverUp = true;
  try {
    const unauth = await fetch(`${BASE}/api/queue/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: randomUUID() }),
    });
    check("POST /api/queue/join unauthenticated is 401", unauth.status === 401, `${unauth.status}`);
  } catch {
    serverUp = false;
    console.log("  SKIP  dev server not reachable at " + BASE);
  }

  if (serverUp) {
    const pos = await fetch(`${BASE}/api/queue/position`);
    check(
      "GET /api/queue/position with no eventId is refused",
      pos.status === 400 || pos.status === 401,
      `${pos.status}`,
    );

    const bad = await fetch(`${BASE}/api/queue/position?eventId=not-a-uuid`);
    check(
      "a non-uuid eventId never reaches a Redis key",
      bad.status === 400 || bad.status === 401,
      `${bad.status}`,
    );

    const admitUnauth = await fetch(`${BASE}/api/queue/admit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: randomUUID() }),
    });
    check("POST /api/queue/admit unauthenticated is 401", admitUnauth.status === 401);

    const holdsUnauth = await fetch(`${BASE}/api/holds`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seatIds: [randomUUID()] }),
    });
    check(
      "POST /api/holds still refuses an anonymous caller",
      holdsUnauth.status === 401 || holdsUnauth.status === 429,
      `${holdsUnauth.status}`,
    );
  }

  /* ── 10. the response mapping, including the fail-open ──────────────────── */
  console.log("\n10. Response mapping and the deliberate fail-open");

  const ctx = {
    userId: alice,
    event: { id: ev, title: "t", dropAt: new Date(), status: "live" as const },
  };
  const cookieName = admissionCookieName(ev);

  const admittedRes = respondToPosition({ state: "admitted" }, ctx);
  const admittedCookie = admittedRes.headers.get("set-cookie") ?? "";
  check("an admission sets the pass cookie", admittedCookie.includes(cookieName));
  check("the cookie is HttpOnly (script can neither read nor write it)",
    /httponly/i.test(admittedCookie));
  check("and SameSite=Lax, so the return from Stripe still carries it",
    /samesite=lax/i.test(admittedCookie));
  check(
    "the admitted body reports degraded: false",
    (await admittedRes.json()).degraded === false,
  );

  const waitingRes = respondToPosition(
    {
      state: "waiting",
      ahead: 7,
      waitingTotal: 9,
      admittedCount: QUEUE_CAPACITY,
      capacity: QUEUE_CAPACITY,
      etaSeconds: 30,
    },
    ctx,
  );
  check(
    "a WAITING response sets no cookie at all",
    !(waitingRes.headers.get("set-cookie") ?? "").includes(cookieName),
    "a waiting user was handed a pass",
  );
  const waitingBody = await waitingRes.json();
  check(
    "and carries a server-chosen poll interval",
    typeof waitingBody.pollAfterMs === "number" && waitingBody.pollAfterMs > 0,
  );

  const degradedRes = respondToPosition({ state: "unavailable" }, ctx);
  const degradedBody = await degradedRes.json();
  check(
    "a Redis outage FAILS OPEN (sales continue; Postgres still enforces seats)",
    degradedBody.state === "admitted",
  );
  check(
    "and says so, so a silent fail-open cannot be mistaken for a working queue",
    degradedBody.degraded === true,
  );

  /* The cadence ladder. */
  check("ahead=5 polls fast (~1.5s)", within(pollAfterMs(5), 1_200, 1_800));
  check("ahead=100 backs off (~3s)", within(pollAfterMs(100), 2_400, 3_600));
  check("ahead=900 backs off further (~6s)", within(pollAfterMs(900), 4_800, 7_200));
  check("ahead=5000 polls slowly (~12s)", within(pollAfterMs(5_000), 9_600, 14_400));
  const spread = new Set(Array.from({ length: 24 }, () => pollAfterMs(5)));
  check(
    "the interval is jittered, so 10k clients do not poll in lockstep",
    spread.size > 10,
    `only ${spread.size} distinct values in 24 calls`,
  );

  /* ── 11. NEGATIVE CONTROL: the same test without the Lua ────────────────── */
  console.log("\n11. NEGATIVE CONTROL — read-then-write instead of one script");

  const broken = scratchEvent();
  const bk = K(broken);

  for (const u of Array.from({ length: QUEUE_CAPACITY - 5 }, uid)) {
    await joinQueue(broken, u);
  }
  const brokenContenders: string[] = [];
  while (brokenContenders.length < 30) {
    const u = uid();
    await joinQueue(broken, u);
    if ((await r.zscore(bk.waiting, u)) !== null) brokenContenders.push(u);
  }
  await r.zremrangebyrank(bk.admitted, 0, 4);
  const freeBefore = QUEUE_CAPACITY - (await r.zcard(bk.admitted));

  /**
   * The implementation almost everyone writes first: "is there room? come in."
   *
   * Every one of these three commands is correct. The BUG is the gap between
   * the first and the third - thirty callers all read the same count, all see
   * free space, and all take it.
   *
   * ── A FINDING FROM GETTING THIS WRONG ONCE ───────────────────────────────
   * The first version of this control compared the caller's RANK against the
   * free slots - `rank < capacity - count` - which is what the Lua script
   * does, so it looked like the faithful non-atomic twin. It admitted exactly
   * five, and the control passed nothing.
   *
   * The reason is worth recording: a rank is a STABLE per-caller value, so
   * when thirty callers read the same count simultaneously, only the five
   * whose rank is already below the free-slot count are eligible at all. That
   * variant is accidentally self-limiting under a simultaneous burst - and
   * NOT in general, because a rank read after the front of the line has been
   * removed is a smaller, staler number. It resists exactly the interleaving a
   * test produces and fails on the ones production produces, which is the
   * worst property a concurrency check can have.
   *
   * The capacity count is where the race actually lives, so that is what this
   * control removes the atomicity from.
   */
  async function naiveAdmit(userId: string): Promise<boolean> {
    const admittedCount = await r.zcard(bk.admitted);
    if (admittedCount >= QUEUE_CAPACITY) return false;
    if ((await r.zrank(bk.waiting, userId)) === null) return false;
    await r.zrem(bk.waiting, userId);
    await r.zadd(bk.admitted, {
      score: Date.now() + ADMISSION_TTL_SECONDS * 1000,
      member: userId,
    });
    return true;
  }

  const naive = await Promise.all(brokenContenders.map(naiveAdmit));
  const naiveAdmitted = naive.filter(Boolean).length;
  const finalCount = await r.zcard(bk.admitted);

  console.log(`      ↳ ${freeBefore} slots free, ${naiveAdmitted} admitted`);
  console.log(
    `      ↳ final admitted count ${finalCount} against a capacity of ${QUEUE_CAPACITY}` +
      ` (overshoot ${finalCount - QUEUE_CAPACITY})`,
  );
  check(
    "the non-atomic version OVERSHOOTS capacity (this failure is the point)",
    naiveAdmitted > freeBefore && finalCount > QUEUE_CAPACITY,
    `admitted ${naiveAdmitted} into ${freeBefore} slots, ending at ${finalCount}`,
  );
  console.log("      ↳ the Lua version cannot do this: the count and the insert are");
  console.log("        one statement, so there is no instant in which two callers can");
  console.log("        both see the same free slot.");

  /* ── 12. the active-hold exemption, against real Postgres ───────────────── */
  console.log("\n12. The active-hold exemption (nobody is dumped mid-checkout)");

  const [event] = await db
    .select({ id: events.id, title: events.title, dropAt: events.dropAt, status: events.status })
    .from(events)
    .where(eq(events.status, "live"))
    .limit(1);
  const [buyer] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "buyer"))
    .limit(1);

  if (!event || !buyer) {
    failed++;
    console.log("  FAIL  no live event / buyer to test against");
  } else {
    check(
      "a user with no hold and no order is NOT exempt",
      (await hasBusinessInFlight(buyer.id, event.id)) === false,
    );

    const free = await db.execute<{ id: string }>(sql`
      select st.id from ${seats} st
      where st.event_id = ${event.id} and ${seatIsAvailable(sql`st.id`)}
      order by st.id limit 1`);

    if (free.length === 0) {
      failed++;
      console.log("  FAIL  no available seat in the live event");
    } else {
      const seatId = free[0].id;
      heldSeats.push(seatId);

      await createHold({ userId: buyer.id, seatIds: [seatId] });
      check(
        "a LIVE HOLD exempts them — a Stripe return is never re-queued",
        (await hasBusinessInFlight(buyer.id, event.id)) === true,
      );

      /* And the event is derived from the seats, never from the client. */
      const derived = await getEventForSeats([seatId]);
      check(
        "getEventForSeats finds the seat's own event (the gate's subject)",
        derived?.id === event.id,
      );

      /* Expire the hold in place. The exemption must expire with it, or it
         would become a permanent queue bypass for anyone who ever held a seat. */
      await db
        .update(holds)
        .set({ expiresAt: sql`now() - interval '1 minute'` })
        .where(eq(holds.seatId, seatId));
      check(
        "an EXPIRED hold does not exempt (the bypass closes with it)",
        (await hasBusinessInFlight(buyer.id, event.id)) === false,
      );

      await db
        .update(holds)
        .set({ expiresAt: sql`now() + interval '10 minutes'` })
        .where(eq(holds.seatId, seatId));
      await releaseHolds({ userId: buyer.id, seatIds: [seatId] });
      check(
        "a RELEASED hold does not exempt either",
        (await hasBusinessInFlight(buyer.id, event.id)) === false,
      );
    }

    /* Seats from two different events must not resolve to one gate subject. */
    const twoEvents = await db.execute<{ id: string }>(sql`
      select distinct on (event_id) id from ${seats} order by event_id, id limit 2`);
    if (twoEvents.length === 2) {
      check(
        "seats spanning two events resolve to NO event (createHold rejects it)",
        (await getEventForSeats(twoEvents.map((r) => r.id))) === null,
      );
    }

    check(
      "a uuid belonging to no seat resolves to no event",
      (await getEventForSeats([randomUUID()])) === null,
    );
  }
}

const heldSeats: string[] = [];

async function cleanup() {
  for (const id of scratch) await resetQueue(id).catch(() => {});

  if (heldSeats.length) {
    await db.delete(holds).where(inArray(holds.seatId, heldSeats));
    await db
      .update(seats)
      .set({ status: "available" })
      .where(inArray(seats.id, heldSeats));
  }
  console.log(
    `\n  cleanup: ${scratch.length} scratch queue(s) deleted, ${heldSeats.length} seat(s) restored.`,
  );
}

function within(value: number, lo: number, hi: number) {
  return value >= lo && value <= hi;
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
      failed === 0 ? `PASS — ${passed} checks` : `${failed} FAILED of ${passed + failed}`,
    );
    /* `closeDb()` rather than `process.exit()`: exiting with the Postgres pool
       still open aborts with a libuv assertion on Windows. */
    await closeDb().catch(() => {});
    process.exitCode = failed === 0 ? 0 : 1;
  });
