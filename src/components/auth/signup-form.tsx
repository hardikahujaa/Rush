"use client";

import Link from "next/link";
import { useActionState } from "react";
import { MailCheck } from "lucide-react";

import { signup } from "@/app/(auth)/actions";
import { AuthField } from "@/components/auth/auth-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import type { AuthFormState } from "@/lib/validation/auth";

const initialState: AuthFormState = {};

export function SignupForm() {
  const [state, formAction, isPending] = useActionState(signup, initialState);

  /**
   * Shown whether or not the email was already registered. Supabase returns an
   * identical response in both cases so that the form cannot be used to test
   * which addresses have accounts, and we preserve that by not branching on it.
   */
  if (state.checkEmail) {
    return (
      <div className="space-y-4 text-center" role="status">
        <MailCheck
          className="mx-auto size-10 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="text-lg font-medium">Check your email</h2>
        <p className="text-sm text-muted-foreground">
          If{" "}
          <span className="text-foreground">{state.values?.email}</span> can be
          registered, a confirmation link is on its way. Open it to finish
          setting up your account.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <AuthField
        id="name"
        name="name"
        label="Name"
        autoComplete="name"
        required
        defaultValue={state.values?.name}
        errors={state.fieldErrors?.name}
      />

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
        autoComplete="new-password"
        required
        hint="At least 8 characters."
        errors={state.fieldErrors?.password}
      />

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/login"
          className="text-foreground underline underline-offset-4 hover:no-underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
