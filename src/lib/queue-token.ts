import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * THE ADMISSION TOKEN (T34).
 *
 * What a user gets when the waiting room lets them through: a signed, httpOnly
 * cookie that proves they reached the front of the line. It is the only thing
 * that opens the seat map and `POST /api/holds` while a drop is queued.
 *
 * ── FORMAT ─────────────────────────────────────────────────────────────────
 *
 *     v1.<eventId>.<userId>.<expiryUnixSeconds>.<hmac base64url>
 *
 * The HMAC covers the first four fields. Everything is readable - there is
 * nothing secret in an event id - and nothing is forgeable without the key.
 *
 * ── WHY STATELESS, AND NOT A TOKEN LOOKED UP IN REDIS ──────────────────────
 * A Redis-backed token would be revocable, which sounds strictly better. It is
 * not, here: this check runs on EVERY seat-map render and EVERY hold attempt,
 * so a Redis lookup puts a ~90ms network round trip on the hot path of the
 * busiest minute the application ever has. An HMAC answers the same question in
 * microseconds with no network at all.
 *
 * What is given up is early revocation, and that costs nothing because an
 * admission IS a time-boxed pass. It expires on its own; there is no state to
 * revoke.
 *
 * ── WHAT THE BINDINGS ARE FOR ──────────────────────────────────────────────
 * `userId` - a stolen cookie is useless without the session that owns it, and
 *            one person cannot hand their place to another.
 * `eventId` - an admission to one drop cannot open a different one. Without
 *            this, queueing for a quiet event would mint a pass for the busy
 *            one, which is the whole queue bypassed through the back door.
 * `expiry` - inside the signed material, so it cannot be extended by editing
 *            the cookie.
 *
 * ── FAIL CLOSED ON A MISSING KEY, AT THE FEATURE LEVEL ─────────────────────
 * With no `QUEUE_SIGNING_SECRET`, `sign` returns null and `verify` refuses
 * everything. The caller's job is then to disable the QUEUE - not to let
 * everyone through the gate unsigned, and not to lock everyone out. See the
 * note on `isQueueConfigured` in `src/lib/queue.ts`.
 */

const VERSION = "v1";

/** 20 minutes. Longer than a 10-minute hold on purpose - see the note below. */
export const ADMISSION_TTL_SECONDS = 20 * 60;

/**
 * Cookie name, scoped per event.
 *
 * A single shared name would mean queueing for a second drop silently
 * overwrites the admission to the first - so someone holding seats in event A
 * would be thrown back into a line the moment they glanced at event B. The
 * first eight characters of the uuid are enough to separate them and keep the
 * header small.
 */
export function admissionCookieName(eventId: string): string {
  return `rush_adm_${eventId.slice(0, 8)}`;
}

function secret(): string | null {
  const s = process.env.QUEUE_SIGNING_SECRET?.trim();
  return s && s.length > 0 ? s : null;
}

export const isAdmissionSigningConfigured = (): boolean => secret() !== null;

/** The exact bytes signed. Order is part of the format - never reorder. */
function material(eventId: string, userId: string, expiry: number): string {
  return `${VERSION}.${eventId}.${userId}.${expiry}`;
}

function tag(key: string, data: string): string {
  return createHmac("sha256", key).update(data).digest("base64url");
}

export type Admission = { eventId: string; userId: string; expiresAt: Date };

/**
 * Mint a pass. Returns null when signing is not configured.
 *
 * `ttlSeconds` defaults to 20 minutes, which deliberately exceeds the
 * 10-minute hold from T20 - but NOT the ~31 minutes a hold is extended to at
 * checkout in T27. That remaining gap is covered by the active-hold exemption
 * in `src/lib/queue.ts`, not by stretching this token: a pass long enough to
 * outlive every possible checkout would stop being a throttle at all.
 */
export function signAdmission(
  eventId: string,
  userId: string,
  ttlSeconds = ADMISSION_TTL_SECONDS,
): { value: string; expiresAt: Date } | null {
  const key = secret();
  if (!key) return null;

  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const data = material(eventId, userId, expiry);

  return {
    value: `${data}.${tag(key, data)}`,
    expiresAt: new Date(expiry * 1000),
  };
}

/**
 * Check a pass, against the event and user it must belong to.
 *
 * Returns the admission on success and null on every failure, deliberately
 * without saying which: a caller learning "the signature was fine but the user
 * was wrong" has been handed a probing oracle. The gate only ever needs to know
 * yes or no.
 */
export function verifyAdmission(
  raw: string | undefined | null,
  expect: { eventId: string; userId: string },
): Admission | null {
  const key = secret();
  if (!key || !raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 5) return null;

  const [version, eventId, userId, expiryRaw, presented] = parts;
  if (version !== VERSION) return null;

  const expiry = Number(expiryRaw);
  if (!Number.isSafeInteger(expiry)) return null;

  /**
   * Signature FIRST, before any field is trusted.
   *
   * Checking the expiry or the ids first would be reading attacker-controlled
   * data and acting on it. Nothing in this string means anything until the tag
   * verifies.
   */
  /* `material` re-prepends VERSION, which was already checked against the
     parsed `version` above - so this reconstructs exactly the bytes that were
     signed, not merely something that looks like them. */
  const expected = tag(key, material(eventId, userId, expiry));
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  /* Length is compared separately because `timingSafeEqual` throws on a
     mismatch rather than returning false, and a thrown error here would become
     a 500 that tells the caller their guess was the wrong shape. */
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  /* Now the fields can be trusted, so the cheap checks come last. */
  if (eventId !== expect.eventId) return null;
  if (userId !== expect.userId) return null;
  if (expiry * 1000 <= Date.now()) return null;

  return { eventId, userId, expiresAt: new Date(expiry * 1000) };
}
