/**
 * The architectural blueprint the seats sit inside.
 *
 * ── WHY SVG AND NOT A CLIP-PATH ────────────────────────────────────────────
 * The obvious way to draw a trapezium is `clip-path: polygon(...)` on a bordered
 * div. It does not work: clip-path cuts the border off with everything else, so
 * you get a wedge-shaped block with no outline at all - the exact opposite of
 * razor-thin structural walls.
 *
 * An inline SVG with `fill="none"` and a hairline stroke draws the wall itself.
 * `preserveAspectRatio="none"` lets the viewBox stretch to whatever the seating
 * block turns out to be, so the architecture tracks the seats at every
 * breakpoint instead of needing a matching set of media queries.
 *
 * The frame is decorative: the seats carry all the information, and a screen
 * reader gains nothing from a description of the walls, so the whole layer is
 * aria-hidden and sits behind the grid.
 */
export function VenueFrame({ venueType }: { venueType: "theater" | "stadium" }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <defs>
        {/* The glow on the screen/stage edge. Two stops fading to transparent at
            both ends so the line reads as lit rather than as a drawn rule. */}
        <linearGradient id="rush-emit" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FACC15" stopOpacity="0" />
          <stop offset="50%" stopColor="#FACC15" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#FACC15" stopOpacity="0" />
        </linearGradient>
        <filter id="rush-bloom" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {venueType === "theater" ? (
        <>
          {/* Auditorium walls: narrow at the screen, splaying toward the back. */}
          <path
            d="M 22 6 L 78 6 L 98 96 L 2 96 Z"
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth="0.4"
            vectorEffect="non-scaling-stroke"
          />
          {/* Aisle break between the front block and the rest. */}
          <path
            d="M 27 30 L 73 30"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="0.4"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        </>
      ) : (
        <>
          {/* Arena bowl: an outer wall and the inner rail around the floor. */}
          <ellipse
            cx="50"
            cy="52"
            rx="49"
            ry="46"
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth="0.4"
            vectorEffect="non-scaling-stroke"
          />
          <ellipse
            cx="50"
            cy="46"
            rx="30"
            ry="26"
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="0.4"
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  );
}

/**
 * The lit edge everything in the room faces.
 *
 * Rendered in normal flow rather than inside the SVG, because it carries a text
 * label that has to stay legible and selectable at every width - text inside a
 * `preserveAspectRatio="none"` viewBox is stretched along with the geometry and
 * becomes unreadable on wide screens.
 */
export function FocalEdge({ venueType }: { venueType: "theater" | "stadium" }) {
  if (venueType === "theater") {
    return (
      <div className="relative mx-auto w-full max-w-md px-4">
        <div
          aria-hidden="true"
          className="h-px w-full rounded-full"
          style={{
            background:
              "linear-gradient(90deg, transparent, #FACC15 18%, #FFE4B5 50%, #FACC15 82%, transparent)",
            boxShadow: "0 0 24px 2px rgba(250,204,21,0.45)",
          }}
        />
        <p className="mt-3 text-center text-[10px] font-medium uppercase tracking-[0.42em] text-gold-champagne/80">
          Screen
        </p>
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex w-full max-w-xs items-center justify-center">
      <div
        aria-hidden="true"
        className="flex h-16 w-full items-center justify-center rounded-[50%] border border-gold/45"
        style={{
          boxShadow:
            "0 0 34px -6px rgba(250,204,21,0.55), inset 0 0 24px -8px rgba(250,204,21,0.45)",
        }}
      >
        <span className="text-[10px] font-medium uppercase tracking-[0.42em] text-gold-champagne/85">
          Stage
        </span>
      </div>
    </div>
  );
}
