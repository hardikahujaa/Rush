import Link from "next/link";
import { CalendarDays, MapPin } from "lucide-react";

import { SeatCounter } from "@/components/home/seat-counter";
import { formatPaise } from "@/lib/format";
/**
 * What this card needs, independent of where the row came from.
 *
 * It used to be typed as `MockEvent`, which quietly made the mock catalogue the
 * definition of a renderable event - so the real database rows could not use
 * this card without inventing a `subtitle` and a `category` they do not have
 * columns for. Widening it here lets the "Live now" rail render genuine
 * Postgres events through the exact same component, which is the point: a real
 * event and a demo one must be visually indistinguishable, or the rail is a
 * second design to maintain.
 */
export type EventCardData = {
  id: string;
  title: string;
  subtitle?: string | null;
  category?: string | null;
  venue: string;
  city: string;
  /** ISO string. */
  startsAt: string;
  hues: [number, number];
  tag?: "trending" | "just-announced" | "final-release";
  fromPriceCents: number;
  seatsLeft: number;
  seatsTotal: number;
  /**
   * Where this event is in its lifecycle, derived in `getEventCards` from
   * `status` + `drop_at` + `starts_at` together - the same composite test
   * `createHold` applies. It drives two things a card cannot fake: the status
   * badge, and WHERE the card links (see the note on the Link below).
   */
  state?: "on-sale" | "upcoming" | "past";
  /** ISO string. Only meaningful while `state === "upcoming"`. */
  dropAt?: string;
};
import { cn } from "@/lib/utils";

/** "Sat, 4 Sep · 7:30 PM" */
function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

/**
 * "Drops in 3d" / "Drops in 5h" - coarse on purpose.
 *
 * Rendered on the SERVER, so it is a static string by the time it reaches the
 * browser and cannot cause a hydration mismatch. Deliberately granular to the
 * day or hour rather than the second: a live-ticking countdown belongs on the
 * detail page (T18 already has one, as a client component with a stable server
 * snapshot), and a card in a scrolling rail re-rendering every second would be
 * waste for no gain.
 */
function dropsIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "On sale";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "Drops in minutes";
  if (hours < 24) return `Drops in ${hours}h`;
  return `Drops in ${Math.round(hours / 24)}d`;
}

/**
 * Scarcity, stated only when it is true.
 *
 * The test is absolute OR proportional, because each catches a case the other
 * misses. Twenty seats left in a 288-seat room is urgent even though that is 7%
 * of the house, above the ratio threshold. A hundred and forty-three left in a
 * 62,000-seat stadium is also urgent - the place is 99.8% gone - even though 143
 * is well above the absolute threshold.
 *
 * This is the honest output of the no-oversell backend, not a marketing device:
 * `seatsLeft` is what the availability query returns once live holds and sold
 * seats are excluded. A scarcity badge that cries wolf is the fastest way to
 * lose the trust the whole product depends on.
 */
function urgency(seatsLeft: number, seatsTotal: number) {
  const ratio = seatsLeft / seatsTotal;
  if (seatsLeft <= 25 || ratio < 0.06) {
    return { level: "critical" as const, text: `Only ${seatsLeft} seats left` };
  }
  if (ratio < 0.2) return { level: "warn" as const, text: "Selling fast" };
  return null;
}

