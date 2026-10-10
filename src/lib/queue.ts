import "server-only";

import { redis } from "@/lib/redis";
import { ADMISSION_TTL_SECONDS, isAdmissionSigningConfigured } from "@/lib/queue-token";

/**
 * THE WAITING ROOM (T34).
 *
 * ── THE PROBLEM THIS SOLVES, WHICH IS NOT OVERSELLING ──────────────────────
 * Nothing in here keeps two people off one seat. T20's row locks, T28's unique
 * index and T31's compare-and-set already make that impossible, and they would
 * keep doing it with this file deleted.
 *
 * What this solves is the OTHER failure of a drop: ten thousand people hitting
 * the seat map in the same second, every one of them running a seat query, a
 * hold transaction and a Stripe call, against a database sized for a hundred.
 * The correctness layers would hold - and the site would still be unusable,
 * because every request times out. A queue converts "everyone fails at once"
 * into "fifty people succeed, the rest wait their turn and are told so".
 *
 * ── WHY A SORTED SET ───────────────────────────────────────────────────────
 * A Redis sorted set (ZSET) is a set of unique members, each carrying a numeric
 * score, kept permanently ordered by that score. It gives us, in one structure:
 *
 *     ZADD      O(log N)   join the line
 *     ZRANK     O(log N)   "how many people are ahead of me" - the whole UI
 *     ZCARD     O(1)       how long the line is
 *     ZREM      O(log N)   leave, or be swept away as abandoned
 *
 * A Redis LIST would give push and pop in O(1), but there is no list equivalent
 * of ZRANK - finding your position would be an O(N) scan of ten thousand
 * entries, on every poll, from every one of those ten thousand clients. The
 * position readout IS the feature, so the structure has to make it cheap.
 *
 * Uniqueness matters just as much: a member appears in a ZSET once. Opening
 * five tabs cannot buy five places in line, because the second ZADD of the same
 * user id is not an insert.
 *
 * ── WHY THE SCORE IS AN INCR SEQUENCE AND NOT A TIMESTAMP ──────────────────
 * The obvious score is `Date.now()`. It is wrong in two independent ways.
 *
 *   1. TIES. Two users whose requests land in the same millisecond get the same
 *      score, and Redis then orders equal scores lexicographically by member -
 *      so a uuid beginning '0' permanently beats one beginning 'f'. In the exact
 *      scenario this feature exists for, ties are not an edge case; they are
 *      the common case.
 *   2. CLOCK SKEW. The timestamp comes from whichever serverless instance
 *      happened to handle the request, and those clocks are merely close. Two
 *      instances 30ms apart will silently order a later arrival ahead of an
 *      earlier one, and nothing will ever report it.
 *
 * `INCR` is one atomic counter inside the single Redis every instance shares.
 * It is a total order by construction: no ties are possible, no clock is
 * consulted, and the arbiter of the ordering is the same server for everybody.
 *
 * ── WHAT ADMISSION ACTUALLY IS ─────────────────────────────────────────────
 * Reaching the front moves a user from `:waiting` into `:admitted` and earns
 * them a signed cookie (`queue-token.ts`). The cookie is the proof the gate
 * checks; the `:admitted` set is how CAPACITY is counted. Both are needed - a
 * cookie cannot be counted, and the set alone would put a Redis round trip on
 * every seat-map render.
 */

/* ── keys ───────────────────────────────────────────────────────────────── */

/**
 * Five keys per event, in the order the Lua scripts expect them.
 *
 * All five share one TTL and are refreshed together on every call - see the
 * note on `KEY_TTL_SECONDS`, which is load-bearing for FIFO.
 */
function keys(eventId: string): string[] {
  const base = `rush:queue:${eventId}`;
  return [
    /* 0 WAITING  - ZSET, member = userId, score = INCR sequence. The line. */
    `${base}:waiting`,
    /* 1 SEEN     - ZSET, member = userId, score = last poll (ms). Liveness. */
    `${base}:seen`,
    /* 2 ADMITTED - ZSET, member = userId, score = admission expiry (ms). */
    `${base}:admitted`,
    /* 3 RATE     - ZSET, member = userId:ms, score = admitted at (ms). */
    `${base}:rate`,
    /* 4 SEQ      - the INCR counter that produces the scores in WAITING. */
    `${base}:seq`,
  ];
}

