import { describe, expect, it } from "vitest";

import { signTicket, verifyTicket } from "@/lib/qr";

/**
 * T30/T31's HMAC signing (`src/lib/qr.ts`). A QR code is just a picture of a
 * string, so the whole guarantee that a ticket can't be forged rests on this
 * module: anyone can read the payload, nobody can produce a valid signature
 * for one they invented, because they don't have `QR_SIGNING_SECRET`.
 */
describe("signTicket", () => {
  it("is deterministic for the same inputs", () => {
    const a = signTicket("ticket-1", "order-1", "seat-1");
    const b = signTicket("ticket-1", "order-1", "seat-1");
    expect(a).toBe(b);
  });

  it("changes when any one of the three inputs changes", () => {
    const base = signTicket("ticket-1", "order-1", "seat-1");

    expect(signTicket("ticket-2", "order-1", "seat-1")).not.toBe(base);
    expect(signTicket("ticket-1", "order-2", "seat-1")).not.toBe(base);
    expect(signTicket("ticket-1", "order-1", "seat-2")).not.toBe(base);
  });
});

describe("verifyTicket", () => {
  it("accepts the genuine signature", () => {
    const sig = signTicket("ticket-1", "order-1", "seat-1");
    expect(verifyTicket("ticket-1", "order-1", "seat-1", sig)).toBe(true);
  });

  it("rejects a tampered signature of the same length", () => {
    const sig = signTicket("ticket-1", "order-1", "seat-1");
    const tampered = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    expect(verifyTicket("ticket-1", "order-1", "seat-1", tampered)).toBe(
      false,
    );
  });

  it("rejects a signature that doesn't match these inputs", () => {
    const sigForOtherSeat = signTicket("ticket-1", "order-1", "seat-2");
    expect(
      verifyTicket("ticket-1", "order-1", "seat-1", sigForOtherSeat),
    ).toBe(false);
  });

  it("rejects a wrong-length signature without throwing", () => {
    expect(verifyTicket("ticket-1", "order-1", "seat-1", "too-short")).toBe(
      false,
    );
  });
});
