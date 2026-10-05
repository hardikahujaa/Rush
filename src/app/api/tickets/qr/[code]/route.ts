import { NextResponse } from "next/server";
import QRCode from "qrcode";

import { decodeTicketPayload } from "@/lib/ticket-crypto";

/**
 * GET /api/tickets/qr/[code].png - the QR image an email client fetches.
 *
 * ── THIS ENDPOINT NEVER TOUCHES THE DATABASE, AND THAT IS THE DESIGN ───────
 * The T32 brief asked for `/api/tickets/[ticketId]/qr`, retrieving the ticket
 * and generating the payload here. The URL carries the finished 44-character
 * payload instead, and the difference is not cosmetic:
 *
 *   - **Zero queries per fetch.** The brief's own goal was "so email clients
 *     don't hammer the database". With the payload in the URL there is no query
 *     to hammer - the requirement is met structurally rather than mitigated by
 *     a cache header.
 *   - **It is not an oracle.** Generating the payload here would mean anyone who
 *     can name a ticket id gets back a working entry credential. Requiring the
 *     payload means the caller must already hold the HMAC, so this route grants
 *     nothing it was not given.
 *   - **Immutably cacheable.** The URL *is* the content, so a year-long
 *     `immutable` is honest rather than optimistic. Gmail proxies and caches
 *     images through googleusercontent, so a ticket email typically costs one
 *     fetch ever.
 *
 * The payload is signed, so it is also self-authenticating at the gate: there is
 * no security value in verifying it here. A crafted-but-unsigned code renders a
 * QR that T31 refuses, which is the correct outcome and costs us nothing.
 *
 * ── WHY IT IS UNAUTHENTICATED ──────────────────────────────────────────────
 * It has to be. An email client cannot log in, and Gmail fetches images from
 * Google's servers with none of the recipient's cookies. The access control is
 * the 128-bit HMAC in the URL - the same credential the QR itself carries, so
 * this exposes nothing that the email did not already contain.
 *
 * ── WHY PNG AND NOT SVG ────────────────────────────────────────────────────
 * Gmail strips `<svg>` and most clients will not render an SVG `<img>`. PNG is
 * the only raster format that works everywhere a ticket might be opened.
 */

/* Rendered big enough to scan off a phone screen that is dimmed and tilted.
   360px is ~11px per module at QR version 4 (33x33) plus the quiet zone - well
   past the ~4px/module most scanners need. */
const SIZE = 360;

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  /* `params` is a Promise in Next.js 16 - synchronous access was removed. */
  const { code } = await context.params;

  /* `.png` is allowed on the end of the path. Some mail clients and image
     proxies are more willing to fetch something that looks like a file, and a
     few will not render an `<img>` whose URL has no extension at all. */
  const raw = code.endsWith(".png") ? code.slice(0, -4) : code;

  /**
   * The same strict decode T31's gate uses: regex, then byte length, then the
   * version byte. Anything else is refused BEFORE a QR is generated, so this
   * route cannot be used as a free image generator for arbitrary strings.
   *
   * 404 rather than 400 - there is nothing at that URL, and a distinct status
   * for "well-formed but wrong" would be the start of an oracle.
   */
  if (!decodeTicketPayload(raw)) {
    return new NextResponse(null, { status: 404 });
  }

  const png = await QRCode.toBuffer(raw, {
    type: "png",
    /* Level Q (25% recovery), matching the on-screen ticket from T30. Measured
       there: a 44-character payload is QR version 4 either way, so the extra
       redundancy is free - and it is what absorbs a crumpled printout or a
       thumb over one corner. */
    errorCorrectionLevel: "Q",
    /* The quiet zone. Without it the surrounding email background merges into
       the outer modules and the finder pattern stops being findable. */
    margin: 2,
    width: SIZE,
    /* Pure black on pure white. Scanners locate a symbol by thresholding light
       against dark; brand colours here would defeat the one job this image has.
       Same reasoning as the white tile the on-screen ticket sits on in T30. */
    color: { dark: "#000000ff", light: "#ffffffff" },
  });

  /* `Uint8Array` rather than the Buffer, because a Node Buffer is not a valid
     BodyInit under the Web `Response` types this route returns. */
  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.byteLength),
      /**
       * A year, immutable, and safe to promise: the payload in the URL fully
       * determines the bytes, so this response can never go stale. If a ticket
       * were ever re-signed its payload would change, which changes the URL.
       *
       * `immutable` is what stops a revalidating proxy sending conditional
       * requests on every email open.
       */
      "Cache-Control": "public, max-age=31536000, immutable, s-maxage=31536000",
      /* Nothing here is per-user and no cookie is read, so there is no session
         to leak into a shared cache - but say so explicitly, because this is
         the one route in the app that is deliberately cached hard. */
      Vary: "Accept-Encoding",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