/* ── tunables ───────────────────────────────────────────────────────────── */

/**
 * How many people may be on the seat map at once.
 *
 * Not a guess at what Postgres can take - it is the number T42's load test will
 * either confirm or correct. Overridable per environment so the demo can run
 * with a capacity of 1 and show the queue working with two browser tabs.
 */
export const QUEUE_CAPACITY = (() => {
  const raw = Number(process.env.QUEUE_CAPACITY);
  if (!Number.isFinite(raw) || raw < 1) return 50;
  /* Clamped. A typo of 500000 would make the queue a no-op that still looks
     configured, which is the worst of the available outcomes. */
  return Math.min(Math.floor(raw), 10_000);
})();

/** The queue opens this long before the drop, so people can line up early. */
export const QUEUE_OPENS_BEFORE_DROP_MINUTES = 10;

/**
 * ...and closes this long after it.
 *
 * A queue that never closed would gate a month-old event with four seats left
 * behind a waiting room nobody is in - friction with nothing to protect. The
 * rush is the first half hour; after that the ordinary page is the right one.
 */
export const QUEUE_CLOSES_AFTER_DROP_MINUTES = 30;

/**
 * A waiting spot with no poll for this long is abandoned, and is removed.
 *
 * THIS IS THE CLEANUP THE BRIEF ASKS FOR, AND IT IS NOT OPTIONAL. Admission is
 * granted when the number of people ahead of you is smaller than the number of
 * free slots. If closed tabs stayed in the line forever, the front would fill
 * with ghosts, and once there were `capacity` of them NOBODY would ever be
 * admitted again - a queue that silently bricks itself while Redis reports
 * perfect health.
 *
 * 60 seconds against a worst-case poll interval of 12s allows four missed polls
 * before a live user is dropped, and a dropped user rejoins on their next poll.
 * Being too aggressive costs someone their place; being too lax jams the queue.
 * Neither is free, which is why this sits well clear of the poll interval
 * rather than just above it.
 */
const WAITING_STALE_MS = 60_000;

/**
 * Ghosts removed per call. Bounded on purpose.
 *
 * An unbounded sweep would make one unlucky request pay to clean up after ten
 * thousand abandoned tabs - inside a Lua script, which BLOCKS the entire Redis
 * server while it runs. A hundred per poll is plenty: with fifty people polling
 * every few seconds the backlog drains in moments, and no single request is
 * ever slow.
 */
const STALE_SWEEP_LIMIT = 100;

/** Window over which admissions are counted to estimate the wait. */
const RATE_WINDOW_MS = 60_000;

/**
 * Every key expires an hour after the last activity.
 *
 * ── WHY ALL FIVE SHARE ONE TTL, REFRESHED TOGETHER ─────────────────────────
 * `:seq` looks like the one key that should live forever, and it is the one
 * whose disappearance would break FIFO: a fresh counter restarts at 1, so a new
 * joiner would score BELOW everyone already waiting and jump to the front of
 * the line.
 *
 * It cannot disappear alone, because the scripts re-EXPIRE all five keys on
 * every call. They therefore expire only after an hour in which nobody joined
 * or polled - by which point `:waiting` has expired too and the queue is
 * genuinely empty, so restarting the sequence at 1 is not merely safe but
 * correct.
 *
 * The alternative - persisting `:seq` forever - leaks one key per event for the
 * life of the database, to preserve an ordering with nothing left to order.
 */
const KEY_TTL_SECONDS = 60 * 60;

/* ── is the queue even on? ──────────────────────────────────────────────── */

let warnedUnconfigured = false;

