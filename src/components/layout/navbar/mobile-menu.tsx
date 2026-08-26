"use client";

import Link from "next/link";
import { useState } from "react";
import { LogOut, Menu } from "lucide-react";

import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { CATEGORIES, CITIES } from "@/lib/taxonomy";
import type { NavUser } from "@/components/layout/navbar/user-nav";

/**
 * Mobile navigation.
 *
 * Closes on the tap that navigates rather than from an effect watching the
 * pathname - reacting to the route change renders once with the panel still
 * covering the page you just asked for.
 */
export function MobileMenu({ user }: { user: NavUser | null }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="w-[min(22rem,88vw)] overflow-y-auto border-l-border/60 bg-background/95 p-0 backdrop-blur-2xl"
      >
        <SheetHeader className="px-6 pt-6">
          <SheetTitle className="text-left text-lg font-bold tracking-[-0.05em]">
            RUSH
          </SheetTitle>
        </SheetHeader>

        <div className="px-6 pb-2 pt-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Browse
          </p>
        </div>
        <nav className="flex flex-col px-3">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <Link
                key={cat.slug}
                href={`/events?category=${cat.slug}`}
                onClick={close}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] text-foreground/90 transition-colors hover:bg-accent"
              >
                <Icon
                  className="size-4 shrink-0"
                  style={{ color: `oklch(0.78 0.16 ${cat.hue})` }}
                  aria-hidden="true"
                />
                {cat.label}
              </Link>
            );
          })}
        </nav>

        <Separator className="my-4" />

        <div className="px-6">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            City
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {CITIES.slice(0, 6).map((c) => (
              <button
                key={c.slug}
                type="button"
                className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <Separator className="my-4" />

        <div className="px-6 pb-8">
          {user ? (
            <>
              <p className="truncate text-sm font-medium">
                {user.name || "Your account"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {user.email}
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/dashboard" onClick={close}>
                    Dashboard
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/tickets" onClick={close}>
                    My tickets
                  </Link>
                </Button>
                {user.role === "organizer" && (
                  <Button asChild variant="outline" className="justify-start">
                    <Link href="/organizer" onClick={close}>
                      Organizer console
                    </Link>
                  </Button>
                )}
                <form action={signOut}>
                  <Button
                    type="submit"
                    variant="ghost"
                    className="w-full justify-start gap-2 text-muted-foreground"
                  >
                    <LogOut className="size-4" aria-hidden="true" />
                    Sign out
                  </Button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <Button
                asChild
                className="bg-gradient-to-r from-primary to-brand-2 text-primary-foreground"
              >
                <Link href="/signup" onClick={close}>
                  Get started
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/login" onClick={close}>
                  Sign in
                </Link>
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
