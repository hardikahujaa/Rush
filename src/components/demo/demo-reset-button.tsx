import { getCurrentUser } from "@/lib/auth";
import { DemoResetButtonClient } from "@/components/demo/demo-reset-button-client";

/**
 * T47 — the actual gate. `getCurrentUser()` reads the role from the `users`
 * table, not the JWT, so revoking organizer access hides this button on the
 * very next render rather than whenever a stale token happens to expire -
 * same reasoning `requireRole` documents in `lib/auth.ts`.
 *
 * A Server Component, specifically so the role check - and the query behind
 * it - never ships to the client. Rendering `null` for a buyer means a buyer's
 * bundle never even contains a button for an endpoint they are not allowed to
 * call, as opposed to a client-side check that hides a button `fetch` could
 * still reach.
 */
export async function DemoResetButton() {
  const user = await getCurrentUser();
  if (user?.role !== "organizer") return null;

  return <DemoResetButtonClient />;
}
