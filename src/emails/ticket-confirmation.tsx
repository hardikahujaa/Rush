import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

import { formatPaise } from "@/lib/format";

export type TicketEmailSeat = {
  sectionName: string;
  rowLabel: string;
  seatNo: number;
  priceCents: number;
  /** Absolute URL to the PNG endpoint. Must be public for a client to fetch. */
  qrUrl: string;
  /** Shown under the code so staff can be quoted a reference. */
  ticketRef: string;
};

export type TicketEmailProps = {
  eventTitle: string;
  venue: string;
  startsAt: Date;
  totalCents: number;
  seats: TicketEmailSeat[];
  orderRef: string;
  ticketsUrl: string;
};

/**
 * The ticket confirmation email (T32).
 *
 * ── EMAIL CSS IS NOT WEB CSS, AND THE DESIGN BENDS TO THAT ─────────────────
 * The Obsidian & Champagne palette survives; the techniques that render it on
 * the web do not. Outlook renders through Word's engine, Gmail strips `<style>`
 * blocks in some contexts, and support for flexbox, grid, `oklch()`, custom
 * properties, `backdrop-filter` and even `background-image` is patchy to absent.
 *
 * So everything here is:
 *   - **table-based layout** via react-email's Section/Row primitives
 *   - **inline styles only** - no classes, no stylesheet
 *   - **hex colours, never `oklch()`** - the project's tokens are oklch, so each
 *     one is converted by hand here and the pairs are noted below
 *   - **no gradients for anything load-bearing** - the champagne rules are flat
 *     borders, because a gradient that silently fails to paint would take the
 *     visual structure with it
 *
 * ── DARK BACKGROUNDS IN EMAIL ARE A CALCULATED RISK ────────────────────────
 * Some clients (notably Outlook on Windows and a few Android clients) force
 * their own light background and invert or ignore `background-color`. Every text
 * colour here is therefore chosen to stay legible on EITHER ground: the body
 * copy is a mid-light grey that reads on black and on white, and nothing
 * critical is white-on-black-only. The gold accents are dark enough to read on
 * white and light enough to read on black.
 */
