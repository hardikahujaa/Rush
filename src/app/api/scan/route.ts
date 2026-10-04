import { NextResponse } from "next/server";

import { checkInTicket } from "@/db/queries/checkin";
import { getCurrentUser } from "@/lib/auth";
import { limitScans } from "@/lib/rate-limit";
import { getVerifiedClaims } from "@/lib/supabase/server";
import { decodeTicketPayload } from "@/lib/ticket-crypto";
import { scanSchema } from "@/lib/validation/scan";

/**
 * POST /api/scan - the gate.
 *
 * ── THIS ENDPOINT IS AUTHENTICATED, DELIBERATELY ───────────────────────────
 * The T31 brief offered "or keep it accessible for the demo". Declined, and the
 * reason is not pedantry: this route WRITES `checked_in_at`. An unauthenticated
 * version lets anyone who can reach the URL mark tickets as used - not steal a
 * seat, but **burn** one, so a paying customer is refused at the door with
 * ALREADY SCANNED and no way to prove otherwise. Denial of entry is a worse
 * outcome than most of what this codebase defends against, and preventing it
 * costs one role check.
 *
 * Gate staff are `staff` or `organizer`. A `buyer` gets 403 - they may hold a
 * ticket, but holding one is not permission to admit people.
 *
 * ── WHY NOT requireRole() ──────────────────────────────────────────────────
 * It calls `redirect()`, which becomes a 307 to the login page. A `fetch()`
 * from the scanner would follow that and try to parse HTML as JSON. A route
 * handler has to answer with a status code and mean it - same reasoning as
 * /api/holds.
 *
 * ── THE THREE OUTCOMES ARE RESULTS, NOT ERRORS ─────────────────────────────
 * `valid` (200), `already_scanned` (409) and `forged` (400) all mean the system
 * worked correctly. They carry a bare `{ status }` shape, per the brief. Real
 * failures - 401, 403, 429, 500 - use the project's `{ error: { code, message } }`
 * envelope. The scanner UI needs to tell these apart, because a 500 must NEVER
 * paint the same screen as a forged ticket: one is a bad ticket, the other is a
 * bad connection, and turning away a legitimate holder over a network blip is
 * the one mistake a gate cannot make.
 */

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Same identity rule as every other limited route: verified JWT, IP fallback. */
async function identify(request: Request): Promise<string> {
  const claims = await getVerifiedClaims();
  if (claims?.sub) return `user:${claims.sub}`;

  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  return ip ? `ip:${ip}` : "anonymous";
}

export async function POST(request: Request) {
  /* ── 1. RATE LIMIT, ABOVE EVERYTHING ────────────────────────────────────
   * 30 per 10s - the most generous bucket in the app, because a real door
   * scans continuously. See the note on SCAN_RATE_LIMIT. */
  const verdict = await limitScans(await identify(request));

  if (!verdict.success) {
    const retryAfter = Math.max(1, Math.ceil((verdict.reset - Date.now()) / 1000));
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Scanning too fast. Wait a moment and try again.",
        },
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "RateLimit-Limit": String(verdict.limit),
          "RateLimit-Remaining": String(verdict.remaining),
          "RateLimit-Reset": String(retryAfter),
        },
      },
    );
  }

  /* ── 2. AUTHENTICATE AND AUTHORISE ──────────────────────────────────── */
  const user = await getCurrentUser();
  if (!user) {
    return fail(401, "UNAUTHENTICATED", "Sign in as gate staff to scan tickets.");
  }
  if (user.role !== "staff" && user.role !== "organizer") {
    /* The role is read from the `users` table by getCurrentUser(), not from the
       JWT - so revoking someone's staff role takes effect on their very next
       scan rather than whenever their token happens to refresh. */
    return fail(403, "FORBIDDEN", "Only gate staff can scan tickets.");
  }

  /* ── 3. VALIDATE ────────────────────────────────────────────────────── */
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const parsed = scanSchema.safeParse(body);
  if (!parsed.success) {
    return fail(400, "VALIDATION_ERROR", "Send the scanned ticket code.");
  }

  /* ── 4. DECODE BEFORE ANY QUERY ─────────────────────────────────────── */
  const decoded = decodeTicketPayload(parsed.data.payload);
  if (!decoded) {
    /* Malformed: wrong length, wrong charset, unknown version byte. Answered
       identically to a bad signature so the endpoint reveals nothing about
       which codes are even shaped like real ones. No database work happened. */
    return NextResponse.json({ status: "forged" }, { status: 400 });
  }

  /* ── 5. VERIFY AND ADMIT, ATOMICALLY ────────────────────────────────── */
  try {
    const result = await checkInTicket(decoded);

    switch (result.outcome) {
      case "valid":
        console.log(
          `[scan] ADMIT ${result.seat.sectionName} ${result.seat.rowLabel}${result.seat.seatNo} ` +
            `— ${result.seat.eventTitle} — by ${user.email}`,
        );
        return NextResponse.json(
          {
            status: "valid",
            ticketId: result.seat.ticketId,
            section: result.seat.sectionName,
            row: result.seat.rowLabel,
            seat: result.seat.seatNo,
            event: result.seat.eventTitle,
            venue: `${result.seat.venueName}, ${result.seat.venueCity}`,
            startsAt: result.seat.startsAt.toISOString(),
            checkedInAt: result.checkedInAt.toISOString(),
          },
          { status: 200 },
        );

      case "already_scanned":
        /* Not an error on our side - the compare-and-set did its job. Logged at
           warn because at a real door this is the line someone will be asked
           about later. */
        console.warn(
          `[scan] REFUSED (already in) ${result.seat.sectionName} ` +
            `${result.seat.rowLabel}${result.seat.seatNo} — first scanned ` +
            `${result.scannedAt.toISOString()} — presented again to ${user.email}`,
        );
        return NextResponse.json(
          {
            status: "already_scanned",
            scannedAt: result.scannedAt.toISOString(),
            ticketId: result.seat.ticketId,
            section: result.seat.sectionName,
            row: result.seat.rowLabel,
            seat: result.seat.seatNo,
            event: result.seat.eventTitle,
            venue: `${result.seat.venueName}, ${result.seat.venueCity}`,
          },
          { status: 409 },
        );

      case "forged":
        /**
         * `unknown_ticket` is the interesting one and is logged loudly.
         *
         * To reach it, somebody produced a 44-character base64url string with a
         * correct version byte naming a uuid that is not in the table - so
         * either a row was deleted, or the payload format is being probed. A
         * `bad_signature` is the ordinary case: a tampered or invented code.
         *
         * The RESPONSE is identical either way. Telling a caller "that ticket
         * id exists but the signature is wrong" would hand them an oracle for
         * enumerating real tickets.
         */
        if (result.reason === "unknown_ticket") {
          console.error(
            `[scan] SECURITY well-formed payload for a ticket id that does not exist ` +
              `— presented to ${user.email}`,
          );
        } else {
          console.warn(`[scan] REFUSED (bad signature) — presented to ${user.email}`);
        }
        return NextResponse.json({ status: "forged" }, { status: 400 });
    }
  } catch (error) {
    /* A real failure, and it must not look like a forged ticket. The scanner
       paints this amber and says "could not verify", never red. */
    console.error("[scan] check-in failed unexpectedly", error);
    return fail(500, "SCAN_FAILED", "Could not verify that ticket. Try again.");
  }
}
