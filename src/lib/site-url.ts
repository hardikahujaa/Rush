/**
 * The public origin of this deployment, used for auth email links.
 *
 * Order matters: an explicit NEXT_PUBLIC_SITE_URL wins, then Vercel's own
 * production domain, then the per-deployment preview URL, then localhost.
 * Getting this wrong sends confirmation emails whose links point at the wrong
 * host - a preview build mailing people a link to a URL that will be deleted
 * next week, for instance.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  // Set by Vercel to the stable production domain, e.g. rush-amber.vercel.app.
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;

  // Set by Vercel to this specific deployment's URL (previews included).
  const deployment = process.env.VERCEL_URL;
  if (deployment) return `https://${deployment}`;

  return "http://localhost:3000";
}

/**
 * Sanitises a `?next=` redirect target.
 *
 * A login page that redirects wherever the query string says is an OPEN
 * REDIRECT: an attacker sends `/login?next=https://evil.example/login`, the
 * victim signs in on the real site, and gets bounced to a convincing clone that
 * asks them to "sign in again". The URL in the phishing email is genuinely
 * yours, which is exactly what makes it work.
 *
 * So: only same-site absolute paths. Reject anything with a scheme, and reject
 * protocol-relative `//evil.example`, which the browser reads as a full URL
 * despite starting with a slash.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  // Backslashes are normalised to forward slashes by some browsers, so `/\evil`
  // can escape the origin too.
  if (next.startsWith("/\\")) return fallback;
  return next;
}
