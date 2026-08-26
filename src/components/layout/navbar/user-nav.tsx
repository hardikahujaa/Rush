"use client";

import Link from "next/link";
import { LayoutDashboard, LogOut, ScanLine, Ticket } from "lucide-react";

import { signOut } from "@/app/(auth)/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
 * requireRole() enforces them server-side regardless, so hiding costs nothing
 * and avoids showing people doors they cannot open.
 */
export function UserNav({ user }: { user: NavUser | null }) {
  if (!user) {
    return (
      <div className="hidden items-center gap-2 sm:flex">
        <Link
          href="/login"
          className="rounded-full px-3 py-2 text-sm text-foreground/85 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Sign in
        </Link>
        {/* Gold fill, near-black label. White on champagne is roughly 1.6:1 and
            would be unreadable, so the dark label is a requirement not a look. */}
        <Link
          href="/signup"
          className="btn-gold inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold outline-none transition-[filter,box-shadow] duration-300 hover:brightness-[1.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Get started
        </Link>
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
          <span
            className="rounded-full p-px"
            style={{
              background:
                "linear-gradient(140deg, var(--gold-champagne), var(--gold-deep))",
            }}
          >
            <Avatar className="size-8 border-2 border-background">
              <AvatarFallback className="bg-card text-[11px] font-semibold text-foreground">
                {initials(user.name, user.email)}
              </AvatarFallback>
            </Avatar>
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={10} className="w-64 border-white/10">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{user.name || "Your account"}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <span className="mt-2 inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gold-champagne">
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
            className="relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-white/5 focus-visible:bg-white/5"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
