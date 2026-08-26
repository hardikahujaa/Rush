import { Navbar } from "@/components/layout/navbar/navbar";

/**
 * Layout for the main site.
 *
 * `(site)` is a route group - the parentheses keep it out of the URL, so the
 * page inside it is still `/`. It wraps the real pages without appearing over
 * /login and /signup, which have their own centred layout.
 *
 * The page ground is pitch black here rather than inherited, so every section
 * below the hero sits on true #000 regardless of what the hero is lighting.
 */
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-svh flex-col bg-black">
      <Navbar />
      <div className="flex-1">{children}</div>
    </div>
  );
}
