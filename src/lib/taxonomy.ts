/**
 * Cities the location selector offers.
 *
 * ── CATEGORIES WERE REMOVED IN T17 ─────────────────────────────────────────
 * This file used to export a six-entry `CATEGORIES` tree driving a homepage
 * chip rail, a navbar mega-menu and the mobile menu. Every one of those links
 * pointed at `/events?category=<slug>` and every one was a 404: there is no
 * category column on `events`, so the filter could never have done anything.
 * Rather than invent categories or let the links keep lying, `/events` now
 * filters by status - on sale / upcoming / past - which is derived from
 * `status` + `drop_at` + `starts_at` and is therefore real.
 *
 * `CITIES` survives because the location selector is a display-only control -
 * it sets no query and navigates nowhere - and because the catalogue now spans
 * four cities for real (Chennai, Mumbai, Bengaluru, Delhi NCR). The list stays
 * MOCK until there is a cities table to read; `/events?q=<city>` is the thing
 * that actually filters by place today, via the venue join.
 */
export const CITIES = [
  { slug: "chennai", label: "Chennai", state: "Tamil Nadu" },
  { slug: "mumbai", label: "Mumbai", state: "Maharashtra" },
  { slug: "bengaluru", label: "Bengaluru", state: "Karnataka" },
  { slug: "delhi", label: "New Delhi", state: "Delhi NCR" },
  { slug: "hyderabad", label: "Hyderabad", state: "Telangana" },
  { slug: "kolkata", label: "Kolkata", state: "West Bengal" },
  { slug: "pune", label: "Pune", state: "Maharashtra" },
  { slug: "goa", label: "Goa", state: "Goa" },
];
