import { Aurora } from "@/components/backdrop/aurora";
import { Footer } from "@/components/layout/footer/footer";
import { Navbar } from "@/components/layout/navbar/navbar";

/**
 * Layout for the main site.
 *
 * `(site)` is a route group - the parentheses keep it out of the URL, so the
 * page inside it is still `/`. It exists so the navbar, aurora and footer wrap
 * the real pages without appearing over /login and /signup, which have their own
 * centred layout.
 *
 * Aurora sits outside the flow at -z-10 and is `fixed`, so it never affects
 * layout and never scrolls.
 */
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-svh flex-col">
      <Aurora />
      <Navbar />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}