/**
 * The queue needs BOTH Redis and a signing secret.
 *
 * ── AND IF EITHER IS MISSING, THE QUEUE IS DISABLED - NOT OPEN ─────────────
 * There are three things this could do with a missing secret, and only one is
 * defensible:
 *
 *   - Let everyone through the gate UNSIGNED. Never: the gate would be
 *     accepting a cookie it cannot verify, which is a forgery hole wearing a
 *     fallback's clothes.
 *   - Let NOBODY through. That turns a forgotten environment variable into a
 *     total outage of ticket sales.
 *   - Turn the QUEUE off and let the site work without it. Correct. The queue
 *     is a throughput control; every correctness rule lives in Postgres and not
 *     one of them weakens. This is the same call `rate-limit.ts` makes, for the
 *     same reason.
 *
 * In production neither can be missing: `redis.ts` throws at import without its
 * credentials, and the guard below does the same for the secret. "Disabled" is
 * reachable in local development only.
 */
export function isQueueConfigured(): boolean {
  const ok = redis !== null && isAdmissionSigningConfigured();
  if (!ok && !warnedUnconfigured) {
    warnedUnconfigured = true;
    console.warn(
      "[queue] DISABLED — " +
        (redis === null
          ? "UPSTASH_REDIS_REST_URL / _TOKEN are not set."
          : "QUEUE_SIGNING_SECRET is not set.") +
        " The seat map is ungated. Nothing about seat correctness changes; the " +
        "drop simply has no throttle in front of it.",
    );
  }
  return ok;
}

if (process.env.NODE_ENV === "production" && !isAdmissionSigningConfigured()) {
  throw new Error(
    "QUEUE_SIGNING_SECRET must be set in production. Without it the waiting " +
      "room cannot sign admissions, so a drop would run with no throttle at " +
      "all. Generate one with 32 random bytes as hex and set it in the Vercel " +
      "environment variables.",
  );
}

/** Just enough of an event to decide whether its drop is being queued. */
export type QueueableEvent = {
  dropAt: Date;
  status: "draft" | "scheduled" | "live" | "ended";
  /**
   * Mock events have no rows in Postgres, so they are never queued - their seat
   * ids exist nowhere the hold transaction can see, so there is no inventory to
   * protect and a lobby would be pure theatre. Optional because callers that
   * read straight from Postgres (`getEventQueueInfo`) have no mock case.
   */
  source?: "database" | "mock";
};

/**
 * Is this event inside its drop window?
 *
 * Pure, cheap and Redis-free, so the gate can answer "no queue here" with no
 * network call at all - which is the correct answer for every event but the one
 * currently dropping.
 */
export function isQueueWindowOpen(event: QueueableEvent, now = Date.now()): boolean {
  if (event.source === "mock") return false;
  if (event.status !== "live") return false;

  const drop = event.dropAt.getTime();
  return (
    now >= drop - QUEUE_OPENS_BEFORE_DROP_MINUTES * 60_000 &&
    now <= drop + QUEUE_CLOSES_AFTER_DROP_MINUTES * 60_000
  );
}

/** True when this event's drop is being throttled right now. */
export function isQueueActive(event: QueueableEvent, now = Date.now()): boolean {
  return isQueueConfigured() && isQueueWindowOpen(event, now);
}

/* ── the Lua ────────────────────────────────────────────────────────────── */

/**
 * ── WHY THIS IS LUA AND NOT FOUR AWAITED REDIS CALLS ───────────────────────
 * Redis executes a Lua script ATOMICALLY: the whole script runs as one unit
 * with nothing interleaved, exactly like a Postgres transaction.
 *
 * Written as separate awaited calls, the admission check is the same
 * read-then-write race T31 was spent eliminating. Capacity 50, 49 admitted,
 * thirty clients polling at once: every one of them reads `ZCARD admitted` =
 * 49, every one sees a free slot, and all thirty are let in. Capacity 50 would
 * admit 79 - and capacity is the only thing standing between the database and
 * the flood, so overshooting it defeats the entire feature.
 *
 * Inside Lua the count and the insert cannot be separated. `scripts/queue-
 * test.ts` asserts precisely this: 30 simultaneous polls against 5 free slots
 * admit exactly 5.
 *
 * ── ONE DETAIL THAT WOULD BITE SILENTLY ────────────────────────────────────
 * Scores are written with `string.format('%d', ...)` rather than handed over as
 * Lua numbers. Lua formats numbers with `%.14g`, which happens to render a
 * 13-digit millisecond timestamp exactly and would start emitting scientific
 * notation the moment it did not. An explicit integer format cannot drift.
 */
