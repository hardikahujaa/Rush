"use client";

import { useState } from "react";
import { Check, ChevronDown, MapPin } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CITIES } from "@/lib/taxonomy";
import { cn } from "@/lib/utils";

/**
 * City selector.
 *
 * Local state for now. TODO(Phase 2+): persist to a cookie and read it in the
 * server components so the page is city-scoped on first paint rather than
 * re-filtering after hydration.
 */
export function LocationSelector({ className }: { className?: string }) {
  const [city, setCity] = useState(CITIES[0]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "group/loc flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        aria-label={`Change city. Current city: ${city.label}`}
      >
        <MapPin className="size-3.5 shrink-0 text-gold" aria-hidden="true" />
        <span className="max-w-[9ch] truncate font-medium text-foreground">
          {city.label}
        </span>
        <ChevronDown
          className="size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]/loc:rotate-180"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs font-normal uppercase tracking-wider text-muted-foreground">
          Choose your city
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {CITIES.map((c) => {
          const active = c.slug === city.slug;
          return (
            <DropdownMenuItem
              key={c.slug}
              onSelect={() => setCity(c)}
              className="justify-between"
            >
              <span className="flex flex-col">
                <span className={cn("text-sm", active && "font-medium")}>{c.label}</span>
                <span className="text-xs text-muted-foreground">{c.state}</span>
              </span>
              {/* A tick, not colour alone - the selected row stays identifiable
                  without relying on hue. */}
              {active && <Check className="size-4 text-gold" aria-hidden="true" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