export function EventCard({
  event,
  className,
}: {
  event: EventCardData;
  className?: string;
}) {
  const scarcity = urgency(event.seatsLeft, event.seatsTotal);
  const [h1, h2] = event.hues;

  /**
   * WHERE A CARD GOES, AND WHY IT DEPENDS ON THE STATE.
   *
   * T17's directive asks every card to link straight to `/events/[id]/seats`,
   * and for an on-sale event that is exactly right - one click from the
   * homepage to an interactive map.
   *
   * It is wrong for an event that has not dropped. The seat map would render,
   * every seat would look pickable, and `createHold` would then refuse the
   * whole selection with `EVENT_NOT_ON_SALE` - a button that fails after the
   * user has done the work. That is the same class of dead end T17 exists to
   * remove, so an upcoming event goes to its detail page instead, where the
   * drop countdown lives and the CTA tells the truth.
   *
   * A past event also goes to the detail page: its map is entirely sold.
   *
   * `state` is optional on the type, so anything still passing plain card data
   * keeps the old detail-page behaviour rather than silently changing.
   */
  const href =
    event.state === "on-sale"
      ? `/events/${event.id}/seats`
      : `/events/${event.id}`;

  return (
    <Link
      href={href}
      className={cn(
        "group/card relative flex flex-col overflow-hidden rounded-2xl outline-none transition-all duration-300",
        // live-pulse paints the travelling gold sliver on ::before. The card is
        // already relative and overflow-hidden, which the ring needs in order to
        // clip to the rounded corners.
        "glass live-pulse hover:-translate-y-1 hover:border-gold/25",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      {/* Artwork generated from the event's own two hues rather than loaded - no
          image requests, no layout shift, every card distinct. Both hues sit in
          the gold band so the grid never leaves the palette.
          TODO(Phase 2+): swap for events.poster_url with this as the fallback. */}
      <div className="relative aspect-[3/2] w-full overflow-hidden">
        <div
          className="absolute inset-0 transition-transform duration-500 group-hover/card:scale-[1.06]"
          style={{
            background: `
              radial-gradient(90% 80% at 20% 12%, oklch(0.72 0.15 ${h1} / 0.85), transparent 62%),
              radial-gradient(85% 75% at 84% 88%, oklch(0.6 0.12 ${h2} / 0.75), transparent 60%),
              linear-gradient(155deg, oklch(0.17 0.03 ${h1}), oklch(0.06 0.012 ${h2}))
            `,
          }}
        />
        {/* Floor under the metadata so text keeps contrast over any hue. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-2/3"
          style={{
            background: "linear-gradient(180deg, transparent, oklch(0 0 0 / 0.95))",
          }}
        />

        {/* The city, which real rows always have, where the mock category chip
            used to sit. `events` has no category column and T17 removed the
            taxonomy rather than invent one. */}
        <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-foreground/90 backdrop-blur-md">
          {event.category ?? event.city}
        </span>

        {/*
          THE STATUS BADGE, from real lifecycle state.

          T17's brief asks for one, and this is the honest version: `state` is
          derived in `getEventCards` from `status` + `drop_at` + `starts_at`
          together, so "On sale" means the hold API will actually serve this
          event. It also tells the user which of two destinations the card is
          about to take them to - the seat map, or the countdown.
        */}
        {event.state === "on-sale" ? (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-live/40 bg-black/65 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-live backdrop-blur-md">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-live" />
            On sale
          </span>
        ) : event.state === "upcoming" ? (
          <span className="absolute right-3 top-3 rounded-full border border-gold/35 bg-black/65 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-gold-champagne backdrop-blur-md">
            {event.dropAt ? dropsIn(event.dropAt) : "Upcoming"}
          </span>
        ) : event.state === "past" ? (
          <span className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/65 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur-md">
            Ended
          </span>
        ) : event.tag === "just-announced" ? (
          <span className="absolute right-3 top-3 rounded-full border border-gold/30 bg-black/60 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-gold-champagne backdrop-blur-md">
            Just announced
          </span>
        ) : null}

        <div className="absolute inset-x-0 bottom-0 p-4">
          <h3 className="text-balance text-lg font-semibold leading-tight tracking-[-0.02em] text-foreground">
            {event.title}
          </h3>
          {event.subtitle && (
            <p className="mt-0.5 truncate text-xs text-foreground/65">{event.subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{formatWhen(event.startsAt)}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {event.venue}, {event.city}
            </span>
          </p>
        </div>

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <span className="text-sm">
            <span className="text-muted-foreground">from </span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatPaise(event.fromPriceCents)}
            </span>
          </span>

          {/* Critical scarcity gets the live counter. "Selling fast" stays
              static because there is no number in it to tick. */}
          {scarcity?.level === "critical" && (
            <SeatCounter seats={event.seatsLeft} />
          )}

          {scarcity?.level === "warn" && (
            <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              {/* A dot as well as colour, so urgency is not carried by hue alone
                  for anyone who cannot separate these two. */}
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-muted-foreground"
              />
              {scarcity.text}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
