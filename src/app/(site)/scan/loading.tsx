/**
 * `/scan` has no server-rendered shape worth mirroring - `<GateScanner>` is a
 * full-bleed client island (the camera viewfinder), not a layout `loading.tsx`
 * can usefully sketch in advance. This is deliberately a plain centred
 * message rather than a mis-shaped skeleton pretending to know what a camera
 * feed looks like.
 */
export default function ScanLoading() {
  return (
    <main className="flex min-h-[70svh] flex-col items-center justify-center px-4 text-center">
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        Preparing the scanner…
      </p>
    </main>
  );
}
