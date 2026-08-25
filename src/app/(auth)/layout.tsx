import Link from "next/link";

/**
 * Shell for /login and /signup.
 *
 * `(auth)` is a ROUTE GROUP - the parentheses mean the folder name is not part
 * of the URL. It exists purely so these two pages can share this layout without
 * becoming /auth/login and /auth/signup.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-10 block text-center text-2xl font-semibold tracking-tight"
        >
          RUSH
        </Link>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Tickets are held for 10 minutes once selected.
        </p>
      </div>
    </main>
  );
}
