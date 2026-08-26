/**
 * The ambient background for the whole site.
 *
 * Fixed rather than scrolled, so the light stays put while content moves over
 * it - the page reads as a lit room rather than a long painted strip.
 *
 * Four layers, each doing one job:
 *   1. three drifting colour fields (the aurora itself)
 *   2. a faint grid, masked so it fades out rather than ending on a hard edge
 *   3. grain, which stops the gradients banding on 8-bit displays
 *   4. a vignette that darkens the lower edge so body text always has ground
 *
 * All of it is CSS. No image requests, no canvas, no WebGL context to lose -
 * and it costs nothing on the main thread because only transforms animate.
 *
 * This is a server component; nothing here needs the browser.
 */
export function Aurora() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background grain"
    >
      {/* Violet — the primary mass, top-left. */}
      <div
        className="animate-drift-a absolute -left-[15%] -top-[25%] size-[70vw] max-h-[900px] max-w-[900px] rounded-full opacity-[0.55] blur-[100px]"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, color-mix(in oklch, var(--primary) 62%, transparent), transparent 68%)",
        }}
      />
      {/* Cyan — the counterweight, pulling the eye right and down. */}
      <div
        className="animate-drift-b absolute -right-[18%] top-[2%] size-[62vw] max-h-[820px] max-w-[820px] rounded-full opacity-[0.42] blur-[110px]"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, color-mix(in oklch, var(--brand-2) 55%, transparent), transparent 68%)",
        }}
      />
      {/* A dim violet echo low on the page, so the fold is not a dead zone. */}
      <div
        className="animate-drift-c absolute -bottom-[30%] left-[22%] size-[58vw] max-h-[760px] max-w-[760px] rounded-full opacity-[0.3] blur-[120px]"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, color-mix(in oklch, var(--primary) 48%, transparent), transparent 70%)",
        }}
      />

      {/* Grid. Masked to a soft ellipse so it never ends on a visible line. */}
      <div
        className="absolute inset-0 opacity-[0.045]"
        style={{
          backgroundImage:
            "linear-gradient(var(--foreground) 1px, transparent 1px), linear-gradient(90deg, var(--foreground) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage:
            "radial-gradient(120% 80% at 50% 0%, black 20%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(120% 80% at 50% 0%, black 20%, transparent 75%)",
        }}
      />

      {/* Vignette. Guarantees a dark floor under body copy no matter where the
          aurora has drifted to, which is what keeps text contrast honest. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, transparent 45%, var(--background) 92%)",
        }}
      />
    </div>
  );
}
