"use client";

import { useEffect, useState } from "react";

import { GlobalSearch } from "@/components/layout/navbar/global-search";
import { cn } from "@/lib/utils";

/**
 * Sticky glass shell for the navbar.
 *
 * At the top of the page the bar is a floating glass capsule inset from the
 * edges, so the aurora reads continuously behind it. Once the page scrolls it
 * widens to the full edge and its blur deepens, becoming a solid divider between
 * the content moving beneath and the controls staying put. Two different jobs,
 * two different treatments.
 *
 * A second search field appears below the bar on small screens, where the
 * centre slot is too narrow to hold one.
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
            "mx-auto flex items-center gap-2 transition-all duration-500 ease-out",
            scrolled
              ? "h-16 max-w-none rounded-none border-x-0 border-t-0 px-4 sm:px-6 [--glass-blur:24px]"
              : "h-16 max-w-6xl rounded-2xl px-3 sm:px-4",
            "glass",
          )}
        >
          {children}
        </div>
      </div>

      {/* Small screens: the centre slot cannot hold a usable search field, so it
          moves to its own row rather than being cramped or dropped. */}
      <div
        className={cn(
          "px-3 transition-all duration-500 sm:px-5 md:hidden",
          scrolled ? "pb-2 pt-2" : "pb-0 pt-2",
        )}
      >
        <GlobalSearch />
      </div>
    </header>
  );
}
