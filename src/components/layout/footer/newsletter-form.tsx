"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * VIP early-access signup.
 *
 * NOT PERSISTED YET. There is no subscribers table, and this deliberately does
 * not claim otherwise — the confirmation says the address was captured, not that
 * anything was sent. A form that reports success for work it never did is the
 * fastest way to teach people your confirmations mean nothing.
 *
 * TODO: add a `subscribers` table, move this to a server action, and validate
 * with the Zod schemas in src/lib/validation/ as every other input already does.
 */
export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [captured, setCaptured] = useState(false);

  if (captured) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-full bg-live/10 px-4 py-2.5 text-sm text-live"
      >
        <Check className="size-4 shrink-0" aria-hidden="true" />
        Saved. You will hear about drops first.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (email.includes("@")) setCaptured(true);
      }}
      className="flex w-full max-w-sm items-center gap-2"
    >
      <label htmlFor="newsletter-email" className="sr-only">
        Email address for early access
      </label>
      <div className="glass flex h-11 flex-1 items-center rounded-full px-4 focus-within:ring-2 focus-within:ring-primary/60">
        <input
          id="newsletter-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
        />
      </div>
      <Button
        type="submit"
        size="icon"
        className="size-11 shrink-0 rounded-full bg-gradient-to-br from-primary to-brand-2 text-primary-foreground"
        aria-label="Sign up for early access"
      >
        <ArrowRight className="size-4" aria-hidden="true" />
      </Button>
    </form>
  );
}
