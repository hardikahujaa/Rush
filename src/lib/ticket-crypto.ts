import "server-only";

import { timingSafeEqual } from "node:crypto";

import { signTicket } from "@/lib/qr";

/**
 * THE QR PAYLOAD CODEC (T30).
 *
 * ── WHAT A QR CODE ACTUALLY IS ──────────────────────────────────────────────
 * A picture of a string. Anyone can photograph one, decode the text with a free
 * app, change it, and render a new one. So a QR containing just a ticket id is
 * not a ticket - it is a suggestion. Increment the id and you have someone
 * else's seat.
 *
 * What makes it a credential is the HMAC: a hash of the ticket's identity mixed
 * with a secret only the server holds. The payload stays readable - that is
 * fine, there is nothing secret in a seat number - but nobody can produce a
 * VALID tag for a payload they invented, because they do not have the key.
 *
 * ── THE FORMAT: 33 BYTES, FIXED WIDTH, NO DELIMITERS ───────────────────────
 *
 *     byte 0      bytes 1..16        bytes 17..32
 *   ┌────────┬──────────────────┬──────────────────┐
 *   │ ver=1  │ ticketId (16 B)  │ tag (16 B)       │
 *   └────────┴──────────────────┴──────────────────┘
 *
 * base64url encoded, that is exactly 44 characters, which a QR encodes as
 * Version 3 (29x29 modules) at error-correction level M. Compare:
 *
 *     this format                      44 chars -> v3, 29x29
 *     {"o":"<uuid>","s":"<uuid>",...}  118 chars -> v6, 41x41
 *     "<uuid>:<64 hex chars>"          101 chars -> v5, 37x37
 *
 * Module count is what decides whether a phone screen scans instantly or makes
 * someone at the gate hold still and try again. Halving the grid is worth a
 * little bit-packing.
 *
 * ── WHY ONLY ticketId, NOT orderId AND seatId ──────────────────────────────
 * Both are derivable: the verifier loads the ticket row by `ticketId` and reads
 * `order_id` and `seat_id` straight off it, then recomputes the full HMAC over
 * all three. Putting them in the QR would cost 32 extra bytes to transmit data
 * the server already has.
 *
 * It would also buy nothing. The tempting argument is "then a scanner could
 * verify offline" - but check-in cannot work offline anyway. The whole point of
 * T31 is that the SECOND scan of a ticket must be refused, and that requires
 * shared state (`tickets.checked_in_at`), which means a database round trip no
 * matter what the QR contains.
 *
 * ── WHY THE TAG IS TRUNCATED TO 16 OF 32 BYTES ─────────────────────────────
 * Forging one means finding a valid 128-bit tag: 2^128 candidates, and every
 * single guess has to be checked online against our server, which T31 will rate
 * limit. Truncating an HMAC is standard practice and 128 bits is far above
 * anything brute-forceable.
 *
 * A side benefit worth having: the browser is handed only HALF the signature.
 * The full 256-bit `tickets.qr_signature` never leaves the database.
 *
 * ── COMPATIBILITY: NOTHING WAS RE-SIGNED ───────────────────────────────────
 * The tag is the first 16 bytes of the EXISTING
 * `signTicket(ticketId, orderId, seatId)` output - the same function T28's
 * webhook and `src/db/seed.ts` already use. This module does not reimplement
 * the HMAC, it truncates it. So all 345 ticket rows that existed before T30
 * remain valid, and `tickets.qr_signature` still describes what the QR carries.
 */

/** Bumped only if the byte layout changes. T31 rejects anything it does not know. */
const PAYLOAD_VERSION = 1;

const UUID_BYTES = 16;
const TAG_BYTES = 16;
const PAYLOAD_BYTES = 1 + UUID_BYTES + TAG_BYTES; // 33

/** base64url of 33 bytes, unpadded. Exactly 44 characters, always. */
export const PAYLOAD_CHARS = 44;

/**
 * The only shape a payload may have. Checked BEFORE decoding, because
 * `Buffer.from(s, "base64url")` is lenient - it quietly skips characters it
 * does not recognise rather than failing, so `"!!!!"` and a 900-character
 * string both "decode". Without this gate, malformed input would reach the
 * length check having already been silently reinterpreted.
 */