const PROLOGUE = `
local now        = tonumber(ARGV[1])
local capacity   = tonumber(ARGV[2])
local ttlMs      = tonumber(ARGV[3])
local me         = ARGV[4]
local staleMs    = tonumber(ARGV[5])
local rateWindow = tonumber(ARGV[6])
local keyTtl     = tonumber(ARGV[7])
local sweep      = tonumber(ARGV[8])

local WAITING, SEEN, ADMITTED, RATE, SEQ = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5]

-- 1. An expired admission gives its slot back. This is T22's lazy expiry
--    applied to the queue: no cron frees a slot, the next poll does, in the
--    same atomic breath as reading the count that depends on it.
redis.call('ZREMRANGEBYSCORE', ADMITTED, '-inf', string.format('%d', now))

-- 2. Abandoned spots leave the line, bounded so no one request pays for a huge
--    backlog while holding the server to itself.
local ghosts = redis.call('ZRANGEBYSCORE', SEEN, '-inf',
  string.format('%d', now - staleMs), 'LIMIT', 0, sweep)
if #ghosts > 0 then
  redis.call('ZREM', WAITING, unpack(ghosts))
  redis.call('ZREM', SEEN, unpack(ghosts))
end

-- 3. Forget admissions older than the measurement window, so the ETA describes
--    the rate the line is moving NOW rather than an average since it opened.
redis.call('ZREMRANGEBYSCORE', RATE, '-inf', string.format('%d', now - rateWindow))
`;

/**
 * Admit if eligible, then report.
 *
 * Shared by join and poll so the two cannot drift - a join reporting a
 * different position from the poll a second later would read to the user as the
 * queue jumping, which is the one thing a waiting room must never appear to do.
 */
const EPILOGUE = `
local state
if redis.call('ZSCORE', ADMITTED, me) then
  state = 1
else
  local rank = redis.call('ZRANK', WAITING, me)
  if not rank then
    state = 2
  else
    local slots = capacity - redis.call('ZCARD', ADMITTED)
    -- THE FIFO RULE, in one line: you may enter only if the number of people
    -- strictly ahead of you is smaller than the number of free slots. Nobody
    -- behind you can satisfy that while you do not, so a place cannot be
    -- skipped - and because the scores come from INCR, "ahead" is exact rather
    -- than approximately right.
    if rank < slots then
      redis.call('ZREM', WAITING, me)
      redis.call('ZREM', SEEN, me)
      redis.call('ZADD', ADMITTED, string.format('%d', now + ttlMs), me)
      redis.call('ZADD', RATE, string.format('%d', now),
        me .. ':' .. string.format('%d', now))
      state = 1
    else
      state = 0
    end
  end
end

local ahead = redis.call('ZRANK', WAITING, me)
if not ahead then ahead = -1 end

for i = 1, #KEYS do redis.call('EXPIRE', KEYS[i], keyTtl) end

return { state, ahead, redis.call('ZCARD', WAITING),
         redis.call('ZCARD', ADMITTED), redis.call('ZCARD', RATE) }
`;

/**
 * JOIN. Idempotent, which is the entire point of the NX.
 *
 * `ZADD NX` never overwrites an existing score, so a refresh, a second tab, or
 * a retried request all find the user already in line at their original place.
 * Without NX, reloading the page would stamp a fresh sequence number and send
 * them to the BACK of the queue - punishing the one thing an anxious person is
 * guaranteed to do while they wait.
 *
 * An already-admitted user is not put back into the line either. They are past
 * it, and re-queueing them would eject someone mid-checkout.
 */
