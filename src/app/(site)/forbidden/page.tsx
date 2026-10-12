import type { Metadata } from "next";
import Link from "next/link";
import { ShieldX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/layout/page-title";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Not allowed" };

/**
 * Shown when someone IS signed in but lacks the role for a page.
 *
 * Deliberately not the login page. Sending an already-authenticated person to
 * sign in again implies their session is the problem, which it is not, and no
 * amount of re-authenticating will grant them a role they do not have.
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const user = await getCurrentUser();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 text-center">
      <ShieldX className="size-10 text-muted-foreground" aria-hidden="true" />
      <PageTitle className="mt-6">You do not have access to this page</PageTitle>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        {user
          ? `Your account (${user.email}) has the "${user.role}" role, which is not permitted here.`
          : "Your account does not have permission to view this page."}
        {/* The path is echoed but never linked - it came from a query string,
            and turning caller-supplied text into a link is how open redirects
            get built by accident. */}
        {from ? ` Requested: ${from}` : null}
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild>
          <Link href="/">Back to events</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Your dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
