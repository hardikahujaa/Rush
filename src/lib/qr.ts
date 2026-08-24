import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signing for gate tickets (T30 / T31).
 *
 * A QR code is just a picture of a string - anyone can photograph one, read the
 * text out of it, and generate their own. So the QR cannot simply contain a
 * ticket id: change the digits and you have someone else's ticket.
 *
 * Instead we attach an HMAC - a hash of the ticket's identity mixed with a
 * secret only the server knows. Anyone can read the payload, but nobody can
 * produce a valid signature for a payload they invented, because they do not
 * have the secret. The scanner recomputes the HMAC and compares.
 *
 * This is the same reason a signature on a cheque matters more than the numbers
 * printed on it.
 */

function secret(): string {
  const s = process.env.QR_SIGNING_SECRET;
  if (!s) throw new Error("QR_SIGNING_SECRET is not set");
  return s;
}

/** The exact bytes we sign. Order matters - keep it stable forever. */
function payload(ticketId: string, orderId: string, seatId: string): string {
  return `${ticketId}.${orderId}.${seatId}`;
}

export function signTicket(
  ticketId: string,
  orderId: string,
  seatId: string,
): string {
  return createHmac("sha256", secret())
    .update(payload(ticketId, orderId, seatId))
    .digest("hex");
}

/**
 * Compared with `timingSafeEqual` rather than `===`.
 *
 * A normal string comparison bails out at the first differing character, so it
 * returns fractionally faster for a signature that is wrong at position 1 than
 * one wrong at position 40. Measure enough attempts and that timing difference
 * leaks the correct signature one character at a time. A timing-safe compare
 * always takes the same duration.
 */
export function verifyTicket(
  ticketId: string,
  orderId: string,
  seatId: string,
  signature: string,
): boolean {
  const expected = signTicket(ticketId, orderId, seatId);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