const JOIN_SCRIPT = `${PROLOGUE}
if not redis.call('ZSCORE', ADMITTED, me) then
  if not redis.call('ZSCORE', WAITING, me) then
    redis.call('ZADD', WAITING, 'NX', redis.call('INCR', SEQ), me)
  end
  redis.call('ZADD', SEEN, string.format('%d', now), me)
end
${EPILOGUE}`;

/**
 * POLL. Reports a position, heartbeats, and admits when the turn comes.
 *
 * It deliberately does NOT join. A client polling a queue it was never added to
 * gets `not_in_queue` and is told to join - because if polling implied joining,
 * the position endpoint would be a second door into the line, bypassing
 * whatever the join endpoint checks.
 */
const POLL_SCRIPT = `${PROLOGUE}
if not redis.call('ZSCORE', ADMITTED, me) and redis.call('ZSCORE', WAITING, me) then
  redis.call('ZADD', SEEN, string.format('%d', now), me)
end
${EPILOGUE}`;

/* ── the TypeScript surface ─────────────────────────────────────────────── */

export type QueuePosition =
  /** Through the gate. The caller mints the admission cookie. */
  | { state: "admitted" }
  | {
      state: "waiting";
      /** People strictly ahead. 0 means next. */
      ahead: number;
      waitingTotal: number;
      admittedCount: number;
      capacity: number;
      /** Null while the line has not moved and there is nothing to measure. */
      etaSeconds: number | null;
    }
  /** Not in the line at all. The client must join. */
  | { state: "not_in_queue" }
  /**
   * Redis is configured but did not answer.
   *
   * A state rather than a thrown error, because the caller's correct response
   * is neither "retry" nor "500" - it is to let the user through and log
   * loudly. See the fail-open note in the route handlers.
   */
  | { state: "unavailable" };

/**
 * The scripts are built once, not per call.
 *
 * `createScript` computes a SHA-1 and caches it on the object; building a fresh
 * one on every poll would recompute that hash and throw away the EVALSHA
 * benefit it exists to provide.
 */
const scripts = redis
  ? { join: redis.createScript(JOIN_SCRIPT), poll: redis.createScript(POLL_SCRIPT) }
  : null;

function argv(userId: string): string[] {
  return [
    String(Date.now()),
    String(QUEUE_CAPACITY),
    String(ADMISSION_TTL_SECONDS * 1000),
    userId,
    String(WAITING_STALE_MS),
    String(RATE_WINDOW_MS),
    String(KEY_TTL_SECONDS),
    String(STALE_SWEEP_LIMIT),
  ];
}

/**
 * Turn the script's five numbers into a verdict.
 *
 * ── THE ETA, AND WHY IT IS MEASURED RATHER THAN ASSUMED ────────────────────
 * The tempting formula is `ahead / capacity * admissionTtl`, and it is a lie:
 * it assumes every admitted user stays for the full twenty minutes. Most buy in
 * three and leave, so that estimate is wrong by a factor of six, in the
 * direction that makes people close the tab.
 *
 * So the rate is observed instead - how many admissions actually happened in
 * the last minute. That number already accounts for people leaving early,
 * people timing out, and capacity being changed underneath it.
 *
 * `null` while nothing has been admitted yet. The UI then says "calculating",
 * which is honest; extrapolating from a single data point is how a waiting room
 * ends up promising two minutes to someone who waits forty.
 */
function interpret(raw: unknown): QueuePosition {
  if (!Array.isArray(raw) || raw.length < 5) {
    console.error("[queue] unexpected script reply", raw);
    return { state: "unavailable" };
  }

  const [state, ahead, waitingTotal, admittedCount, rateCount] = raw.map(Number);

  if (state === 1) return { state: "admitted" };
  if (state === 2) return { state: "not_in_queue" };

  const perSecond = rateCount / (RATE_WINDOW_MS / 1000);
  const etaSeconds =
    ahead <= 0 ? 0 : perSecond > 0 ? Math.ceil(ahead / perSecond) : null;

  return {
    state: "waiting",
    ahead: Math.max(0, ahead),
    waitingTotal,
    admittedCount,
    capacity: QUEUE_CAPACITY,
    etaSeconds,
  };
}

