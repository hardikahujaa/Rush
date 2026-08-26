"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu } from "lucide-react";

import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export type NavLink = { href: string; label: string };

type Props = {
  links: NavLink[];
  user: { email: string; name: string | null; role: string } | null;
};

export function MobileNav({ links, user }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  /**
   * Closing happens on the tap itself, not in an effect watching the pathname.
   *
   * The App Router keeps this mounted across navigations, so the sheet does have
   * to be told to close - but reacting to the route change means rendering once
   * with the menu still covering the new page before the effect runs. Closing on
   * the interaction that caused the navigation is both immediate and honest
   * about what triggered it.
   */
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-[min(20rem,85vw)] p-0">
        <SheetHeader className="px-6 pt-6">
          <SheetTitle className="text-left tracking-[-0.03em]">RUSH</SheetTitle>
        </SheetHeader>

        <nav className="flex flex-col px-3 py-4">
          {links.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={close}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-2.5 text-base transition-colors",
                  active
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <Separator />

        <div className="px-6 py-5">
          {user ? (
            <>
              <p className="truncate text-sm font-medium">
                {user.name || "Your account"}
              </p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              <form action={signOut} className="mt-4">
                <Button type="submit" variant="outline" className="w-full gap-2">
                  <LogOut className="size-4" aria-hidden="true" />
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <Button asChild>
                <Link href="/signup" onClick={close}>Create account</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/login" onClick={close}>Sign in</Link>
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
