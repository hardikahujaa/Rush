import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Upstash Redis, and the rate limiter built on it.
 *
 * ── WHAT REDIS IS, AND WHY IT SITS BESIDE POSTGRES RATHER THAN REPLACING IT ─
 * Redis is an in-memory key-value store. Everything lives in RAM, so a read is
 * microseconds rather than the milliseconds a disk-backed database needs, and
 * keys can be given a TTL so they delete themselves.
 *
 * That makes it excellent at exactly one job here: counting requests per second
 * across every server instance at once. Postgres could do this, but it would
 * mean a write transaction per request, on the same database the hold
 * transaction needs - so the rate limiter would compete for the resource it was
 * installed to protect.
 *
 * What Redis must NEVER be here is the answer to "is this seat taken". It has no
 * transactions with Postgres, so a Redis copy of seat state can commit while the
 * Postgres transaction rolls back, and then the two disagree with no way to tell
 * which is right. T22 was spent removing exactly that class of divergence.
 * Redis holds counters; Postgres holds truth.
 *
 * ── UNCONFIGURED IS A SUPPORTED STATE ──────────────────────────────────────
 * Nothing here throws when the environment variables are missing. It exports
 * null instead, and `rate-limit.ts` falls back. Throwing at import time would
 * mean a project without an Upstash account cannot run the app at all - which
 * is the state this repository is in right now.
 */

/** Requests allowed per identifier per window. */
export const HOLD_RATE_LIMIT = 5;

/** The sliding window. Typed as a literal because Upstash parses the string. */
export const HOLD_RATE_WINDOW = "10 s" as const;

export const HOLD_RATE_WINDOW_MS = 10_000;

const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

/** True only when BOTH values are present and non-empty. */
export const isRedisConfigured = Boolean(url && token);

export const redis = isRedisConfigured
  ? new Redis({ url: url!, token: token! })
  : null;

/**
 * A sliding window rather than a fixed one.
 *
 * A fixed window resets on a clock boundary, so five requests at 0:09.9 and five
 * more at 0:10.1 both pass - ten requests in 200ms against a "5 per 10s" limit.
 * A sliding window always looks at the trailing ten seconds, so that burst is
 * caught.
 *
 * `analytics: false` because each analytics write is another Redis command
 * charged against the free tier, and nothing in this project reads them yet.
 */
export const holdRateLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(HOLD_RATE_LIMIT, HOLD_RATE_WINDOW),
      prefix: "rush:ratelimit:holds",
      analytics: false,
    })
  : null;
