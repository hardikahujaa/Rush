"use client";

import Link from "next/link";
import { LayoutDashboard, LogOut, ScanLine, Ticket } from "lucide-react";

import { signOut } from "@/app/(auth)/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type NavUser = {
  email: string;
  name: string | null;
  role: "buyer" | "organizer" | "staff";
};

const ROLE_LABEL: Record<NavUser["role"], string> = {
  buyer: "Buyer",
  organizer: "Organizer",
  staff: "Gate staff",
};

function initials(name: string | null, email: string) {
  const src = name?.trim() || email;
  const p = src.split(/[\s.@_-]+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? (p[1]?.[0] ?? "") : "")).toUpperCase();
}

/**
 * Signed-in account menu, or the sign-in pair when signed out.
 *
 * The role and the sign-out action are the same T15 wiring as before: `signOut`
 * is a server action reached through a real <form>, so signing out is a POST and
 * works without JavaScript. Role-gated entries are hidden rather than disabled -
 * they are enforced server-side by requireRole() regardless, so hiding them
 * costs nothing and avoids showing people doors they cannot open.
 */
export function UserNav({ user }: { user: NavUser | null }) {
  if (!user) {
    return (
      <div className="hidden items-center gap-1.5 sm:flex">
        <Button asChild variant="ghost" size="sm" className="rounded-full">
          <Link href="/login">Sign in</Link>
        </Button>
        <Button
          asChild
          size="sm"
          className="rounded-full bg-gradient-to-r from-primary to-brand-2 text-primary-foreground shadow-[0_0_20px_-6px_var(--primary)] transition-shadow hover:shadow-[0_0_28px_-4px_var(--primary)]"
        >
          <Link href="/signup">Get started</Link>
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center rounded-full outline-none ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Account menu"
        >
          {/* The ring is a gradient hairline rather than a solid border - it
              picks up both brand hues and reads as a lit edge. */}
          <span className="rounded-full bg-gradient-to-br from-primary to-brand-2 p-px">
            <Avatar className="size-8 border-2 border-background">
              <AvatarFallback className="bg-card text-[11px] font-semibold text-foreground">
                {initials(user.name, user.email)}
              </AvatarFallback>
            </Avatar>
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={10} className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">
            {user.name || "Your account"}
          </p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <span className="mt-2 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
            {ROLE_LABEL[user.role]}
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <LayoutDashboard className="size-4" aria-hidden="true" />
            Dashboard
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/tickets">
            <Ticket className="size-4" aria-hidden="true" />
            My tickets
          </Link>
        </DropdownMenuItem>

        {(user.role === "staff" || user.role === "organizer") && (
          <DropdownMenuItem asChild>
            <Link href="/scan">
              <ScanLine className="size-4" aria-hidden="true" />
              Gate scanner
            </Link>
          </DropdownMenuItem>
        )}
        {user.role === "organizer" && (
          <DropdownMenuItem asChild>
            <Link href="/organizer">
              <LayoutDashboard className="size-4" aria-hidden="true" />
              Organizer console
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <form action={signOut}>
          <button
            type="submit"
            className="relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
