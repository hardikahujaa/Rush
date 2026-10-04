import type { Metadata } from "next";

import { GateScanner } from "@/components/scan/gate-scanner";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Gate scanner",
  /* Staff tooling. Nothing here belongs in a search index. */
  robots: { index: false, follow: false },
};

/**
 * /scan - the door.
 *
 * ── AUTHORISATION IS THREE LAYERS HERE, NOT TWO ────────────────────────────
 *   1. `src/proxy.ts` has matched `/scan` for `staff | organizer` since T15 -
 *      the fast, optimistic gate, read from the verified JWT.
 *   2. `requireRole("staff","organizer")` below, which reads the role from the
 *      `users` table rather than the token. This is the layer that enforces it:
 *      a JWT is a snapshot, so revoking someone's staff role leaves their
 *      existing token claiming it for up to an hour, and only a database read
 *      is current.
 *   3. `POST /api/scan` checks the role AGAIN. That is not redundant - the
 *      endpoint writes `checked_in_at`, and anything that can write it can burn
 *      a paying customer's ticket. A page guard protects the page; it does not
 *      protect an endpoint anyone can call directly with curl.
 *
 * The page stays a Server Component and renders one client island, so the
 * camera and the result takeover are the only JavaScript shipped.
 */
export default async function ScanPage() {
  const user = await requireRole("staff", "organizer");

  return (
    <>
      <GateScanner />

      {/* Who is on the door. Deliberately small and at the bottom: it matters
          for accountability (every admit is logged with this email) and not at
          all while a queue is moving. */}
      <p className="mx-auto max-w-xl px-4 pb-10 text-center text-[11px] text-muted-foreground sm:px-6">
        Scanning as {user.email} · {user.role}
      </p>
    </>
  );
}
