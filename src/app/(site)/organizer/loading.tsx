import { PageSkeleton } from "@/components/layout/page-skeleton";

export default function OrganizerLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-page-b pt-page sm:pt-page-lg">
      <PageSkeleton label="Loading…" headingWidth="8rem" lines={2} />
    </main>
  );
}
