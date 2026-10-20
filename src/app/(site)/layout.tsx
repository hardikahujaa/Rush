import { VoidFlashlight } from "@/components/backdrop/void-flashlight";
import { DemoResetButton } from "@/components/demo/demo-reset-button";
import { Navbar } from "@/components/layout/navbar/navbar";

/**
 * Layout for the main site.
 *
 * `(site)` is a route group - the parentheses keep it out of the URL, so the
 * page inside it is still `/`. It wraps the real pages without appearing over
 * /login and /signup, which have their own centred layout.
 *
 * ── WHY THIS WRAPPER NO LONGER PAINTS bg-black ─────────────────────────────
 * It used to. That is incompatible with a z-index -1 child: in CSS painting
 * order a negative-z child is drawn immediately after its stacking context's
 * own background, so an opaque background here would cover the flashlight
 * completely - invisible, with nothing obviously wrong.
 *
 * The ground is unchanged: `body` already paints `--background`, which is pure
 * black. Removing it here costs nothing visually and lets the grid sit between
 * the page ground and the content.
 *
 * `isolate` is the other half of it. Without a stacking context here the
 * negative-z child would escape upward and land behind the canvas background
 * instead, which is the classic way this effect silently disappears.
 */
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative isolate flex min-h-svh flex-col">
      <VoidFlashlight />
      <Navbar />
      <div className="flex-1">{children}</div>
      {/* Organizer-only; the component itself returns null for everyone
          else - see demo-reset-button.tsx. Lives in THIS layout, not the
          root one, because it needs getCurrentUser() either way and the
          Navbar right above it already pays for that lookup on every page
          this layout wraps - (auth)'s login/signup pages do not. */}
      <DemoResetButton />
    </div>
  );
}
