"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

import { CheckoutBar, MAX_SEATS } from "@/components/seats/checkout-bar";
import { SeatButton, keepClearOfCart } from "@/components/seats/seat-button";
import { TierLegend } from "@/components/seats/tier-legend";
import { FocalEdge, VenueFrame } from "@/components/seats/venue-frame";
import type { Seat, TierWithStats, VenueType } from "@/lib/mock-data";
import { formatPaise } from "@/lib/mock-events";

/** Seats grouped into their rows, in front-to-back reading order. */
type Row = { key: string; label: string; seats: Seat[] };

function groupRows(tierId: string, seats: Seat[]): Row[] {
  const byRow = new Map<string, Seat[]>();
  for (const seat of seats) {
    if (seat.tierId !== tierId) continue;
    const bucket = byRow.get(seat.row);
    if (bucket) bucket.push(seat);
    else byRow.set(seat.row, [seat]);
  }
  return [...byRow.entries()].map(([label, rowSeats]) => ({
    key: `${tierId}-${label}`,
    label,
    seats: rowSeats,
  }));
}

/**
 * The interactive venue.
 *
 * ── WHY THE SEATS ARRIVE AS A PROP ─────────────────────────────────────────
 * The grid is built on the server and passed down. The client never generates
 * it, because a second generation would be a second source of truth - and the
 * one thing this task is about is that there is exactly one.
 *
 * ── WHY SELECTION IS AN ARRAY AND NOT A Set ────────────────────────────────
 * Order matters in the cart: seats appear in the sequence they were picked, so
 * removing the third chip removes the seat the user picked third. A Set has no
 * order to rely on.
 */
