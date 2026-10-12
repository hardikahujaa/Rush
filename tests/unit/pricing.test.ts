import { describe, expect, it } from "vitest";

import { calculateTotalCents } from "@/lib/pricing";

/**
 * The shared total calculation `createHold` and `createPendingOrder` both
 * call. Money is always integer cents (CLAUDE.md) - these cases exist to
 * pin that down, not just "adds numbers up".
 */
describe("calculateTotalCents", () => {
  it("is 0 for no seats", () => {
    expect(calculateTotalCents([])).toBe(0);
  });

  it("returns the price of a single seat", () => {
    expect(calculateTotalCents([{ priceCents: 150000 }])).toBe(150000);
  });

  it("sums several seats, in integer cents", () => {
    const total = calculateTotalCents([
      { priceCents: 150000 },
      { priceCents: 250000 },
      { priceCents: 99900 },
    ]);
    expect(total).toBe(499900);
    expect(Number.isInteger(total)).toBe(true);
  });

  it("doesn't care about seat order", () => {
    const items = [{ priceCents: 10 }, { priceCents: 20 }, { priceCents: 30 }];
    expect(calculateTotalCents(items)).toBe(
      calculateTotalCents([...items].reverse()),
    );
  });
});
