import type { Metadata } from "next";
import Link from "next/link";

import { PageTitle } from "@/components/layout/page-title";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  // The authoritative check. src/proxy.ts already turned away signed-out
  // visitors, but this is the layer that actually enforces the rule - it runs
  // inside the page, so no routing quirk can skip it.
  const user = await requireUser();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-page-b pt-page sm:pt-page-lg">
      <PageTitle>Your dashboard</PageTitle>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {user.email} ({user.role}).
      </p>
      <p className="mt-8 text-sm text-muted-foreground">
        Your order history will appear here. Signed QR tickets live on{" "}
        <Link
          href="/tickets"
          className="text-gold-champagne underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          your tickets page
        </Link>
        .
      </p>
    </main>
  );
}
