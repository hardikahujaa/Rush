import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The RUSH wordmark.
 *
 * Four rising bars replace nothing and mean something: they read as a level
 * meter climbing, which is the shape of demand building toward a drop. The last
 * bar is the accent and is the tallest - the moment it all tips over.
 *
 * Tight negative tracking on a heavy weight is doing the rest of the work.
 * Ticketing brands tend to look like transit signage, and that is the register
 * being aimed at here.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "group flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      aria-label="RUSH — home"
    >
      <span className="flex items-end gap-[2px]" aria-hidden="true">
        {[6, 10, 8, 14].map((h, i) => (
          <span
            key={i}
            className={cn(
              "w-[3px] rounded-[1px] transition-all duration-300",
              i === 3
                ? "bg-primary group-hover:h-4"
                : "bg-foreground/35 group-hover:bg-foreground/60",
            )}
            style={{ height: h }}
          />
        ))}
      </span>
      <span className="text-lg font-semibold tracking-[-0.04em] text-foreground">
        RUSH
      </span>
    </Link>
  );
}