export function SeatMap({
  venueType,
  tiers,
  seats,
}: {
  venueType: VenueType;
  tiers: TierWithStats[];
  seats: Seat[];
}) {
  const [selected, setSelected] = useState<Seat[]>([]);
  /* A counter, not a boolean: re-keying the shake on each refusal is what makes
     the second rejected click animate as well as the first. */
  const [limitHit, setLimitHit] = useState(0);
  const reduceMotion = useReducedMotion();

  const tiersById = useMemo(
    () => new Map(tiers.map((tier) => [tier.id, tier])),
    [tiers],
  );
  const selectedIds = useMemo(
    () => new Set(selected.map((seat) => seat.id)),
    [selected],
  );

  function toggle(seat: Seat) {
    setSelected((current) => {
      const existing = current.findIndex((s) => s.id === seat.id);
      if (existing !== -1) {
        setLimitHit(0); // freeing a seat clears the refusal notice
        return current.filter((s) => s.id !== seat.id);
      }
      if (current.length >= MAX_SEATS) {
        setLimitHit((n) => n + 1);
        return current; // the click is refused, not queued
      }
      return [...current, seat];
    });
  }

  function remove(seat: Seat) {
    setLimitHit(0);
    setSelected((current) => current.filter((s) => s.id !== seat.id));
  }

  /** One admission from a standing tier: the next unclaimed spot in the zone. */
  function addStanding(tierId: string) {
    const next = seats.find(
      (s) => s.tierId === tierId && s.status === "available" && !selectedIds.has(s.id),
    );
    if (next) toggle(next);
  }

  return (
    <>
      <TierLegend tiers={tiers} />

      {/*
        THE MAP FLOOR.

        Pure #000000, not a glass panel and not a lifted card. The architecture
        is drawn in hairlines at 6-10% white, and any backdrop blur or raised
        surface behind them would drown lines that thin. Glass is reserved for
        the legend above and the cart below, which are chrome floating over the
        room rather than part of it.
      */}
      <div className="relative mt-6 overflow-hidden rounded-2xl border border-white/10 bg-black">
        <div className="px-4 pt-8 sm:px-6">
          <FocalEdge venueType={venueType} />
        </div>

        {/*
          The map scrolls inside its own box. A widest row is 22 seats -
          roughly 700px - which cannot fit a 375px phone at a tappable seat
          size. Shrinking the seats to fit would break the 24px pointer-target
          floor, so the container scrolls horizontally and the PAGE does not.
        */}
        <div className="overflow-x-auto overscroll-x-contain px-4 pb-10 pt-6 sm:px-6">
          <div className="relative mx-auto w-max min-w-full">
            <VenueFrame venueType={venueType} />

            <div className="relative flex flex-col items-center gap-6 py-4">
              {tiers.map((tier) => {
                /* ── STANDING: a zone, not seats ───────────────────────── */
                if (tier.isStanding) {
                  const left = tier.stats.available;
                  const chosen = selected.filter((s) => s.tierId === tier.id).length;

                  return (
                    <div key={tier.id} className="w-full px-2">
                      <motion.button
                        type="button"
                        disabled={left === 0 || left - chosen === 0}
                        onClick={() => addStanding(tier.id)}
                        onFocus={(e) => keepClearOfCart(e.currentTarget)}
                        whileTap={reduceMotion ? undefined : { scale: 0.99 }}
                        className="group/zone flex h-20 w-full items-center justify-center rounded-xl border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-45"
                        style={{
                          borderColor: tier.color,
                          /* Diagonal hatching in the tier's own colour: a
                             standing area is a region you occupy, not a seat
                             you are assigned, and the texture says that
                             without a caption. */
                          backgroundImage: `repeating-linear-gradient(45deg, ${tier.color}22 0 6px, transparent 6px 14px)`,
                        }}
                        aria-label={`${tier.name}, ${formatPaise(tier.priceCents)} per admission, ${left} available. Add one admission.`}
                      >
                        <span className="text-center">
                          <span
                            className="block text-[11px] font-semibold uppercase tracking-[0.28em]"
                            style={{ color: tier.color }}
                          >
                            {tier.name}
                          </span>
                          <span className="mt-1 block text-[11px] text-muted-foreground">
                            {left === 0 ? (
                              "Sold out"
                            ) : (
                              <>
                                <span className="tabular-nums">{left}</span> admissions left
                                {chosen > 0 && (
                                  <span className="tabular-nums text-gold-champagne">
                                    {" "}· {chosen} in cart
                                  </span>
                                )}
                              </>
                            )}
                          </span>
                        </span>
                      </motion.button>
                    </div>
                  );
                }

                /* ── SEATED: rows of individual seats ──────────────────── */
                const rows = groupRows(tier.id, seats);

                return (
                  <div key={tier.id} className="flex flex-col items-center gap-1.5">
                    <p
                      className="mb-1 text-[10px] font-medium uppercase tracking-[0.3em]"
                      style={{ color: tier.color }}
                    >
                      {tier.name}
                    </p>

                    {rows.map((row) => (
                      <div key={row.key} className="flex items-center gap-2">
                        <RowLabel label={row.label} />
                        <div className="flex gap-1">
                          {row.seats.map((seat, index) => (
                            <SeatWrapper
                              key={seat.id}
                              index={index}
                              count={row.seats.length}
                              venueType={venueType}
                            >
                              <SeatButton
                                seat={seat}
                                tier={tier}
                                selected={selectedIds.has(seat.id)}
                                onToggle={toggle}
                              />
                            </SeatWrapper>
                          ))}
                        </div>
                        <RowLabel label={row.label} />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Status key, so the four fills are legible without hovering a seat. */}
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
        <Key swatch={{ backgroundColor: "#1A1A1A", borderColor: "#A8A29E" }} label="Available" />
        <Key swatch={{ backgroundColor: "#FACC15", borderColor: "#FACC15" }} label="Selected" />
        <Key
          swatch={{ backgroundColor: "rgba(245,158,11,0.20)", borderColor: "rgba(245,158,11,0.45)" }}
          label="On hold"
        />
        <Key
          swatch={{ backgroundColor: "#000000", borderColor: "rgba(255,255,255,0.05)" }}
          label="Sold"
        />
      </ul>

      <CheckoutBar
        selected={selected}
        tiersById={tiersById}
        onRemove={remove}
        limitHit={limitHit}
      />
    </>
  );
}

function RowLabel({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="w-4 shrink-0 text-center text-[9px] font-medium tabular-nums text-white/25"
    >
      {label}
    </span>
  );
}

function Key({ swatch, label }: { swatch: React.CSSProperties; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden="true" className="size-3.5 rounded-[4px] border" style={swatch} />
      {label}
    </li>
  );
}

/**
 * Bends a flat flex row into an arc for arena venues.
 *
 * ── WHY A TRANSFORM AND NOT ABSOLUTE POSITIONING ───────────────────────────
 * The textbook radial layout positions every seat absolutely at
 * `rotate(θ) translate(r)`. That works, and it also hard-codes the container's
 * size in pixels, so the bowl stops matching its box the moment the layout
 * changes. Offsetting flex children instead keeps normal flow doing the
 * spacing - the row stays a row, it is just curved.
 *
 * Every row uses the same parabola, so the arcs stay parallel and rows never
 * collide no matter how deep the bowl gets. `transform` is also composited, so
 * bending 286 seats costs no layout work.
 *
 * The ends rise rather than fall: with the stage at the top, seats at the edges
 * of a row wrap up alongside it, which is the geometry of a real bowl.
 */
function SeatWrapper({
  index,
  count,
  venueType,
  children,
}: {
  index: number;
  count: number;
  venueType: VenueType;
  children: React.ReactNode;
}) {
  if (venueType !== "stadium" || count < 2) return <>{children}</>;

  /* -1 at the left end, 0 at centre, +1 at the right end. */
  const nx = (index / (count - 1)) * 2 - 1;

  return (
    <span
      className="inline-flex"
      style={{
        transform: `translateY(${(-28 * nx * nx).toFixed(2)}px) rotate(${(nx * 16).toFixed(2)}deg)`,
      }}
    >
      {children}
    </span>
  );
}
