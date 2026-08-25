"use client";

import Link from "next/link";
import { useActionState } from "react";

import { login } from "@/app/(auth)/actions";
import { AuthField } from "@/components/auth/auth-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import type { AuthFormState } from "@/lib/validation/auth";

const initialState: AuthFormState = {};

/**
 * `useActionState` is React 19's replacement for wiring up your own
 * loading/error state around a form.
 *
 * It hands back three things: the value the server action last returned, a
 * function to pass straight to `<form action={...}>`, and a pending flag while
 * the request is in flight. Because the browser posts the form natively, this
 * still works with JavaScript disabled or not yet loaded - the page just does a
 * full round trip instead of a fetch. That is progressive enhancement, and it is
 * the reason this is a form rather than a button with an onClick.
 */
export function LoginForm({ next }: { next: string }) {
  const [state, formAction, isPending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />

      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <AuthField
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        errors={state.fieldErrors?.email}
      />

      <AuthField
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        errors={state.fieldErrors?.password}
      />

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Signing in…" : "Sign in"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link
          href="/signup"
          className="text-foreground underline underline-offset-4 hover:no-underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
