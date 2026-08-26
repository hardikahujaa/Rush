import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The RUSH wordmark. Purely typographic, purely code - no image, no icon font.
 *
 * Built as three stacked treatments rather than one flat colour:
 *   1. the word in a cool metallic gradient (white at the cap, silver at the
 *      baseline) so it reads as a milled surface catching the room light
 *   2. a champagne underline that fades left to right, echoing the light
 *      spilling across the floor in the lobby
 *   3. a single gold accent bar - the only saturated element, which is what
 *      keeps a two-colour mark from looking like plain white text
 *
 * Tight negative tracking at a heavy weight does the rest. Ticketing brands
 * tend toward transit signage; this is aiming at the plate on a hotel door.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="RUSH — home"
      className={cn(
        // py-2 is not decoration: the wordmark box is 21px tall, below the 24x24
        // CSS px minimum, so the link needs padding to be a legal target.
        "group/logo relative flex shrink-0 items-center gap-2 rounded-lg py-2 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background",
        className,
      )}
    >
      <span className="relative inline-block">
        <span className="text-metal block text-[21px] font-extrabold leading-none tracking-[-0.06em]">
          RUSH
        </span>
        {/* Light spill under the wordmark. */}
        <span
          aria-hidden="true"
          className="absolute -bottom-[3px] left-0 h-px w-full opacity-70 transition-opacity duration-300 group-hover/logo:opacity-100"
          style={{
            backgroundImage:
              "linear-gradient(90deg, var(--gold-champagne), var(--gold) 45%, transparent 95%)",
          }}
        />
      </span>

      {/* The accent mark. Skewed to lean into the word, the way the motion
          streak on a luggage tag does. */}
      <span
        aria-hidden="true"
        className="h-3.5 w-[3px] shrink-0 rounded-[1px] [transform:skewX(-12deg)] transition-all duration-300 group-hover/logo:h-4"
        style={{
          background:
            "linear-gradient(180deg, var(--gold-champagne), var(--gold-deep))",
          boxShadow: "0 0 10px -1px oklch(0.786 0.153 74 / 70%)",
        }}
      />
    </Link>
  );
}
