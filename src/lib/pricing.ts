/**
 * The one place a set of line items becomes a total.
 *
 * Pulled out of `createHold` and `createPendingOrder`, which each had the
 * identical `.reduce((sum, item) => sum + item.priceCents, 0)` inline. Having
 * it twice meant two places that had to agree forever on what "the total"
 * means; having it once means there is only one definition to test.
 *
 * Deliberately just a sum, not a formatter: `priceCents` is already an
 * integer (CLAUDE.md's money rule - cents, never floats), so plain addition
 * cannot introduce rounding error the way summing rupee floats would.
 */
export function calculateTotalCents(items: { priceCents: number }[]): number {
  return items.reduce((sum, item) => sum + item.priceCents, 0);
}