export function TicketConfirmationEmail({
  eventTitle,
  venue,
  startsAt,
  totalCents,
  seats,
  orderRef,
  ticketsUrl,
}: TicketEmailProps) {
  const when = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(startsAt);

  return (
    <Html lang="en">
      <Head />
      {/* The inbox list preview. Without it clients show the first words of the
          body, which would be the word "RUSH" repeated from the header. */}
      <Preview>
        {`${seats.length} ${seats.length === 1 ? "ticket" : "tickets"} for ${eventTitle} — show the QR at the gate`}
      </Preview>

      <Body style={body}>
        <Container style={container}>
          {/* ── header ──────────────────────────────────────────────────── */}
          <Section style={{ paddingBottom: "4px" }}>
            <Text style={wordmark}>RUSH</Text>
          </Section>

          <Text style={h1}>You&rsquo;re going.</Text>
          <Text style={lede}>
            Payment confirmed. Your {seats.length === 1 ? "ticket is" : "tickets are"}{" "}
            below &mdash; show the QR {seats.length === 1 ? "code" : "codes"} at the
            gate.
          </Text>

          <Hr style={rule} />

          {/* ── the event ───────────────────────────────────────────────── */}
          <Section>
            <Text style={label}>Event</Text>
            <Text style={eventName}>{eventTitle}</Text>
            <Text style={meta}>{when}</Text>
            <Text style={meta}>{venue}</Text>
          </Section>

          <Hr style={rule} />

          {/* ── a stub per seat ─────────────────────────────────────────────
              One QR per seat, because each seat is a separate ticket that is
              scanned once. A single code for a four-seat order would mean the
              group could not split up, and the gate could not tell which of the
              four had already walked in. */}
          <Text style={label}>
            {seats.length} {seats.length === 1 ? "Ticket" : "Tickets"}
          </Text>

          {seats.map((seat) => (
            <Section key={seat.ticketRef} style={stub}>
              {/* The QR sits on its own WHITE tile even inside a dark email.
                  Functional, not decorative: a scanner finds a symbol by
                  thresholding light against dark, so the quiet zone has to stay
                  white whatever the surrounding client decides to paint. */}
              <table
                width="100%"
                cellPadding={0}
                cellSpacing={0}
                role="presentation"
                style={{ borderCollapse: "collapse" }}
              >
                <tbody>
                  <tr>
                    <td style={stubInfo}>
                      <Text style={seatLine}>{seat.sectionName}</Text>
                      <Text style={seatBig}>
                        Row {seat.rowLabel} &middot; Seat {seat.seatNo}
                      </Text>
                      <Text style={seatPrice}>{formatPaise(seat.priceCents)}</Text>
                      <Text style={seatRef}>#{seat.ticketRef}</Text>
                    </td>
                    <td style={stubQr}>
                      <div style={qrTile}>
                        <Img
                          src={seat.qrUrl}
                          width="132"
                          height="132"
                          /* Alt text carries the seat, because a client with
                             remote images blocked shows only this. The PNG is
                             ALSO attached to the message for exactly that case
                             - see the note in src/lib/email.ts. */
                          alt={`Entry QR — ${seat.sectionName}, row ${seat.rowLabel}, seat ${seat.seatNo}`}
                          style={{ display: "block", border: "0" }}
                        />
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>
          ))}

          <Hr style={rule} />

          {/* ── total ───────────────────────────────────────────────────── */}
          <Section>
            <Text style={label}>Total paid</Text>
            <Text style={total}>{formatPaise(totalCents)}</Text>
            <Text style={{ ...meta, marginTop: "2px" }}>Order #{orderRef}</Text>
          </Section>

          <Hr style={rule} />

          <Section>
            <Link href={ticketsUrl} style={button}>
              View tickets online
            </Link>
          </Section>

          {/* ── the honest warning, same wording as the T30 page ─────────── */}
          <Text style={fine}>
            Each code is signed and can be scanned <strong>once</strong>. Keep a
            screenshot in case signal at the venue is poor &mdash; but never share
            the image. Whoever is scanned first is let in, and the ticket is then
            refused for everyone else, including you.
          </Text>

          <Text style={footer}>
            Rush &middot; This email was sent because a payment completed. If that
            wasn&rsquo;t you, reply to this message.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/* ── styles ───────────────────────────────────────────────────────────────
   Hex equivalents of the project's oklch tokens, converted once here:
     --background     oklch(0 0 0)          -> #000000
     --foreground     oklch(0.985 0 0)      -> #FAFAFA
     --gold           oklch(0.786 0.153 74) -> #F59E0B
     --gold-champagne oklch(0.925 0.055 88) -> #FFE4B5
     --muted-fg       oklch(0.72 0.014 80)  -> #B3AFA8
   Kept as literals because email cannot read a custom property. */

const body: React.CSSProperties = {
  backgroundColor: "#000000",
  margin: 0,
  padding: "24px 0",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const container: React.CSSProperties = {
  width: "100%",
  maxWidth: "560px",
  margin: "0 auto",
  padding: "28px 24px 32px",
  backgroundColor: "#0A0A0A",
  /* A border, not a shadow: box-shadow is widely dropped, a border is not. */
  border: "1px solid #211C12",
  borderRadius: "14px",
};

const wordmark: React.CSSProperties = {
  margin: 0,
  fontSize: "15px",
  fontWeight: 800,
  letterSpacing: "0.22em",
  color: "#F59E0B",
};

const h1: React.CSSProperties = {
  margin: "14px 0 0",
  fontSize: "28px",
  lineHeight: "1.15",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "#FAFAFA",
};

const lede: React.CSSProperties = {
  margin: "10px 0 0",
  fontSize: "14px",
  lineHeight: "1.6",
  color: "#B3AFA8",
};

const rule: React.CSSProperties = {
  borderColor: "#211C12",
  borderWidth: "1px 0 0",
  borderStyle: "solid",
  margin: "22px 0",
};

const label: React.CSSProperties = {
  margin: 0,
  fontSize: "10px",
  fontWeight: 600,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: "#8A857D",
};

const eventName: React.CSSProperties = {
  margin: "6px 0 0",
  fontSize: "19px",
  fontWeight: 700,
  lineHeight: "1.3",
  color: "#FFE4B5",
};

const meta: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: "13px",
  lineHeight: "1.5",
  color: "#B3AFA8",
};

const stub: React.CSSProperties = {
  marginTop: "12px",
  padding: "14px",
  backgroundColor: "#121008",
  border: "1px solid #2A2317",
  borderRadius: "10px",
};

const stubInfo: React.CSSProperties = {
  verticalAlign: "middle",
  paddingRight: "12px",
};

const stubQr: React.CSSProperties = {
  verticalAlign: "middle",
  width: "148px",
  textAlign: "right",
};

const qrTile: React.CSSProperties = {
  display: "inline-block",
  padding: "8px",
  backgroundColor: "#FFFFFF",
  borderRadius: "8px",
};

const seatLine: React.CSSProperties = {
  margin: 0,
  fontSize: "10px",
  fontWeight: 600,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "#F59E0B",
};

const seatBig: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: "17px",
  fontWeight: 700,
  color: "#FAFAFA",
};

const seatPrice: React.CSSProperties = {
  margin: "6px 0 0",
  fontSize: "14px",
  fontWeight: 600,
  color: "#FFE4B5",
};

const seatRef: React.CSSProperties = {
  margin: "6px 0 0",
  fontSize: "11px",
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  color: "#8A857D",
};

const total: React.CSSProperties = {
  margin: "6px 0 0",
  fontSize: "26px",
  fontWeight: 700,
  color: "#FFE4B5",
};

const button: React.CSSProperties = {
  display: "inline-block",
  padding: "13px 26px",
  /* Flat gold, not a gradient - a gradient that fails to paint in Outlook
     would leave dark text on a dark button. */
  backgroundColor: "#F59E0B",
  color: "#12100A",
  fontSize: "14px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textDecoration: "none",
  borderRadius: "9px",
};

const fine: React.CSSProperties = {
  margin: "22px 0 0",
  fontSize: "11px",
  lineHeight: "1.65",
  color: "#8A857D",
};

const footer: React.CSSProperties = {
  margin: "18px 0 0",
  fontSize: "10px",
  lineHeight: "1.6",
  color: "#6B6660",
};

export default TicketConfirmationEmail;
