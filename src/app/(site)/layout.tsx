import { Navbar } from "@/components/nav/navbar";

/**
 * Layout for the main site.
 *
 * `(site)` is a route group - the parentheses keep it out of the URL, so the
 * page inside it is still `/`. It exists so the navbar wraps the real pages
 * without also appearing over `/login` and `/signup`, which have their own
 * centred, full-height layout and are better off without one.
 *
 * The alternative - one navbar in the root layout that inspects the current path
 * and hides itself - works, but it makes every page pay to find out whether it
 * wants a navbar. The router already knows. Let it answer.
 */
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <Navbar />
      <div className="flex-1">{children}</div>
    </div>
  );
}
