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

type Props = {
  email: string;
  name: string | null;
  role: "buyer" | "organizer" | "staff";
};

/** "Hardik Ahuja" -> HA, "hardik@x.com" -> H. Never more than two letters. */
function initials(name: string | null, email: string) {
  const source = name?.trim() || email;
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[1]?.[0] ?? "") : "")
  ).toUpperCase();
}

const ROLE_LABEL: Record<Props["role"], string> = {
  buyer: "Buyer",
  organizer: "Organizer",
  staff: "Gate staff",
};

export function UserMenu({ email, name, role }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 gap-2 pl-1.5 pr-2.5"
          aria-label="Account menu"
        >
          <Avatar className="size-6">
            <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">
              {initials(name, email)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-[12ch] truncate text-sm sm:inline">
            {name || email.split("@")[0]}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{name || "Your account"}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
          <span className="mt-2 inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
            {ROLE_LABEL[role]}
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

        {/* Role-gated entries are hidden rather than disabled. A menu item you
            can see but not use is an invitation to wonder why - and these are
            enforced server-side regardless, so hiding them costs no security. */}
        {(role === "staff" || role === "organizer") && (
          <DropdownMenuItem asChild>
            <Link href="/scan">
              <ScanLine className="size-4" aria-hidden="true" />
              Gate scanner
            </Link>
          </DropdownMenuItem>
        )}
        {role === "organizer" && (
          <DropdownMenuItem asChild>
            <Link href="/organizer">
              <LayoutDashboard className="size-4" aria-hidden="true" />
              Organizer
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {/* A real form posting to a server action, not an onClick fetch. Sign-out
            changes server state, so it must be a POST - and this way it still
            works if the JavaScript has not loaded. */}
        <form action={signOut}>
          <button
            type="submit"
            className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
