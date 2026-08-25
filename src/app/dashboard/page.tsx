import type { Metadata } from "next";

import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  // The authoritative check. src/proxy.ts already turned away signed-out
  // visitors, but this is the layer that actually enforces the rule - it runs
  // inside the page, so no routing quirk can skip it.
  const user = await requireUser();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Your dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {user.email} ({user.role}).
      </p>
      <p className="mt-8 text-sm text-muted-foreground">
        Your tickets and order history will appear here.
      </p>
    </main>
  );
}
