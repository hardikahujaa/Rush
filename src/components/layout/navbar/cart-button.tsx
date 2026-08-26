import Link from "next/link";
import { Ticket } from "lucide-react";

/**
 * Held-tickets indicator.
 *
 * Labelled "tickets", not "cart" - what sits here is a set of seats held for
 * ten minutes, which is a different promise from a basket that waits
 * indefinitely. Naming it after the mechanism people actually experience is the
 * honest choice.
 *
 * TODO(Phase 2+): drive `count` from live holds and add the expiry ring.
 */
export function CartButton({ count = 0 }: { count?: number }) {
  return (
    <Link
      href="/tickets"
      aria-label={count > 0 ? `Your tickets, ${count} seats held` : "Your tickets"}
      className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Ticket className="size-[18px]" aria-hidden="true" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-gold px-1 text-[10px] font-semibold tabular-nums text-primary-foreground"
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
