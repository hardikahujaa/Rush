/**
 * T41 — the shared shape behind most of this app's new `loading.tsx` files.
 *
 * ── WHY A SKELETON, NOT A SPINNER ───────────────────────────────────────────
 * `events/loading.tsx` (T17) already settled this for the one page that had
 * a loading state before T41: a centred spinner occupies none of the final
 * layout's space, so everything shifts the instant the real content swaps
 * in. A block shaped like the page that is coming - same heading, same
 * body rhythm - lands without the jump. Every file below follows that,
 * rather than reverting to a spinner for the pages T41 is the first to cover.
 *
 * ── WHY ONE CONFIGURABLE COMPONENT RATHER THAN THIRTEEN BESPOKE ONES ──────
 * The pages this covers - `/dashboard`, `/organizer`, `/forbidden`,
 * `/scan`, `/login`, `/signup`, the queue lobby - are simple: a heading, a
 * line or two of body text, sometimes a button. Hand-building thirteen
 * subtly-different skeletons for that shape would be the kind of repetition
 * T40 was just spent removing. The handful of pages with genuinely rich,
 * distinct layouts (the homepage, the event detail page, the seat map, the
 * ticket list, the organizer dashboard) get their own bespoke skeleton in
 * their own `loading.tsx` instead - this component is deliberately not used
 * there, because forcing a rich layout through a generic shape would be the
 * same mismatch in the other direction.
 *
 * `motion-safe:animate-pulse` is Tailwind's pulse, which does NOT honour
 * `prefers-reduced-motion` on its own - the `motion-safe:` variant is what
 * does, matching the approach already used for the hold countdown and for
 * `events/loading.tsx` itself. A reduced-motion visitor gets the same
 * layout, without the breathing.
 */
export function PageSkeleton({
  label,
  headingWidth = "12rem",
  lines = 1,
  cta = false,
}: {
  /** Announced once to screen readers; the skeleton itself is `aria-hidden`. */
  label: string;
  headingWidth?: string;
  lines?: number;
  cta?: boolean;
}) {
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {label}
      </p>

      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="h-8 rounded-lg bg-white/[0.06]" style={{ width: headingWidth }} />
        <div className="mt-4 space-y-2.5">
          {Array.from({ length: lines }, (_, i) => (
            <div
              key={i}
              className="h-4 rounded bg-white/[0.04]"
              style={{ width: i === lines - 1 ? "60%" : "90%" }}
            />
          ))}
        </div>
        {cta && (
          <div className="mt-7 h-11 w-40 rounded-xl bg-white/[0.06]" />
        )}
      </div>
    </>
  );
}
