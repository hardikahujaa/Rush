"use client";

import { useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

import { formatPaise } from "@/lib/format";

export type TicketCardData = {
  ticketId: string;
  sectionName: string;
  rowLabel: string;
  seatNo: number;
  priceCents: number;
  checkedInAt: string | null;
  /** The 44-char signed payload, generated on the server. */
  payload: string;
};

/**
 * One seat, as a ticket stub.
 *
 * ── WHAT CROSSES THE SERVER/CLIENT BOUNDARY ────────────────────────────────
 * Only `payload` - the finished 44-character signed string. Not
 * `QR_SIGNING_SECRET`, not the full 64-hex `qr_signature`, not the order id.
 * This component could not mint a ticket for a seat it was not handed, which is
 * the entire point of signing server-side.
 */
export function TicketCard({
  ticket,
  index,
}: {
  ticket: TicketCardData;
  index: number;
}) {
  const reduceMotion = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);

  const spent = ticket.checkedInAt !== null;

  /**
   * THE TILT.
   *
   * Raw pointer position goes into motion values, which a spring smooths - so
   * the card follows the cursor with a little weight instead of snapping to it.
   * Driven by `onPointerMove` rather than CSS hover because the rotation has to
   * respond to WHERE on the card the pointer is, which CSS cannot express.
   *
   * `useSpring` on the rotation rather than a transition on the element: a
   * transition would re-animate from scratch on every mousemove event and
   * stutter. A spring is a continuous simulation being handed new targets,
   * which is what smooth tracking actually needs.
   */
  const rotateX = useSpring(useMotionValue(0), { stiffness: 220, damping: 22 });
  const rotateY = useSpring(useMotionValue(0), { stiffness: 220, damping: 22 });

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    /* Touch has no hover, so a tilt there would stick wherever the finger
       lifted and look broken. Pointer type is the only reliable way to tell. */
    if (reduceMotion || event.pointerType !== "mouse") return;

    const el = cardRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    /* -0.5 .. +0.5 from the card's centre. */
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;

    /* Deliberately shallow - 7 degrees. A ticket is a flat object and a big
       rotation makes it read as a game card. It also keeps the QR close to
       square, which matters because a steeply skewed QR is harder to scan off
       a screen. */
    rotateY.set(px * 14);
    rotateX.set(-py * 14);
  }

  function resetTilt() {
    rotateX.set(0);
    rotateY.set(0);
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.55,
        /* Staggered so a wallet of four tickets deals out rather than
           appearing. Same curve as the T29 success page. */
        delay: 0.08 + index * 0.09,
        ease: [0.16, 1, 0.3, 1],
      }}
      /* The perspective root. Without it rotateX/rotateY are an affine skew
         with no depth - the card shears instead of tilting. */
      style={{ perspective: 1100 }}
    >
      <motion.div
        ref={cardRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={resetTilt}
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        className={`glass relative overflow-hidden rounded-2xl ${
          spent ? "opacity-60" : ""
        }`}
      >
        {/* Gold lit edge along the top, dropped once the ticket is spent. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-px"
          style={{
            background: spent
              ? "linear-gradient(90deg, transparent, rgba(255,255,255,0.14) 50%, transparent)"
              : "linear-gradient(90deg, transparent, rgba(250,204,21,0.7) 50%, transparent)",
          }}
        />

        <div className="flex flex-col sm:flex-row">
          {/* ── left: the seat ─────────────────────────────────────────── */}
          <div className="min-w-0 flex-1 px-5 py-5 sm:px-6">
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Admit one
            </p>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <Field label="Section" value={ticket.sectionName} />
              <Field label="Row" value={ticket.rowLabel} />
              <Field label="Seat" value={String(ticket.seatNo)} />
            </div>

            <div className="rule-fade my-4 h-px" aria-hidden="true" />

            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Paid
                </p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-gold-champagne">
                  {formatPaise(ticket.priceCents)}
                </p>
              </div>

              {spent && (
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-live">
                  <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                  Checked in
                </p>
              )}
            </div>
          </div>

          {/* ── the perforation ────────────────────────────────────────── */}
          <div
            aria-hidden="true"
            className="relative shrink-0 sm:w-px"
            /* A dashed line, plus the two notches a torn stub leaves behind.
               Horizontal on phones where the card stacks, vertical on desktop
               where it sits side by side. */
          >
            <div className="absolute inset-x-5 top-0 h-px border-t border-dashed border-white/20 sm:inset-x-auto sm:inset-y-5 sm:left-0 sm:h-auto sm:w-px sm:border-l sm:border-t-0" />
            {/* The notches are filled with the PAGE ground, not a colour, so
                they read as holes punched through the card. */}
            <span className="absolute -left-2 -top-2 size-4 rounded-full bg-background sm:-top-2 sm:left-[-0.5rem]" />
            <span className="absolute -bottom-2 -right-2 size-4 rounded-full bg-background sm:bottom-[-0.5rem] sm:left-[-0.5rem] sm:right-auto" />
          </div>

          {/* ── right: the QR ──────────────────────────────────────────── */}
          <div className="flex shrink-0 flex-col items-center gap-2.5 px-5 py-5 sm:px-6">
            {/*
              STARK WHITE, AND THAT IS FUNCTIONAL, NOT A STYLE LAPSE.

              This is the one place the Obsidian theme is deliberately broken.
              A scanner finds a QR by thresholding light against dark and
              locating three high-contrast finder squares. Champagne modules on
              black would invert that relationship and sit at a fraction of the
              contrast ratio the format assumes - it would decode slowly on a
              good camera and not at all on a cheap one.

              `marginSize={2}` is the quiet zone. The spec requires clear space
              around the symbol; without it the card's own edge merges into the
              outer modules and the finder pattern stops being findable.
            */}
            <div className="rounded-xl bg-white p-3 shadow-[0_0_30px_-10px_rgba(250,204,21,0.45)]">
              <QRCodeSVG
                value={ticket.payload}
                size={132}
                /**
                 * Level Q - 25% error recovery - and it is FREE here.
                 *
                 * Measured, not assumed: 44 characters needs Version 4 (33x33)
                 * at level M, because v4-M holds 62 bytes while v3-M holds only
                 * 42. But v4-Q holds 46, so level Q also lands on 33x33 - the
                 * identical grid with 10 percentage points more redundancy.
                 *
                 * That redundancy is what absorbs the specific damage this code
                 * will meet: glare on a glossy phone screen, moire against a
                 * webcam's sensor grid, and a thumb over one corner. Taking it
                 * for nothing would be silly.
                 */
                level="Q"
                marginSize={2}
                bgColor="#FFFFFF"
                fgColor="#000000"
                /* A QR is not decoration. Screen readers get the seat, which is
                   the information; the modules themselves are meaningless to
                   anyone not holding a camera. */
                title={`Entry code for ${ticket.sectionName} row ${ticket.rowLabel} seat ${ticket.seatNo}`}
                className={spent ? "opacity-40" : undefined}
              />
            </div>

            <p className="text-center font-mono text-[10px] leading-tight text-muted-foreground">
              {/* Enough to quote to a staff member, not the whole id. */}
              <span className="select-all">{ticket.ticketId.slice(0, 8)}</span>
            </p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-base font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}
