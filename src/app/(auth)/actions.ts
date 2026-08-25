"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getSiteUrl, safeNextPath } from "@/lib/site-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  loginSchema,
  signupSchema,
  type AuthFormState,
} from "@/lib/validation/auth";

/**
 * Server Actions for auth.
 *
 * `"use server"` marks every export as a function the browser may invoke over
 * the network. That is the whole security model here: the body never ships to
 * the client, so it can touch cookies and secrets - but the arguments come from
 * the user and are therefore untrusted. Hence Zod on every one, server-side,
 * before anything else happens.
 *
 * These take `(prevState, formData)` because React's `useActionState` calls them
 * that way, which gives us progressive enhancement for free: the form submits
 * and validates correctly even if the JavaScript never loads.
 */

export async function login(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  const next = safeNextPath(formData.get("next")?.toString());

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors,
      values: { email: raw.email },
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    /**
     * One message for both "no such account" and "wrong password", on purpose.
     * Distinguishing them turns the login form into an account-existence oracle:
     * an attacker submits a list of emails and learns which are registered,
     * which is worth money on its own and sharpens every later phishing attempt.
     *
     * The unconfirmed-email case IS surfaced separately, because it is not a
     * secret - that person already knows they signed up - and leaving them
     * staring at "invalid credentials" is a support ticket waiting to happen.
     */
    if (
      error.code !== "invalid_credentials" &&
      error.code !== "email_not_confirmed"
    ) {
      // Server-side only. An unexpected auth failure should be visible to us
      // even though the visitor sees a generic message.
      console.error("[login] supabase error", {
        code: error.code,
        status: error.status,
        message: error.message,
      });
    }

    const message =
      error.code === "email_not_confirmed"
        ? "Check your inbox and confirm your email address before signing in."
        : error.code === "over_request_rate_limit"
          ? "Too many attempts just now. Please wait a minute and try again."
          : "That email and password combination is not right.";
    return { error: message, values: { email: raw.email } };
  }

  revalidatePath("/", "layout");
  // Must be OUTSIDE any try/catch: redirect() works by throwing a control-flow
  // signal that Next catches. Swallowing it would silently do nothing.
  redirect(next);
}

export async function signup(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };

  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      fieldErrors: parsed.error.flatten().fieldErrors,
      values: { name: raw.name, email: raw.email },
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      /**
       * Lands in auth.users.raw_user_meta_data, where the database trigger from
       * migration 0002 reads it to populate public.users.name. We do NOT insert
       * that row from here: doing it in the trigger makes it part of the same
       * transaction as the auth user, so the two can never disagree.
       */
      data: { name: parsed.data.name },
      emailRedirectTo: `${getSiteUrl()}/auth/callback`,
    },
  });

  if (error) {
    /**
     * Logged server-side because the messages below are deliberately vague to
     * the visitor, and without this the real cause is invisible to us too. This
     * runs on the server, so it never reaches the browser.
     */
    console.error("[signup] supabase error", {
      code: error.code,
      status: error.status,
      message: error.message,
    });

    /**
     * Distinguish the failures the user can actually act on. Everything else
     * collapses to one message, so the form cannot be used to probe which
     * addresses already have accounts.
     */
    const message = (() => {
      switch (error.code) {
        case "weak_password":
          return "Please choose a stronger password.";
        case "email_address_invalid":
          return "That email address is not accepted. Try a different one.";
        case "over_email_send_rate_limit":
        case "over_request_rate_limit":
          return "Too many attempts just now. Please wait a minute and try again.";
        case "signup_disabled":
          return "New signups are currently disabled.";
        default:
          return "Could not create that account. Please try again.";
      }
    })();

    return { error: message, values: { name: raw.name, email: raw.email } };
  }

  /**
   * Supabase returns a user with an empty `identities` array when the email is
   * already registered - deliberately, so the response looks identical to a
   * genuine signup and cannot be used to enumerate accounts. We keep that
   * property by showing the same "check your email" screen either way.
   */
  if (!data.session) {
    return { checkEmail: true, values: { email: raw.email } };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
