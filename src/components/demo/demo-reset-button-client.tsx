"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";

type Result = { ordersCleared: number; holdsReleased: number; seatsRepaired: number };

/**
 * The floating "Reset demo" button (T47) - organizer-only, mounted once in
 * the root layout by the server component in `demo-reset-button.tsx`, which
 * is the file actually enforcing who sees this at all.
 *
 * ── THE ARM/DISARM PATTERN IS BORROWED, NOT REINVENTED ─────────────────────
 * Same shape as "Release seats" in `hold-banner.tsx`: one click arms a four
 * -second window, a second click inside it fires, and arming decays on its
 * own rather than needing a dismiss. A modal confirmation would steal focus
 * from whatever the presenter is mid-demonstrating; this does not. The stakes
 * here are higher than a single release - this deletes every real order in
 * the database - so the same "no accidental single click" protection applies
 * even though nothing here is running against a countdown.
 */
export function DemoResetButtonClient() {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);

  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  async function handleClick() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error?.message ?? "Could not reset the demo.");
      }
      setResult(body as Result);
      /* Whatever page is open - a seat map, the dashboard, /tickets - now
         has stale server-rendered data about seats and orders this just
         deleted. A refresh is the only way those pages learn that. */
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the demo.");
    } finally {
      setPending(false);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => {
        setResult(null);
        setError(null);
      }, 6000);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col items-end gap-2">
      {(result || error) && (
        <div
          role="status"
          className="glass max-w-[min(90vw,20rem)] rounded-xl px-3 py-2 text-xs leading-relaxed"
        >
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : (
            result && (
              <span className="text-muted-foreground">
                Cleared <strong className="text-foreground">{result.ordersCleared}</strong>{" "}
                order(s), released{" "}
                <strong className="text-foreground">{result.holdsReleased}</strong> hold(s).
              </span>
            )
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending}
        title="Reset demo: clears every real order and hold. Seed data is untouched."
        className="btn-gold-outline inline-flex h-10 items-center gap-2 rounded-full px-4 text-xs font-bold uppercase tracking-wide shadow-lg outline-none transition-[filter,opacity] duration-300 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCcw className="size-4 shrink-0" aria-hidden="true" />
        )}
        {pending ? "Resetting" : armed ? "Tap again to reset demo" : "Reset demo"}
      </button>
    </div>
  );
}
