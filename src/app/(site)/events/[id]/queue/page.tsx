import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin } from "lucide-react";

import { PageTitle } from "@/components/layout/page-title";
import { QueueLobby } from "@/components/queue/queue-lobby";
import { getCurrentUser } from "@/lib/auth";
import { findEvent } from "@/lib/event-lookup";
import { isQueueActive } from "@/lib/queue";
import { checkGate } from "@/lib/queue-gate";

type Props = { params: Promise<{ id: string }> };

function formatWhen(date: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const event = await findEvent(id);
  if (!event) return { title: "Event not found" };
  return {
    title: `Waiting room · ${event.title}`,
    /* `noindex`: a lobby is a transient, per-user page. Indexed, it would be
       the result a search engine showed for the event itself. */
    robots: { index: false, follow: false },
  };
}

/**
 * THE WAITING ROOM PAGE (T34).
 *
 * The page's own job is almost entirely to decide that the user should NOT be
 * here. There are three ways to arrive at a lobby you do not belong in, and all
 * three are ordinary:
 *
 *   - the drop window has closed (the queue is over, the seat map is open);
 *   - you already hold a valid admission (a bookmark, a back button, a second
 *     tab) - and sitting in a queue you have already cleared would be absurd;
 *   - you are signed out, so there is no identity to hold a place for.
 *
 * `checkGate` answers all three with the SAME logic the seat map uses, which is
 * the point of having it in one file. Two independent copies of "may this user
 * be on the seat map" would eventually disagree, and then one of them would
 * either strand people in a lobby forever or let them past.
 */
export default async function QueuePage({ params }: Props) {
  const { id } = await params;
  const event = await findEvent(id);

  if (!event) notFound();

  const lobby = `/events/${id}/queue`;

  /* No drop in progress - or the queue is not configured at all. Either way
     there is nothing to wait for, so do not render a waiting room. */
  if (!isQueueActive(event)) redirect(`/events/${id}/seats`);

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(lobby)}`);

  /**
   * Already through. Sent straight to the seats.
   *
   * This also covers the case the exemption exists for: somebody with a live
   * hold whose admission has expired. Without it they would be shown a queue
   * while holding seats they are mid-way through buying.
   */
  const verdict = await checkGate({ event, eventId: id, userId: user.id });
  if (verdict.allowed) redirect(`/events/${id}/seats`);

  return (
    <main className="mx-auto max-w-xl px-4 pb-page-b pt-page sm:px-6 sm:pt-page-lg">
      <Link
        href={`/events/${id}`}
        className="inline-flex items-center gap-2 rounded-full py-2 text-sm text-foreground/75 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to {event.title}
      </Link>

      <header className="mt-4 text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-gold-champagne">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-gold motion-safe:animate-pulse"
          />
          Drop in progress
        </p>

        <PageTitle className="mt-5">You&rsquo;re in the queue</PageTitle>
        <p className="mt-3 text-base text-gold-champagne/90">{event.title}</p>

        <div className="mt-3 flex flex-col items-center gap-1.5 text-sm text-muted-foreground sm:flex-row sm:justify-center sm:gap-6">
          {event.startsAt && (
            <p className="flex items-center gap-2">
              <CalendarDays
                className="size-4 shrink-0 text-gold"
                aria-hidden="true"
              />
              {formatWhen(event.startsAt)}
            </p>
          )}
          <p className="flex items-center gap-2">
            <MapPin className="size-4 shrink-0 text-gold" aria-hidden="true" />
            {event.venue}, {event.city}
          </p>
        </div>
      </header>

      <div className="mt-9">
        <QueueLobby eventId={id} eventTitle={event.title} />
      </div>

      {/*
        WHY ANY OF THIS IS STATED, AND NOT JUST ENFORCED.

        Both facts below are already true in the code. Saying them is not
        decoration: an unexplained queue is the most reliable way to make
        someone start hammering refresh and opening tabs, which is exactly the
        load the queue exists to absorb. Telling them it cannot work is cheaper
        than absorbing the attempt.

        T35 TRIMMED THIS LIST. It used to carry three bullets, two of which the
        rotating ticker inside the panel now says - so the page stated the same
        rules twice, eight lines apart, and the repetition read as padding on a
        screen where every line is being scrutinised. What is left is the pair
        the ticker does NOT rotate: that refreshing is safe (the ticker only
        says it will not help), and the concrete consequence of leaving.
      */}
      <ul className="mx-auto mt-8 max-w-sm space-y-2.5 text-xs leading-relaxed text-muted-foreground">
        <li className="flex gap-2.5">
          <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-gold/60" />
          Your place is held against your account, not this tab — so refreshing
          is safe.
        </li>
        <li className="flex gap-2.5">
          <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-gold/60" />
          If this tab is closed for more than a minute, your spot goes to the
          next person in line.
        </li>
      </ul>

    </main>
  );
}
