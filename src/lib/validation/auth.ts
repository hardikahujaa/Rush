import { z } from "zod";

/**
 * Auth input schemas.
 *
 * These live apart from the pages because validation must happen on the SERVER.
 * Anything checked only in the browser is a convenience, not a control - the form
 * is just an HTTP request, and a request can be made with curl. The same schema
 * runs server-side, which is the check that actually counts.
 *
 * Note `z.email()` rather than `z.string().email()`: Zod 4 promoted the format
 * validators to top level. The old form still works but is deprecated.
 */

export const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export const signupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(80, "That name is too long"),
  email: z.email("Enter a valid email address"),
  /**
   * Eight characters is Supabase's own default minimum. We do not impose
   * "must contain a symbol" rules: modern guidance (NIST 800-63B) is that length
   * beats composition rules, which mostly push people toward Password1! and a
   * sticky note.
   */
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password must be 72 characters or fewer"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;

/** Shape returned by the auth server actions to `useActionState`. */
export type AuthFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Set when signup succeeded but the account still needs email confirmation. */
  checkEmail?: boolean;
  /** Echoed back so the form does not clear itself on a failed submit. */
  values?: { name?: string; email?: string };
};
