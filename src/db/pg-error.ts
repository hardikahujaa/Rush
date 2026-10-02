import "server-only";

/**
 * Reading Postgres error codes back out of whatever Drizzle threw.
 *
 * ── WHY THIS MODULE EXISTS ──────────────────────────────────────────────────
 * Drizzle does not rethrow the driver's error. It wraps it in a
 * `DrizzleQueryError` whose own enumerable keys are `query`, `params` and
 * `cause` - and the `PostgresError` carrying `code` and `constraint_name`
 * sits on `.cause`. So the obvious check:
 *
 *     (error as { code?: string }).code === "23505"
 *
 * reads `undefined` and silently never matches. Nothing fails loudly; the
 * handler just takes its fallback branch forever.
 *
 * That is not hypothetical. It is why T21's negative control reported
 * "Server Errors: 15" rather than fifteen clean conflicts: with the row lock
 * removed, `one_live_hold_per_seat` fired exactly as designed, but
 * `isLiveHoldViolation` could not see the code, so every one of those
 * well-handled collisions fell through to a generic 500. The database was
 * right and the error mapping threw the answer away.
 *
 * The wrapping is also not something to depend on the shape of: it has changed
 * across Drizzle versions and the driver may wrap again. So this walks the
 * `cause` chain rather than reaching for one fixed depth, which is correct for
 * both the wrapped and the bare error - and keeps working if another layer is
 * added later.
 */

export type PgErrorShape = { code?: string; constraint_name?: string };

/** The innermost error that actually carries a Postgres `code`, or null. */
export function asPgError(error: unknown): PgErrorShape | null {
  let current: unknown = error;

  // Bounded so a self-referential `cause` cannot spin forever.
  for (let depth = 0; current !== null && current !== undefined && depth < 8; depth++) {
    const candidate = current as PgErrorShape & { cause?: unknown };
    if (typeof candidate.code === "string") return candidate;
    current = candidate.cause;
  }

  return null;
}

/**
 * A unique-constraint violation on one NAMED index.
 *
 * The name is always required, never defaulted. "Some unique index was
 * violated" is not actionable: `one_live_hold_per_seat` means a seat was
 * contended and the caller should see a polite 409, while `one_sold_seat` or
 * `tickets_seat_unique` means an oversell was only just prevented and somebody
 * needs to be paged. Collapsing those into one branch would hide the second
 * behind the first.
 */
export function isUniqueViolation(error: unknown, constraintName: string): boolean {
  const pg = asPgError(error);
  return pg?.code === "23505" && pg.constraint_name === constraintName;
}

/** Postgres detected a deadlock and chose this transaction as the victim. */
export function isDeadlockError(error: unknown): boolean {
  return asPgError(error)?.code === "40P01";
}
