import type { Metadata } from "next";

import { PageTitle } from "@/components/layout/page-title";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Organizer" };

export default async function OrganizerPage() {
  const user = await requireRole("organizer");

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-page-b pt-page sm:pt-page-lg">
      <PageTitle>Organizer</PageTitle>
      <p className="mt-2 text-sm text-muted-foreground">
        Signed in as {user.email} ({user.role}).
      </p>
      <p className="mt-8 text-sm text-muted-foreground">
        Sales analytics arrive in T36 and T37.
      </p>
    </main>
  );
}
