import "server-only";

import {
  CHECKOUT_RATE_LIMIT,
  checkoutRateLimiter,
  HOLD_RATE_LIMIT,
  HOLD_RATE_WINDOW_MS,
  holdRateLimiter,
  isRedisConfigured,
  RELEASE_RATE_LIMIT,
  releaseRateLimiter,
} from "@/lib/redis";

export type RateLimitVerdict = {
  success: boolean;
  limit: number;
  remaining: number;
  /** Unix ms at which the window frees up. */
  reset: number;
  backend: "redis" | "memory" | "failed-open";
};

/* ── in-memory fallback ─────────────────────────────────────────────────── */

/**
 * A sliding window in process memory, used only when Redis is not configured.
 *
 * ── THIS IS A DEVELOPMENT TOOL, NOT A SHIELD ───────────────────────────────
 * It counts requests inside ONE Node process. Vercel runs many, each with its
 * own copy, so the real limit in production would be 5 x however many instances
 * happen to exist - and it resets whenever a process restarts. It exists so the
 * 429 path can be exercised and demonstrated before an Upstash account exists,
 * which is a genuine need: a limiter nobody has ever seen reject a request is a
 * limiter nobody knows works.
 *
 * The map is capped and pruned. An uncapped map keyed by caller-controlled input
 * is itself a denial-of-service vector: an attacker rotating identifiers would
 * grow it without limit until the process ran out of memory. Defending against
 * floods with something a flood can exhaust would be a poor trade.
 */
const buckets = new Map<string, number[]>();
const MAX_TRACKED_IDENTIFIERS = 10_000;

function sweep(now: number) {
  const cutoff = now - HOLD_RATE_WINDOW_MS;
  for (const [key, hits] of buckets) {
    const live = hits.filter((t) => t > cutoff);
    if (live.length === 0) buckets.delete(key);
    else buckets.set(key, live);
  }
  /* Still oversized after dropping everything expired: evict in insertion
     order, which for a Map is oldest-first. */
  if (buckets.size > MAX_TRACKED_IDENTIFIERS) {
    const excess = buckets.size - MAX_TRACKED_IDENTIFIERS;
    let i = 0;
    for (const key of buckets.keys()) {
      if (i++ >= excess) break;
      buckets.delete(key);
    }
  }
}

function memoryLimit(
  identifier: string,
  limit: number,
): Omit<RateLimitVerdict, "backend"> {
  const now = Date.now();
  const cutoff = now - HOLD_RATE_WINDOW_MS;

  const hits = (buckets.get(identifier) ?? []).filter((t) => t > cutoff);
  const success = hits.length < limit;
  if (success) hits.push(now);
  buckets.set(identifier, hits);

  if (buckets.size > MAX_TRACKED_IDENTIFIERS) sweep(now);

  return {
    success,
    limit,
    remaining: Math.max(0, limit - hits.length),
    /* When the OLDEST request in the window ages out - which is the moment a
       slot actually frees, and therefore the only honest Retry-After. */
    reset: hits.length > 0 ? hits[0] + HOLD_RATE_WINDOW_MS : now + HOLD_RATE_WINDOW_MS,
  };
}

let warnedAboutMemoryBackend = false;

/* ── the entry point ────────────────────────────────────────────────────── */

type Limiter = typeof holdRateLimiter;

/**
 * Decide whether this caller may proceed.
 *
 * ── WHY IT FAILS OPEN ──────────────────────────────────────────────────────
 * If Redis is configured but unreachable, the request is ALLOWED and the error
 * is logged. That is deliberate. Every correctness rule this product depends on
 * lives in Postgres: the row lock, the partial unique index that makes a second
 * live hold impossible, the four-seat cap. None of them weakens when Redis is
 * down. The only thing lost is throughput protection.
 *
 * Failing closed would mean an outage in a component that guards against load
 * becomes an outage in ticket sales - trading a real, total failure for a
 * hypothetical, partial one. A rate limiter should never be able to take the
 * thing it protects offline.
 *
 * `bucket` namespaces the IN-MEMORY fallback. Redis already separates the two
 * limiters by key prefix, but the fallback is one Map - without a namespace,
 * holding and releasing would share a counter in development and the whole
 * point of giving release its own budget would quietly disappear on the one
 * setup where it is easiest to test.
 */
async function limit(
  limiter: Limiter,
  bucket: string,
  identifier: string,
  fallbackLimit: number,
): Promise<RateLimitVerdict> {
  if (limiter) {
    try {
      const result = await limiter.limit(identifier);
      return {
        success: result.success,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
        backend: "redis",
      };
    } catch (error) {
      console.error(
        "[ratelimit] Redis is configured but unreachable — FAILING OPEN. " +
          "Requests are unthrottled until it recovers.",
        error,
      );
      return {
        success: true,
        limit: fallbackLimit,
        remaining: fallbackLimit,
        reset: Date.now(),
        backend: "failed-open",
      };
    }
  }

  if (!warnedAboutMemoryBackend) {
    warnedAboutMemoryBackend = true;
    console.warn(
      "[ratelimit] UPSTASH_REDIS_REST_URL / _TOKEN are not set. Using the " +
        "in-memory limiter, which counts one process only and is NOT a " +
        "production shield. Create an Upstash database and fill both values in " +
        ".env.local before deploying.",
    );
  }

  return { ...memoryLimit(`${bucket}:${identifier}`, fallbackLimit), backend: "memory" };
}

/** Claiming seats: 5 per 10s. */
export function limitHolds(identifier: string): Promise<RateLimitVerdict> {
  return limit(holdRateLimiter, "holds", identifier, HOLD_RATE_LIMIT);
}

/**
 * Giving seats back: 10 per 10s, on its own budget.
 *
 * Deliberately not the hold budget. Someone who just spent five attempts trying
 * to grab seats must not then be throttled out of releasing them - that would
 * lock them away from the one action that returns inventory to everyone else.
 */
export function limitReleases(identifier: string): Promise<RateLimitVerdict> {
  return limit(releaseRateLimiter, "release", identifier, RELEASE_RATE_LIMIT);
}

/**
 * Turning a hold into a Stripe Checkout Session: 5 per 10s, its own budget.
 *
 * Every allowed request makes an outbound call to Stripe's API, which is
 * slower and more expensive than anything else this limiter family guards -
 * sharing a bucket with holds or releases would let a checkout flood eat
 * headroom that is meant for seat selection.
 */
export function limitCheckout(identifier: string): Promise<RateLimitVerdict> {
  return limit(checkoutRateLimiter, "checkout", identifier, CHECKOUT_RATE_LIMIT);
}

/** Reported in the startup warning and by the test script. */
export const rateLimitBackend = isRedisConfigured ? "redis" : "memory";
