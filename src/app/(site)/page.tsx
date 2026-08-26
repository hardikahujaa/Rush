import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Placeholder home page.
 *
 * Deliberately restrained - the real landing page is T39, and building a full
 * hero here would only be thrown away. This exists so the navbar has something
 * coherent to sit on rather than the create-next-app boilerplate.
 */
export default function HomePage() {
  return (
    <main className="relative isolate overflow-hidden">
      {/* Atmosphere, drawn with CSS rather than an image so it costs nothing to
          load and adapts to the accent token. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[36rem] opacity-70"
        style={{
          background:
            "radial-gradient(60rem 24rem at 50% 0%, color-mix(in oklch, var(--primary) 22%, transparent), transparent 70%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(var(--foreground) 1px, transparent 1px), linear-gradient(90deg, var(--foreground) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(40rem 20rem at 50% 0%, black, transparent)",
        }}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-28 text-center sm:py-36">
        <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3 py-1 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />
          Fair queueing · no oversells
        </span>

        <h1 className="mt-6 text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-6xl">
          Tickets that go in seconds,
          <br className="hidden sm:block" />{" "}
          <span className="text-primary">sold properly.</span>
        </h1>

        <p className="mt-5 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
          RUSH holds your seat the instant you pick it, so nobody else can take
          it while you pay. One seat, one owner — guaranteed by the database, not
          by luck.
        </p>

        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="gap-2">
            <Link href="/events">
              Browse events
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/signup">Create an account</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
