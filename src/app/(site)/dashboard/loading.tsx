import { PageSkeleton } from "@/components/layout/page-skeleton";

export default function DashboardLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-page-b pt-page sm:pt-page-lg">
      <PageSkeleton label="Loading your dashboard…" headingWidth="10rem" lines={2} />
    </main>
  );
}
