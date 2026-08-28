"use client";

import { motion, useReducedMotion } from "framer-motion";

import type { Seat, Tier } from "@/lib/mock-data";
import { formatPaise } from "@/lib/mock-events";

/**
 * Scroll a newly focused seat out from under the checkout bar.
 *
 * WCAG 2.2 AA 2.4.11 requires that author content not hide the focused control.
 * The browser does not solve this for us: it only scrolls on focus when the
 * element is OUTSIDE the viewport, and a seat sitting behind a `position: fixed`
 * bar is technically inside it. So the browser leaves it there, invisible, while
 * the user keyboards into seats they cannot see.
 *
 * `scroll-margin` and `scroll-padding` do not help either - both only take
 * effect during a scroll the browser has already decided to perform.
 *
 * Measured live rather than read from a constant, because the bar grows as seat
 * chips wrap onto a second row.
 */
export function keepClearOfCart(el: HTMLElement) {
  const bar = document.querySelector("[data-checkout-bar]");
  if (!bar) return;

  const overlap = el.getBoundingClientRect().bottom + 12 - bar.getBoundingClientRect().top;
  // `auto`, not `smooth`: focus should land where the user can see it
  // immediately, and a glide competes with their next keypress.
  if (overlap > 0) window.scrollBy({ top: overlap, behavior: "auto" });
}

/**
 * One seat.
 *
 * ── WHY THE BORDER CARRIES THE TIER AND THE FILL CARRIES THE STATE ─────────
 * A seat has to answer two questions at a glance: what does it cost, and can I
 * have it. Those are independent, so they get independent visual channels -
 * border hue for the price band, fill for availability. Encoding both in one
 * channel would make "cheap and taken" indistinguishable from "expensive and
 * free" at 28 pixels.
 *
 * ── WHY DISABLED IS A REAL ATTRIBUTE, NOT JUST A STYLE ─────────────────────
 * Sold and held seats use the `disabled` attribute rather than an onClick guard.
 * That removes them from the tab order, which matters enormously here: a house
 * of 286 seats with 12 free means a keyboard user tabs 12 times to reach every
 * option instead of 286 times to reach mostly dead ends.
 *
 * ── WHY z-INDEX IS BOUND TO SELECTION ──────────────────────────────────────
 * The selected seat scales past its own box. Without a raised z-index it grows
 * *underneath* its neighbours and looks clipped rather than lifted. The value is
 * applied only while selected so the stacking context is not permanently raised
 * across 286 elements.
 */
export function SeatButton({
  seat,
  tier,
  selected,
  onToggle,
}: {
  seat: Seat;
  tier: Tier;
  selected: boolean;
  onToggle: (seat: Seat) => void;
}) {
  const reduceMotion = useReducedMotion();
  const unavailable = seat.status !== "available";

  const label = `${tier.name}, row ${seat.row}, seat ${seat.number}, ${formatPaise(
    tier.priceCents,
  )}, ${
    seat.status === "sold"
      ? "sold"
      : seat.status === "held"
        ? "on hold, unavailable"
        : selected
          ? "selected"
          : "available"
  }`;

  /* Fill and border per state. Kept as one lookup rather than a chain of
     conditional classes so every state is legible side by side. */
  const skin = selected
    ? { backgroundColor: "#FACC15", borderColor: "#FACC15", color: "#0A0A0A" }
    : seat.status === "sold"
      ? { backgroundColor: "#000000", borderColor: "rgba(255,255,255,0.05)", color: "transparent" }
      : seat.status === "held"
        ? { backgroundColor: "rgba(245,158,11,0.20)", borderColor: "rgba(245,158,11,0.45)", color: "transparent" }
        : { backgroundColor: "#1A1A1A", borderColor: tier.color, color: "transparent" };

  return (
    <motion.button
      type="button"
      disabled={unavailable}
      onClick={() => onToggle(seat)}
      onFocus={(e) => keepClearOfCart(e.currentTarget)}
      aria-label={label}
      aria-pressed={selected}
      /* 28px square: above the 24x24 CSS px floor for a pointer target, with a
         4px gutter between neighbours so a slightly-off tap does not buy the
         wrong seat. */
      className={[
        "relative flex size-7 shrink-0 items-center justify-center rounded-[5px] border text-[9px] font-semibold outline-none",
        "focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black",
        unavailable ? "cursor-not-allowed" : "cursor-pointer",
        seat.status === "held" && !reduceMotion ? "animate-pulse" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ...skin, zIndex: selected ? 50 : undefined }}
      animate={{ scale: selected && !reduceMotion ? 1.1 : 1 }}
      transition={{ type: "spring", stiffness: 520, damping: 24 }}
      whileHover={unavailable || reduceMotion ? undefined : { scale: selected ? 1.1 : 1.06 }}
      whileTap={unavailable || reduceMotion ? undefined : { scale: 0.94 }}
    >
      {/* The number is only painted when selected. Rendering it always would put
          286 pieces of 9px text on screen competing with the shape language;
          on the chosen seat it confirms exactly what is in the cart. */}
      <span aria-hidden="true">{selected ? seat.number : ""}</span>
    </motion.button>
  );
}
