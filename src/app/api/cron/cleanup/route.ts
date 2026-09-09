import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { releaseExpiredHolds } from "@/db/queries/holds";

/**
 * GET /api/cron/cleanup - daily housekeeping on the holds table.
 *
 * ── THIS JOB IS COSMETIC, AND THAT IS A DESIGN CONSTRAINT ──────────────────
 * Nothing depends on it running. A hold past `expires_at` already frees its
 * seat, inside the query, the instant it passes - that is T22, and it is what
 * makes the ten-minute promise honest even if this route is never called again.
 *
 * What it buys is tidiness: a seat whose hold expired and which nobody
 * re-requested keeps a row with `released_at IS NULL` and a stale
 * `seats.status = 'held'` forever. Neither is visible to a user; both mislead
 * the next person to read the database.
 *
 * If this ever grows a line that changes what "available" means, T22's guarantee
 * has quietly become a lie and the seat map starts depending on a daily cron to
 * be correct. It must not.
 *
 * Scheduled from `vercel.json` at 03:00 UTC. Vercel's Hobby plan allows one run
 * per day, which is fine precisely because nothing depends on the cadence.
 */

const secret = process.env.CRON_SECRET;

/**
 * Constant-time comparison of the bearer token.
 *
 * ── WHY NOT `header === \`Bearer ${process.env.CRON_SECRET}\`` ──────────────
 * Because when the variable is unset, that template collapses to the literal
 * string "Bearer undefined" - and anyone sending exactly that header
 * authenticates. A missing secret has to fail closed, never turn into a
 * guessable constant. The `!secret` check below is the whole point of this
 * function existing.
 *
 * `timingSafeEqual` over `===` is close to free and is simply the correct
 * primitive for comparing a secret. It throws on length mismatch, so the length
 * is checked first - which does leak the secret's length, but a 64-character
 * random token is not meaningfully weakened by that.
 */
function isAuthorised(header: string | null): boolean {
  if (!secret) return false; // fail closed, always
  if (!header?.startsWith("Bearer ")) return false;

  const provided = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}

export async function GET(request: Request) {
  if (!isAuthorised(request.headers.get("authorization"))) {
    if (!secret) {
      console.error(
        "[cron/cleanup] CRON_SECRET is not set — refusing every request. " +
          "Set it in the environment before scheduling this route.",
      );
    }
    /* No detail in the body. An unauthenticated caller learns only that they
       are unauthenticated - not whether the secret exists or was close. */
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Unauthorized." } },
      { status: 401 },
    );
  }

  try {
    const result = await releaseExpiredHolds();

    console.log(
      `[cron/cleanup] released ${result.released} expired hold(s), ` +
        `repaired ${result.statusRepaired} seat status row(s)`,
    );

    return NextResponse.json({
      released: result.released,
      statusRepaired: result.statusRepaired,
      /* Stated in the response so anyone reading a log or a monitoring
         dashboard knows this job is not load-bearing. */
      note: "Cosmetic only — availability is computed at read time and does not depend on this job.",
    });
  } catch (error) {
    console.error("[cron/cleanup] failed", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Cleanup failed." } },
      { status: 500 },
    );
  }
}
