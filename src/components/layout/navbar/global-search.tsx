"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Global event search.
 *
 * A real <form> that navigates to /events?q=, not a controlled box calling an
 * API per keystroke. Submitting produces a URL, which means results can be
 * linked, shared, opened in a new tab and used with the back button. Fuzzy
 * matching happens server-side later; this is the entry point for it.
 *
 * TODO(Phase 2+): live suggestions from src/db/queries/events.ts, debounced.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  /* "/" focuses search, Escape leaves - the shortcut people already expect.
     Guarded so it never steals the key while someone types elsewhere. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && el === inputRef.current) inputRef.current?.blur();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      role="search"
      action="/events"
      onSubmit={(e) => {
        e.preventDefault();
        const q = new FormData(e.currentTarget).get("q");
        router.push(q ? `/events?q=${encodeURIComponent(String(q))}` : "/events");
      }}
      className={cn("relative", className)}
    >
      <label htmlFor="global-search" className="sr-only">
        Search events, artists and venues
      </label>

      <div
        className={cn(
          "flex h-10 items-center gap-2.5 rounded-full border bg-white/[0.03] pl-3.5 pr-2 transition-all duration-300",
          focused
            ? "border-gold/45 bg-white/[0.06] ring-1 ring-gold/25"
            : "border-white/10 hover:border-white/20",
        )}
      >
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          id="global-search"
          ref={inputRef}
          name="q"
          type="search"
          autoComplete="off"
          placeholder="Search events, artists, venues..."
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          /* h-full so the whole pill is the target - the bare input is 20px tall,
             and tapping the padding around it would otherwise do nothing. */
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/75 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {/* Hidden once focused so it never collides with what is being typed. */}
        <kbd
          aria-hidden="true"
          className={cn(
            "hidden shrink-0 rounded border border-white/12 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-opacity lg:block",
            focused && "opacity-0",
          )}
        >
          /
        </kbd>
      </div>
    </form>
  );
}