async function run(
  which: "join" | "poll",
  eventId: string,
  userId: string,
): Promise<QueuePosition> {
  if (!scripts) return { state: "unavailable" };
  try {
    /* `exec` tries EVALSHA first and falls back to EVAL once, so the ~2KB of
       Lua crosses the wire once per deployment instead of on every poll from
       every client - during a drop, the difference between kilobytes and
       gigabytes of egress. */
    return interpret(await scripts[which].exec(keys(eventId), argv(userId)));
  } catch (error) {
    console.error("[queue] Redis is unreachable — the drop will run unthrottled", error);
    return { state: "unavailable" };
  }
}

/** Take a place in line, or find the one already held. */
export function joinQueue(eventId: string, userId: string): Promise<QueuePosition> {
  return run("join", eventId, userId);
}

/** Report position, heartbeat, and admit if it is this user's turn. */
export function pollQueue(eventId: string, userId: string): Promise<QueuePosition> {
  return run("poll", eventId, userId);
}

/**
 * Give up a place deliberately.
 *
 * Removes from `:waiting` only, never from `:admitted` - an admitted slot is
 * released by its own expiry, and letting a client hand one back would let a
 * "leave the queue" click in one tab cancel a checkout running in another.
 */
export async function leaveQueue(eventId: string, userId: string): Promise<void> {
  if (!redis) return;
  const [waiting, seen] = keys(eventId);
  try {
    await redis.zrem(waiting, userId);
    await redis.zrem(seen, userId);
  } catch (error) {
    /* Nothing to recover: the stale sweep removes them within the minute. */
    console.error("[queue] leave failed", error);
  }
}

/**
 * Is this user currently in the admitted set? Read-only - admits nobody.
 *
 * This exists for ONE job: re-issuing a pass to somebody who is genuinely
 * through the gate but has lost the cookie - cleared site data, a different
 * browser profile, a mobile app's in-app browser handing off to Safari.
 *
 * It must never be able to admit, which is why it is a plain ZSCORE and not the
 * poll script. If this could admit, `POST /api/queue/admit` would be a second
 * door into the seat map that skipped the capacity check entirely.
 *
 * Returns null when Redis did not answer, so the caller can tell "no" apart
 * from "unknown" - those deserve different responses.
 */
export async function isAdmitted(
  eventId: string,
  userId: string,
): Promise<boolean | null> {
  if (!redis) return null;
  const admitted = keys(eventId)[2];
  try {
    const score = await redis.zscore(admitted, userId);
    /* The score IS the expiry, so an entry the lazy sweep has not reached yet
       still reads as expired here. Same rule as the seat map applying a hold's
       expiry at render time rather than waiting for a cron. */
    return typeof score === "number" && score > Date.now();
  } catch (error) {
    console.error("[queue] admitted lookup failed", error);
    return null;
  }
}

/** Live counts, with no side effects. For the lobby header and the tests. */
export async function queueDepth(
  eventId: string,
): Promise<{ waiting: number; admitted: number } | null> {
  if (!redis) return null;
  const [waiting, , admitted] = keys(eventId);
  try {
    return {
      waiting: await redis.zcard(waiting),
      admitted: await redis.zcard(admitted),
    };
  } catch {
    return null;
  }
}

/**
 * Wipe an event's queue.
 *
 * Used by `scripts/queue-test.ts` between sections, and by `npm run drop-now`,
 * which exists to make the queue demonstrable on demand.
 *
 * Deliberately not reachable from any route handler: the only caller allowed to
 * reset a live queue is one running on a developer's machine.
 */
export async function resetQueue(eventId: string): Promise<void> {
  if (!redis) return;
  await redis.del(...keys(eventId));
}
