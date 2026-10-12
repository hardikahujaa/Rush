import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decodeTicketPayload,
  encodeTicketPayload,
  PAYLOAD_CHARS,
  verifyTicketPayload,
} from "@/lib/ticket-crypto";

/**
 * T30's 33-byte QR payload codec (`src/lib/ticket-crypto.ts`): encode on the
 * server, decode+verify at the gate (T31). `decodeTicketPayload` must never
 * throw on bad input - a malformed scan at a gate is routine, not
 * exceptional - so most of this file is "garbage in -> null out, not a crash".
 */
describe("encodeTicketPayload / decodeTicketPayload", () => {
  it("round-trips: decoding an encoded payload returns the original ticketId", () => {
    const ticketId = randomUUID();
    const orderId = randomUUID();
    const seatId = randomUUID();

    const encoded = encodeTicketPayload({ ticketId, orderId, seatId });
    expect(encoded).toHaveLength(PAYLOAD_CHARS);

    const decoded = decodeTicketPayload(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.ticketId).toBe(ticketId);
  });

  it("produces a different payload for a different ticket", () => {
    const orderId = randomUUID();
    const seatId = randomUUID();
    const a = encodeTicketPayload({ ticketId: randomUUID(), orderId, seatId });
    const b = encodeTicketPayload({ ticketId: randomUUID(), orderId, seatId });
    expect(a).not.toBe(b);
  });

  it.each([
    ["not a string", 12345],
    ["wrong length", "short"],
    ["wrong character set", "!".repeat(PAYLOAD_CHARS)],
    [
      "right length, wrong version byte",
      // 44 valid base64url chars that don't happen to decode to version 1.
      "A".repeat(PAYLOAD_CHARS),
    ],
  ])("returns null, not a throw, for %s", (_label, input) => {
    expect(() => decodeTicketPayload(input)).not.toThrow();
    expect(decodeTicketPayload(input)).toBeNull();
  });
});

describe("verifyTicketPayload", () => {
  it("accepts the tag that matches the stored ticket/order/seat", () => {
    const ticketId = randomUUID();
    const orderId = randomUUID();
    const seatId = randomUUID();

    const encoded = encodeTicketPayload({ ticketId, orderId, seatId });
    const decoded = decodeTicketPayload(encoded)!;

    expect(
      verifyTicketPayload({ ticketId, orderId, seatId, tag: decoded.tag }),
    ).toBe(true);
  });

  it("rejects a tag with one flipped bit", () => {
    const ticketId = randomUUID();
    const orderId = randomUUID();
    const seatId = randomUUID();

    const encoded = encodeTicketPayload({ ticketId, orderId, seatId });
    const decoded = decodeTicketPayload(encoded)!;
    const flipped = Buffer.from(decoded.tag);
    flipped[0] ^= 0xff;

    expect(
      verifyTicketPayload({ ticketId, orderId, seatId, tag: flipped }),
    ).toBe(false);
  });

  it("rejects a tag that belongs to a different ticket", () => {
    const orderId = randomUUID();
    const seatId = randomUUID();

    const mine = decodeTicketPayload(
      encodeTicketPayload({ ticketId: randomUUID(), orderId, seatId }),
    )!;
    const someoneElses = decodeTicketPayload(
      encodeTicketPayload({ ticketId: randomUUID(), orderId, seatId }),
    )!;

    expect(
      verifyTicketPayload({
        ticketId: someoneElses.ticketId,
        orderId,
        seatId,
        tag: mine.tag,
      }),
    ).toBe(false);
  });

  it("rejects a wrong-length tag without throwing", () => {
    expect(
      verifyTicketPayload({
        ticketId: randomUUID(),
        orderId: randomUUID(),
        seatId: randomUUID(),
        tag: Buffer.from("too short"),
      }),
    ).toBe(false);
  });
});
