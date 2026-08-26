"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CATEGORIES } from "@/lib/taxonomy";

/**
 * Categories mega-menu.
 *
 * Every category and its subcategories in one panel rather than a nested
 * flyout. Nested submenus require holding a hover path along a diagonal, which
 * is fiddly with a mouse and impossible on a touchpad in a hurry - and this
 * product is entirely about people in a hurry.
 *
 * Each column carries a wash tinted by its own hue, so the categories stay
 * distinguishable at a glance without six competing saturated blocks.
 */
export function CategoriesMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group/cat hidden h-9 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:flex">
        Categories
        <ChevronDown
          className="size-3.5 transition-transform duration-200 group-data-[state=open]/cat:rotate-180"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={12}
        className="w-[min(78rem,calc(100vw-2rem))] p-0"
      >
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg lg:grid-cols-3 xl:grid-cols-6">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <div key={cat.slug} className="relative bg-popover p-4">
                {/* Hue wash, top-anchored so the column header sits in colour and
                    the links below stay on a neutral ground for readability. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-[0.16]"
                  style={{
                    background: `linear-gradient(180deg, oklch(0.7 0.2 ${cat.hue}), transparent)`,
                  }}
                />

                <Link
                  href={`/events?category=${cat.slug}`}
                  className="relative flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon
                    className="size-4 shrink-0"
                    style={{ color: `oklch(0.78 0.16 ${cat.hue})` }}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-semibold">{cat.label}</span>
                </Link>

                <p className="relative mt-1 text-xs leading-relaxed text-muted-foreground">
                  {cat.tagline}
                </p>

                <ul className="relative mt-3 space-y-0.5">
                  {cat.subcategories.map((sub) => (
                    <li key={sub.slug}>
                      <Link
                        href={`/events?category=${cat.slug}&sub=${sub.slug}`}
                        className="block rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
                      >
                        <span className="block text-[13px] text-foreground/90">
                          {sub.label}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {sub.blurb}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
