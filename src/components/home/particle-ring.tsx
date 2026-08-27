"use client";

import { useEffect, useRef } from "react";

import { shatterStore } from "@/lib/shatter-store";

const PARTICLE_COUNT = 200;
const GOLD = "250, 204, 21"; // #FACC15

type Particle = {
  /** Current drawn position. */
  x: number;
  y: number;
  /** Resting position on the ring. */
  originX: number;
  originY: number;
  /** Where the particle is currently heading. */
  targetX: number;
  targetY: number;
  /** Per-particle easing factor, so they never move as one rigid body. */
  lerp: number;
  /** Depth in the shattered cluster, -1..1. Drives size and alpha only. */
  depth: number;
  /** Radial jitter that keeps the ring a band rather than a hairline. */
  jitter: number;
  angle: number;
};

/**
 * Canvas particle ring.
 *
 * 200 particles rest on an ellipse matching the gold halo. While the Categories
 * menu is hovered they scatter into a tight cluster at the centre; on leave they
 * fly back and reform the ring. Movement is linear interpolation toward a
 * per-particle target, so both directions are the same code path.
 *
 * ── WHY A CACHED SPRITE INSTEAD OF ctx.shadowBlur ──────────────────────────
 * The brief asks for a shadow-blur glow. Done literally that is 200 blurred
 * draws per frame, and canvas shadowBlur is un-cached and notoriously the
 * single most expensive operation in 2D canvas - it alone would miss the 16ms
 * frame budget on mid-range hardware and produce exactly the lag the brief says
 * to avoid. The glow is instead rendered ONCE into a small offscreen canvas and
 * blitted with drawImage, which is a cheap textured quad. Same glow, ~200x less
 * per-frame work.
 *
 * ── WHY NO REACT STATE ─────────────────────────────────────────────────────
 * Hover state is read from a module store inside the loop. React renders this
 * component once and never again; nothing in the tree re-renders while the
 * pointer moves across the navbar.
 */
export function ParticleRing() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    const particles: Particle[] = [];

    /* ── the glow sprite ───────────────────────────────────────────────── */
    const sprite = document.createElement("canvas");
    const spriteCtx = sprite.getContext("2d");

    function buildSprite(scale: number) {
      if (!spriteCtx) return;
      const size = Math.ceil(18 * scale);
      sprite.width = size;
      sprite.height = size;
      const r = size / 2;
      const gradient = spriteCtx.createRadialGradient(r, r, 0, r, r, r);
      // Opaque core, then a fast falloff - a faint halo rather than a smudge.
      gradient.addColorStop(0, `rgba(${GOLD}, 1)`);
      gradient.addColorStop(0.18, `rgba(${GOLD}, 0.92)`);
      gradient.addColorStop(0.45, `rgba(${GOLD}, 0.22)`);
      gradient.addColorStop(1, `rgba(${GOLD}, 0)`);
      spriteCtx.clearRect(0, 0, size, size);
      spriteCtx.fillStyle = gradient;
      spriteCtx.fillRect(0, 0, size, size);
    }

    /* ── geometry ─────────────────────────────────────────────────────── */

    /** Ring radii, inset so a particle's glow is never clipped by the edge. */
    function radii() {
      const inset = 12;
      return {
        cx: width / 2,
        cy: height / 2,
        rx: Math.max(1, width / 2 - inset),
        ry: Math.max(1, height / 2 - inset),
      };
    }

    function layoutRing() {
      const { cx, cy, rx, ry } = radii();
      for (const p of particles) {
        // Ellipse, not circle: the halo is far wider than it is tall, and a
        // circular ring inside it would not line up with anything.
        p.originX = cx + Math.cos(p.angle) * rx * (1 + p.jitter);
        p.originY = cy + Math.sin(p.angle) * ry * (1 + p.jitter);
      }
    }

    function seed() {
      particles.length = 0;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
        const p: Particle = {
          angle,
          // ±2.5% of the radius keeps the ring a band with some grain in it.
          jitter: (Math.random() - 0.5) * 0.05,
          x: 0,
          y: 0,
          originX: 0,
          originY: 0,
          targetX: 0,
          targetY: 0,
          lerp: 0.055 + Math.random() * 0.055,
          depth: 0,
        };
        particles.push(p);
      }
      layoutRing();
      for (const p of particles) {
        p.x = p.targetX = p.originX;
        p.y = p.targetY = p.originY;
      }
    }

    /** Scatter into a tight, chaotic sphere at the centre. */
    function shatterTargets() {
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.34;

      for (const p of particles) {
        /* Uniform inside a sphere: cbrt on the radius stops everything piling
           up at the centre, and acos on phi stops it banding at the poles. */
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = radius * Math.cbrt(Math.random());
        const sinPhi = Math.sin(phi);

        p.depth = Math.cos(phi);
        // The canvas is much wider than tall, so x is stretched to keep the
        // cluster reading as a sphere rather than a vertical lozenge.
        p.targetX = cx + r * sinPhi * Math.cos(theta) * 1.9;
        p.targetY = cy + r * sinPhi * Math.sin(theta);
      }
    }

    function ringTargets() {
      for (const p of particles) {
        p.depth = 0;
        p.targetX = p.originX;
        p.targetY = p.originY;
      }
    }

    /* ── rendering ────────────────────────────────────────────────────── */

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);

      const half = sprite.width / 2 / dpr;

      for (const p of particles) {
        p.x += (p.targetX - p.x) * p.lerp;
        p.y += (p.targetY - p.y) * p.lerp;

        // Depth only ever shrinks or dims - a particle at the back of the
        // cluster reads as further away without needing a real 3D projection.
        const scale = 1 + p.depth * 0.35;
        const alpha = 0.55 + (p.depth + 1) * 0.22;

        ctx.globalAlpha = Math.min(1, alpha);
        const size = sprite.width / dpr * scale;
        ctx.drawImage(sprite, p.x - half * scale, p.y - half * scale, size, size);
      }
      ctx.globalAlpha = 1;
    }

    /* ── sizing ───────────────────────────────────────────────────────── */

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      dpr = Math.min(window.devicePixelRatio || 1, 2); // cap: 3x costs 2.25x
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      // Draw in CSS pixels; the transform handles the device ratio.
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      buildSprite(dpr);
      if (particles.length === 0) seed();
      else {
        layoutRing();
        if (!shatterStore.get()) ringTargets();
      }
      draw();
    }

    /* ── loop ─────────────────────────────────────────────────────────── */

    let frame = 0;
    let visible = true;

    function tick() {
      draw();
      frame = requestAnimationFrame(tick);
    }

    function start() {
      if (frame || reduceMotion || !visible) return;
      frame = requestAnimationFrame(tick);
    }

    function stop() {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    }

    resize();

    if (reduceMotion) {
      /* Reduced motion: the ring is drawn once and never animates. The shatter
         is pure decoration, and continuous particle motion is exactly what this
         preference exists to suppress. */
      draw();
      return () => {
        stop();
      };
    }

    const unsubscribe = shatterStore.subscribe(() => {
      if (shatterStore.get()) shatterTargets();
      else ringTargets();
      start(); // a change while paused must not be missed
    });

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    /* Do not burn frames on a canvas nobody can see - scrolled past, or in a
       background tab. */
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) start();
        else stop();
      },
      { threshold: 0 },
    );
    intersectionObserver.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    start();

    return () => {
      stop();
      unsubscribe();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full"
    />
  );
}
