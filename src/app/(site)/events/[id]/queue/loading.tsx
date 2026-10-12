import { PageSkeleton } from "@/components/layout/page-skeleton";

export default function QueueLoading() {
  return (
    <main className="mx-auto max-w-xl px-4 pb-page-b pt-page sm:px-6 sm:pt-page-lg">
      <div className="text-center">
        <PageSkeleton label="Checking the queue…" headingWidth="14rem" lines={1} />
      </div>
      {/* The lobby panel's own rough shape - a glass card roughly where the
          position readout will land, so the swap from this to the real
          lobby doesn't jump the page. */}
      <div
        aria-hidden="true"
        className="glass motion-safe:animate-pulse mt-9 h-64 rounded-2xl border-gold/20"
      />
    </main>
  );
}
