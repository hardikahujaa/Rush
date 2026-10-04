"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Scanner, type IDetectedBarcode } from "@yudiel/react-qr-scanner";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  Keyboard,
  Loader2,
  ShieldAlert,
  Wifi,
} from "lucide-react";

/** Every screen the gate can be on. */
type Phase =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "checking" }
  | { kind: "valid"; data: ScanOk }
  | { kind: "already"; data: ScanDup }
  | { kind: "forged" }
  /** A transport or server failure. NOT a verdict on the ticket. */
  | { kind: "unverified"; message: string }
  | { kind: "camera-blocked"; message: string };

type ScanOk = {
  section: string;
  row: string;
  seat: number;
  event: string;
  venue: string;
  startsAt: string;
};

type ScanDup = ScanOk & { scannedAt: string };

/** Auto-advance only on a pass — see the note at `settle`. */
const VALID_HOLD_MS = 3000;

function timeOnly(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

function dayAndTime(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

/**
 * THE GATE SCANNER.
 *
 * ── DESIGNED FOR A DARK DOORWAY, NOT A DESK ────────────────────────────────
 * Every other surface in this app is Obsidian & Champagne - restrained, gold on
 * black. This screen deliberately breaks that, and it is the same reasoning
 * that put the T30 QR on a stark white tile: the constraint here is physical,
 * not aesthetic. Someone is holding a phone at arm's length in a loud dark
 * queue and has under a second to read a verdict. So a result takes the whole
 * viewport in a saturated fill with near-black text, which stays legible
 * off-axis and at a glance. Gold-on-black would not.
 *
 * ── WHY SEVEN STATES AND NOT THREE ─────────────────────────────────────────
 * The brief names valid / already-scanned / forged. Two more are correctness:
 *
 *   `unverified`  - a 500 or a dropped connection. Painted AMBER, never red,
 *                   and worded "could not verify". A network blip must never
 *                   render as INVALID: that turns away a legitimate ticket
 *                   holder, which is the one error a door cannot make.
 *   `camera-blocked` - permission denied or no device. Promotes the manual
 *                   field to primary instead of showing an error page, so a
 *                   presenter with no webcam is never stuck.
 */
export function GateScanner() {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [manual, setManual] = useState("");
  const [showManual, setShowManual] = useState(false);

  /**
   * The last payload acted on.
   *
   * A camera emits detections many times a second, so one QR held in frame
   * would fire dozens of identical POSTs - the first admitting the ticket and
   * every one after it reporting ALREADY SCANNED, which would make a valid
   * ticket look used. This remembers what was just submitted and ignores it.
   */
  const lastPayload = useRef<string | null>(null);
  /** Guards against a second submit while one is in flight. */
  const inFlight = useRef(false);

  const isResult =
    phase.kind === "valid" ||
    phase.kind === "already" ||
    phase.kind === "forged" ||
    phase.kind === "unverified";

  /* ── feedback on the body, not just the eyes ───────────────────────────── */
  const buzz = useCallback((pattern: number | number[]) => {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* Unsupported on desktop Safari and iOS. A gate that cannot buzz is
         still a working gate, so this must never throw into the scan path. */
    }
  }, []);

  const submit = useCallback(
    async (payload: string) => {
      const value = payload.trim();
      if (!value || inFlight.current) return;
      if (value === lastPayload.current) return;

      lastPayload.current = value;
      inFlight.current = true;
      setPhase({ kind: "checking" });

      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          /* In the BODY. A ticket payload is a bearer credential and a query
             string would land in access logs and browser history. */
          body: JSON.stringify({ payload: value }),
          cache: "no-store",
        });

        const data = await response.json().catch(() => null);

        if (response.status === 200 && data?.status === "valid") {
          buzz(60);
          setPhase({ kind: "valid", data: data as ScanOk });
          return;
        }

        if (response.status === 409 && data?.status === "already_scanned") {
          buzz([90, 70, 90, 70, 90]);
          setPhase({ kind: "already", data: data as ScanDup });
          return;
        }

        if (response.status === 400 && data?.status === "forged") {
          buzz([200, 100, 200]);
          setPhase({ kind: "forged" });
          return;
        }

        /**
         * EVERYTHING ELSE IS "COULD NOT VERIFY", NOT "INVALID".
         *
         * 401 (session expired mid-shift), 403, 429 (scanning too fast) and 500
         * all land here. None of them is a statement about the ticket, so none
         * of them may paint red - the staff member needs to know the SYSTEM
         * failed, not the guest.
         */
        setPhase({
          kind: "unverified",
          message:
            data?.error?.message ??
            (response.status === 401
              ? "Your session expired. Sign in again."
              : "Could not reach the server."),
        });
      } catch {
        setPhase({
          kind: "unverified",
          message: "No connection. The ticket has not been checked.",
        });
      } finally {
        inFlight.current = false;
      }
    },
    [buzz],
  );

  const onScan = useCallback(
    (codes: IDetectedBarcode[]) => {
      const raw = codes[0]?.rawValue;
      if (raw) void submit(raw);
    },
    [submit],
  );

  /** Back to the camera, and clear the dedupe so the same code can be re-tried. */
  const next = useCallback(() => {
    lastPayload.current = null;
    setManual("");
    setPhase({ kind: "scanning" });
  }, []);

  /**
   * AUTO-ADVANCE ON A PASS ONLY, AND THAT ASYMMETRY IS THE POINT.
   *
   * A moving queue should not need a tap between every guest, so a green screen
   * clears itself after three seconds. A refusal does NOT: ALREADY SCANNED and
   * SECURITY REJECT stay until a human dismisses them, because somebody has to
   * read the original scan time and decide what to do about the person standing
   * in front of them. Clearing that automatically would hide the one screen
   * that needs a decision.
   */
  useEffect(() => {
    if (phase.kind !== "valid") return;
    const id = window.setTimeout(next, VALID_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [phase.kind, next]);

  /* ── the result takeovers ──────────────────────────────────────────────── */
  if (isResult) {
    const skin =
      phase.kind === "valid"
        ? { bg: "#16A34A", fg: "#04140A", label: "VALID ENTRY" }
        : phase.kind === "unverified"
          ? { bg: "#D97706", fg: "#1A0E00", label: "COULD NOT VERIFY" }
          : { bg: "#DC2626", fg: "#1A0303", label: phase.kind === "already" ? "ALREADY SCANNED" : "SECURITY REJECT" };

    return (
      <motion.main
        initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
        /* `fixed inset-0` so the verdict is the entire device, over the navbar
           included. At a door nothing else on the page matters. */
        className="fixed inset-0 z-[200] flex flex-col items-center justify-center px-6 text-center"
        style={{ background: skin.bg, color: skin.fg }}
        /* assertive, not polite: this interrupts on purpose. It is the one
           announcement on the whole site that should cut in. */
        role="alert"
        aria-live="assertive"
      >
        <div className="flex items-center gap-3">
          {phase.kind === "valid" ? (
            <CheckCircle2 className="size-10 shrink-0" aria-hidden="true" />
          ) : phase.kind === "already" ? (
            <AlertTriangle className="size-10 shrink-0" aria-hidden="true" />
          ) : phase.kind === "unverified" ? (
            <Wifi className="size-10 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldAlert className="size-10 shrink-0" aria-hidden="true" />
          )}
          <p className="text-3xl font-black uppercase tracking-tight sm:text-5xl">
            {skin.label}
          </p>
        </div>

        {phase.kind === "valid" && (
          <>
            {/* The seat, at the largest size the viewport allows - this is the
                single thing the staff member needs to read. */}
            <p className="mt-8 text-[13vw] font-black leading-none tracking-tighter tabular-nums sm:text-8xl">
              {phase.data.row}
              {phase.data.seat}
            </p>
            <p className="mt-3 text-xl font-bold uppercase tracking-[0.1em] sm:text-2xl">
              {phase.data.section}
            </p>
            <p className="mt-6 max-w-md text-sm font-medium opacity-80">
              {phase.data.event}
            </p>
            <p className="text-sm opacity-70">{phase.data.venue}</p>
            {/* The show's own date, so a ticket for the wrong night is visible
                to the person holding the scanner. Deliberately informational
                and NOT blocking: early arrivals and multi-day passes are real,
                and refusing them automatically would be worse than showing a
                human the date and letting them judge. */}
            <p className="mt-1 text-xs opacity-60">
              {dayAndTime(phase.data.startsAt)}
            </p>
          </>
        )}

        {phase.kind === "already" && (
          <>
            <p className="mt-7 text-base font-semibold uppercase tracking-[0.18em] opacity-80">
              First scanned at
            </p>
            <p className="mt-1 text-[12vw] font-black leading-none tabular-nums sm:text-7xl">
              {timeOnly(phase.data.scannedAt)}
            </p>
            <p className="mt-6 text-2xl font-bold tabular-nums">
              {phase.data.section} · {phase.data.row}
              {phase.data.seat}
            </p>
            <p className="mt-5 max-w-sm text-sm font-medium opacity-80">
              Someone has already entered on this ticket. Do not admit without a
              supervisor.
            </p>
          </>
        )}

        {phase.kind === "forged" && (
          <p className="mt-7 max-w-sm text-base font-semibold opacity-85">
            This code is not a valid ticket. It was not issued by Rush, or it has
            been altered.
          </p>
        )}

        {phase.kind === "unverified" && (
          <>
            <p className="mt-7 max-w-sm text-base font-semibold opacity-90">
              {phase.message}
            </p>
            <p className="mt-3 max-w-sm text-sm opacity-75">
              This is <strong>not</strong> a verdict on the ticket — nothing was
              checked in. Try the scan again.
            </p>
          </>
        )}

        <button
          type="button"
          onClick={next}
          autoFocus
          /* A huge target: this is pressed with a thumb, in the dark, possibly
             with gloves on. */
          className="mt-10 min-h-16 w-full max-w-sm rounded-2xl border-2 px-8 text-lg font-black uppercase tracking-wide outline-none transition-transform active:scale-[0.98] focus-visible:ring-4"
          style={{ borderColor: skin.fg, color: skin.fg }}
        >
          Tap to scan next
        </button>

        {phase.kind === "valid" && (
          <p className="mt-3 text-xs font-medium opacity-60">
            Clears automatically in 3s
          </p>
        )}
      </motion.main>
    );
  }

  /* ── idle / scanning / checking ────────────────────────────────────────── */
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-metal text-2xl font-bold tracking-[-0.03em] sm:text-3xl">
          Gate scanner
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Point the camera at a ticket&rsquo;s QR code. Each ticket admits one
          person, once.
        </p>
      </header>

      <div className="mt-6 overflow-hidden rounded-2xl border border-white/12 bg-black">
        {phase.kind === "idle" ? (
          <div className="flex flex-col items-center gap-5 px-6 py-16 text-center">
            <Camera className="size-8 text-gold" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              The camera starts only when you ask it to.
            </p>
            <button
              type="button"
              onClick={() => setPhase({ kind: "scanning" })}
              className="btn-gold min-h-14 w-full max-w-xs rounded-xl px-6 text-base font-bold uppercase tracking-wide outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              Start scanning
            </button>
          </div>
        ) : phase.kind === "camera-blocked" ? (
          <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <CameraOff className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-foreground">Camera unavailable</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              {phase.message} You can still check tickets in by pasting the code
              below.
            </p>
          </div>
        ) : (
          <div className="relative">
            <Scanner
              onScan={onScan}
              onError={(error) =>
                setPhase({
                  kind: "camera-blocked",
                  message:
                    error instanceof Error && error.message
                      ? error.message
                      : "The browser refused access to a camera.",
                })
              }
              /* QR only. Narrowing the format list means the decoder is not
                 also hunting for a dozen barcode symbologies on every frame. */
              formats={["qr_code"]}
              /* The rear camera on a phone, which is what a door uses. */
              constraints={{ facingMode: "environment" }}
              /* Frozen frame while a result is up, so the camera is not
                 decoding behind the takeover. */
              paused={phase.kind === "checking"}
              /* The library's own beep. In a loud room the sound carries
                 further than the colour does. */
              sound
              classNames={{ container: "w-full" }}
              styles={{ container: { aspectRatio: "1 / 1" } }}
            />

            {phase.kind === "checking" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
                <Loader2 className="size-7 animate-spin text-gold" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">Checking…</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── manual fallback ────────────────────────────────────────────────
          A first-class input, not a hidden escape hatch. It is how a
          presentation machine with no working webcam still demonstrates the
          gate, and how a staff member handles a cracked phone screen the
          camera cannot read. */}
      <div className="mt-5">
        {showManual || phase.kind === "camera-blocked" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(manual);
            }}
            className="glass rounded-xl p-4"
          >
            <label
              htmlFor="manual-code"
              className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
            >
              Enter ticket code
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                id="manual-code"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                /* The payload is base64url and case-sensitive, so every
                   browser-helpful transformation has to be switched off or a
                   phone keyboard will capitalise the first character and make a
                   valid ticket look forged. */
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                placeholder="44-character code from the ticket"
                className="h-12 min-w-0 flex-1 rounded-lg border border-input bg-black/40 px-3 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="submit"
                disabled={manual.trim().length === 0}
                className="btn-gold h-12 shrink-0 rounded-lg px-6 text-sm font-bold uppercase tracking-wide outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
              >
                Check
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="inline-flex items-center gap-2 text-xs font-medium text-gold-champagne underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Keyboard className="size-3.5" aria-hidden="true" />
            Enter a code manually instead
          </button>
        )}
      </div>
    </main>
  );
}