const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]{44}$/;

/* ── uuid <-> bytes ─────────────────────────────────────────────────────── */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid is 32 hex digits of real data; the dashes are punctuation. 36 -> 16. */
function uuidToBytes(uuid: string): Buffer {
  if (!UUID_PATTERN.test(uuid)) {
    throw new Error("ticket-crypto: not a uuid");
  }
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

function bytesToUuid(bytes: Buffer): string {
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ── encode ─────────────────────────────────────────────────────────────── */

/**
 * The string that goes into the QR image.
 *
 * Generated on the SERVER, always. The client receives this finished 44-char
 * string and nothing else - no secret, no full signature, no way to mint one
 * for a seat it was not given.
 */
export function encodeTicketPayload({
  ticketId,
  orderId,
  seatId,
}: {
  ticketId: string;
  orderId: string;
  seatId: string;
}): string {
  /* The existing signature, truncated - never a second HMAC implementation.
     If this file computed its own, the two could drift and every ticket in the
     database would quietly stop matching its own QR. */
  const fullSignature = signTicket(ticketId, orderId, seatId);
  const tag = Buffer.from(fullSignature, "hex").subarray(0, TAG_BYTES);

  const payload = Buffer.concat([
    Buffer.from([PAYLOAD_VERSION]),
    uuidToBytes(ticketId),
    tag,
  ]);

  return payload.toString("base64url");
}

/* ── decode ─────────────────────────────────────────────────────────────── */

export type DecodedTicketPayload = {
  ticketId: string;
  /** The 16 truncated HMAC bytes, as presented by the scanner. */
  tag: Buffer;
};

/**
 * Parse a scanned string, or return null.
 *
 * Returns null rather than throwing: a malformed scan is an ordinary event at a
 * gate (someone's boarding pass, a sticker, a product barcode), not an
 * exception. T31 maps null to INVALID_SIGNATURE.
 *
 * Deliberately validates in this order - shape, then size, then version - so
 * that **nothing reaches the database** until the input is known to be the right
 * shape. An endpoint that queries first and validates second is an endpoint
 * where anyone with a camera can make us do work.
 */
export function decodeTicketPayload(raw: unknown): DecodedTicketPayload | null {
  if (typeof raw !== "string") return null;
  if (!PAYLOAD_PATTERN.test(raw)) return null;

  const bytes = Buffer.from(raw, "base64url");
  if (bytes.length !== PAYLOAD_BYTES) return null;
  if (bytes[0] !== PAYLOAD_VERSION) return null;

  return {
    ticketId: bytesToUuid(bytes.subarray(1, 1 + UUID_BYTES)),
    tag: bytes.subarray(1 + UUID_BYTES),
  };
}

/* ── verify ─────────────────────────────────────────────────────────────── */

/**
 * Does this scanned tag match the ticket the database holds?
 *
 * `orderId` and `seatId` must come from the TICKET ROW, never from the scanned
 * payload - that is what makes the check meaningful. The attacker controls
 * everything in the QR; they do not control our table. Recomputing from stored
 * values and comparing against the presented tag is what detects a forged or
 * swapped payload.
 *
 * ── timingSafeEqual, NOT `===` ─────────────────────────────────────────────
 * A normal comparison returns as soon as two bytes differ, so a tag wrong in
 * byte 1 is rejected measurably faster than one wrong in byte 16. Given enough
 * attempts that difference leaks the correct tag a byte at a time. A
 * constant-time compare removes the signal.
 */
export function verifyTicketPayload({
  ticketId,
  orderId,
  seatId,
  tag,
}: {
  ticketId: string;
  orderId: string;
  seatId: string;
  tag: Buffer;
}): boolean {
  /* Length is checked before timingSafeEqual because it THROWS on a mismatch
     rather than returning false - and a thrown error here would become a 500,
     which tells an attacker their guess was the wrong shape. */
  if (tag.length !== TAG_BYTES) return false;

  const expected = Buffer.from(
    signTicket(ticketId, orderId, seatId),
    "hex",
  ).subarray(0, TAG_BYTES);

  return timingSafeEqual(expected, tag);
}
