/**
 * Layout for the main site.
 *
 * `(site)` is a route group - the parentheses keep it out of the URL, so the
 * page inside it is still `/`. It wraps the real pages without appearing over
 * /login and /signup, which have their own centred layout.
 *
 * Intentionally bare after the Phase 0 purge. The navbar, backdrop and footer
 * were removed with the T16 design and are rebuilt in Phase 1.
 */
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="relative flex min-h-svh flex-col">{children}</div>;
}
