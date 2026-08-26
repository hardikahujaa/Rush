"use client";

import { useEffect, useState } from "react";

import { GlobalSearch } from "@/components/layout/navbar/global-search";
import { cn } from "@/lib/utils";

/**
 * Sticky glass shell with physical depth.
 *
 * At the top of the page the bar floats as an inset capsule, so the lobby light
 * continues behind and around it. Once scrolled it spans the full width and its
 * blur deepens, becoming a hard divider between the content moving underneath
 * and the controls staying put.
 *
 * The depth comes from `.glass-nav`: a true-black 1px outline plus an outer
 * black ring and a long shadow. Against a lit background a glass panel with only
 * a white hairline dissolves - the black outline is what makes it sit *in front
 * of* the room rather than on it.
 */
export function NavbarShell({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll(); // a reload part-way down must not start in the "top" state
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full">
      <div
        className={cn(
          "transition-all duration-500 ease-out",
          scrolled ? "px-0 pt-0" : "px-3 pt-3 sm:px-5 sm:pt-4",
        )}
      >
        <div
          className={cn(
            "glass-nav mx-auto flex h-16 items-center gap-2 transition-all duration-500 ease-out",
            scrolled
              ? "max-w-none rounded-none border-x-0 border-t-0 px-4 sm:px-6"
              : "max-w-6xl rounded-2xl px-3 sm:px-4",
          )}
        >
          {children}
        </div>
      </div>

      {/* Small screens: the centre slot is too narrow for a usable field, so the
          search moves to its own row rather than being cramped or dropped. */}
      <div
        className={cn(
          "px-3 transition-all duration-500 sm:px-5 md:hidden",
          scrolled ? "bg-black/80 pb-2 pt-2 backdrop-blur-2xl" : "pb-0 pt-2",
        )}
      >
        <GlobalSearch />
      </div>
    </header>
  );
}
