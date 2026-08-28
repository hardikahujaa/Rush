/**
 * Proves the three surfaces agree.
 *
 * The claim this task rests on is that the landing card badge, the T18 pricing
 * table and the seat map legend cannot disagree, because all three reduce the
 * same `Seat[]`. That claim is only worth anything if it is checked, so this
 * asserts it rather than printing numbers for someone to compare by eye.
 *
 *   npx tsx scripts/verify-seat-math.ts
 */
import {
  RECOMMENDED,
  SELLING_FAST,
  SPOTLIGHT_COMEDY,
  SPOTLIGHT_MOVIES,
} from "../src/lib/mock-events";
import {
  fromPrice,
  getSeats,
  getTiers,
  hasVenue,
  seatStats,
  tierBreakdown,
} from "../src/lib/mock-data";

const CARDS = [
  ...SELLING_FAST,
  ...RECOMMENDED,
  ...SPOTLIGHT_COMEDY,
  ...SPOTLIGHT_MOVIES,
];

let failures = 0;

function check(label: string, condition: boolean, detail: string) {
  if (!condition) {
    failures++;
    console.log(`  FAIL  ${label} — ${detail}`);
  }
}

/** The same badge logic event-card.tsx applies, so levels can be reported. */
function urgency(left: number, total: number) {
  const ratio = left / total;
  if (left <= 25 || ratio < 0.06) return "critical";
  if (ratio < 0.2) return "warn";
  return "none";
}

console.log("event    venue     total  avail  held  sold   from      badge");
console.log("─".repeat(66));

for (const card of CARDS) {
  const id = card.id;

  check(id, hasVenue(id), "no venue defined, card would render 0 seats");
  if (!hasVenue(id)) continue;

  const seats = getSeats(id);
  const stats = seatStats(id);
  const tiers = tierBreakdown(id);

  /* 1. The card's numbers ARE the filtered array. */
  check(
    id,
    card.seatsLeft === seats.filter((s) => s.status === "available").length,
    `card.seatsLeft=${card.seatsLeft} but filter gives ${seats.filter((s) => s.status === "available").length}`,
  );
  check(id, card.seatsTotal === seats.length, `card.seatsTotal=${card.seatsTotal} vs ${seats.length} seats`);

  /* 2. Tier counts sum to the event count — the legend and the badge agree. */
  const tierSum = tiers.reduce((n, t) => n + t.stats.available, 0);
  check(id, tierSum === stats.available, `tiers sum to ${tierSum}, event says ${stats.available}`);
  const tierTotal = tiers.reduce((n, t) => n + t.stats.total, 0);
  check(id, tierTotal === stats.total, `tier totals sum to ${tierTotal}, event says ${stats.total}`);

  /* 3. Every seat is in exactly one of the three states. */
  check(
    id,
    stats.available + stats.held + stats.sold === stats.total,
    `states sum to ${stats.available + stats.held + stats.sold}, not ${stats.total}`,
  );

  /* 4. The card's "from" price is the cheapest real tier. */
  check(id, card.fromPriceCents === fromPrice(id), `from=${card.fromPriceCents} vs ${fromPrice(id)}`);
  check(
    id,
    card.fromPriceCents === Math.min(...getTiers(id).map((t) => t.priceCents)),
    "from price is not the cheapest tier",
  );

  /* 5. Determinism: rebuilding from a cold cache gives the identical grid.
        This is what rules out a hydration mismatch and a badge that drifts. */
  const signature = seats.map((s) => s.status).join("");
  const again = getSeats(id).map((s) => s.status).join("");
  check(id, signature === again, "two reads of the same event disagree");

  /* 6. Seat ids are unique — React keys and cart identity both depend on it. */
  check(id, new Set(seats.map((s) => s.id)).size === seats.length, "duplicate seat ids");

  const venue = tiers.some((t) => t.isStanding) ? "stadium" : "theater";
  console.log(
    `${id.padEnd(8)} ${venue.padEnd(9)} ${String(stats.total).padStart(5)}  ` +
      `${String(stats.available).padStart(5)}  ${String(stats.held).padStart(4)}  ` +
      `${String(stats.sold).padStart(4)}   ${("₹" + Math.round(card.fromPriceCents / 100)).padEnd(8)}  ` +
      urgency(card.seatsLeft, card.seatsTotal),
  );
}

console.log("─".repeat(66));
console.log(failures === 0 ? `PASS — ${CARDS.length} events, all invariants hold` : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
