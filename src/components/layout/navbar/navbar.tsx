import { CartButton } from "@/components/layout/navbar/cart-button";
import { CategoriesMenu } from "@/components/layout/navbar/categories-menu";
import { GlobalSearch } from "@/components/layout/navbar/global-search";
import { LocationSelector } from "@/components/layout/navbar/location-selector";
import { Logo } from "@/components/layout/navbar/logo";
import { MobileMenu } from "@/components/layout/navbar/mobile-menu";
import { NavbarShell } from "@/components/layout/navbar/navbar-shell";
import { UserNav } from "@/components/layout/navbar/user-nav";
import { getCurrentUser } from "@/lib/auth";

/**
 * The global navigation bar.
 *
 * A SERVER component. It reads the signed-in user through getCurrentUser(),
 * which verifies the JWT signature and then reads the role from the database -
 * the same T15 path as before, untouched. The role never round-trips through the
 * client, and every route it links to is independently enforced by
 * requireUser()/requireRole() inside the page.
 *
 * Layout: identity and place on the left, the search in the centre where it gets
 * the most room, and everything that acts on your account on the right.
 */
export async function Navbar() {
  const user = await getCurrentUser();
  const navUser = user
    ? { email: user.email, name: user.name, role: user.role }
    : null;

  return (
    <NavbarShell>
      {/* Left — identity and place */}
      <div className="flex shrink-0 items-center gap-1">
        <Logo />
        <span
          aria-hidden="true"
          className="mx-1 hidden h-5 w-px bg-border/70 md:block"
        />
        <LocationSelector className="hidden md:flex" />
      </div>

      {/* Centre — search. Takes the slack so it grows with the viewport. */}
      <div className="mx-auto hidden w-full max-w-xl flex-1 px-4 md:block">
        <GlobalSearch />
      </div>

      {/* Right — account actions */}
      <div className="flex shrink-0 items-center gap-1">
        <CategoriesMenu />
        <CartButton />
        <UserNav user={navUser} />
        <MobileMenu user={navUser} />
      </div>
    </NavbarShell>
  );
}
