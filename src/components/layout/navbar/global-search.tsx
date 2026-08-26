"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Global event search.
 *
 * A real <form> posting to /events?q=, not a controlled box that calls an API on
 * every keystroke. Submitting navigates, which means results are a URL: they can
 * be linked, shared, opened in a new tab and used with the back button. Fuzzy
 * matching happens server-side in T17 - this is the entry point for it.
 *
 * TODO(T17): replace the static suggestion list with live results from
 * src/db/queries/events.ts, debounced ~200ms.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  /**
   * "/" focuses the search, Escape leaves it - the shortcut people already
   * expect from every tool-shaped product. Guarded so it does not steal the key
   * while someone is typing in another field.
   */
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
      if (e.key === "Escape" && el === inputRef.current) {
        inputRef.current?.blur();
      }
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
          "glass flex h-10 items-center gap-2.5 rounded-full pl-3.5 pr-2 transition-all duration-300",
          focused
            ? "ring-2 ring-primary/60 [--glass-bg:oklch(1_0_0_/_10%)]"
            : "hover:[--glass-bg:oklch(1_0_0_/_8%)]",
        )}
      >
        <Search
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          id="global-search"
          ref={inputRef}
          name="q"
          type="search"
          autoComplete="off"
          placeholder="Search events, artists, venues…"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/80 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {/* The hint is decorative once the field has focus - hiding it then stops
            it colliding with what the person is typing on narrow widths. */}
        <kbd
          aria-hidden="true"
          className={cn(
            "hidden shrink-0 rounded border border-border/70 bg-background/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-opacity xl:block",
            focused && "opacity-0",
          )}
        >
          /
        </kbd>
      </div>
    </form>
  );
}
