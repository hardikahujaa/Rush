import type { Metadata } from "next";

import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Organizer" };

export default async function OrganizerPage() {
  const user = await requireRole("organizer");

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Organizer</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {user.email} ({user.role}).
      </p>
      <p className="mt-8 text-sm text-muted-foreground">
        Sales analytics arrive in T36 and T37.
      </p>
    </main>
  );
}
