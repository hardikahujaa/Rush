import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { safeNextPath } from "@/lib/site-url";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  // searchParams is a Promise in Next.js 16 - it must be awaited.
  const { next, error } = await searchParams;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to hold seats and see your tickets.
        </p>
      </div>

      {/* Set by /auth/callback when a confirmation link is expired or reused.
          React escapes this on render, so the text cannot inject markup. */}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Sanitised here as well as in the action: never hand an unchecked
          redirect target to the browser, even inside a hidden input. */}
      <LoginForm next={safeNextPath(next)} />
    </div>
  );
}
