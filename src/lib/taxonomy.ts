import {
  Clapperboard,
  Drama,
  Music4,
  PartyPopper,
  Trophy,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * Event taxonomy.
 *
 * MOCK DATA. There is no categories table in the database yet - `events`
 * currently belongs to a venue and an organizer and nothing else. When
 * categories are added to the schema this file becomes the seed for them, and
 * every component below already takes its data as props, so the swap is a
 * change of source rather than a rewrite.
 */

export type Subcategory = {
  slug: string;
  label: string;
  /** Shown in the mega-menu under the label. */
  blurb: string;
};

export type Category = {
  slug: string;
  label: string;
  icon: LucideIcon;
  /** Short line for the mega-menu column header. */
  tagline: string;
  /** Hue used for the category's accent wash, in oklch degrees. */
  hue: number;
  subcategories: Subcategory[];
};

export const CATEGORIES: Category[] = [
  {
    slug: "movies",
    label: "Movies",
    icon: Clapperboard,
    tagline: "Premieres, re-releases and format screenings",
    hue: 95,
    subcategories: [
      { slug: "imax", label: "IMAX & Large Format", blurb: "70mm, laser and dome" },
      { slug: "premieres", label: "First Day First Show", blurb: "Opening-night seats" },
      { slug: "regional", label: "Regional Cinema", blurb: "Tamil, Telugu, Malayalam" },
      { slug: "restored", label: "Restored Classics", blurb: "4K remasters on film" },
      { slug: "recliner", label: "Recliner & Luxe", blurb: "Reclining suites, in-seat service" },
    ],
  },
  {
    slug: "concerts",
    label: "Live Concerts",
    icon: Music4,
    tagline: "Arena tours, intimate sets and residencies",
    hue: 88,
    subcategories: [
      { slug: "arena", label: "Arena Tours", blurb: "Stadium-scale productions" },
      { slug: "indie", label: "Indie & Alternative", blurb: "Club shows and small rooms" },
      { slug: "classical", label: "Classical & Orchestral", blurb: "Symphonies and recitals" },
      { slug: "electronic", label: "Electronic", blurb: "All-night sets and warehouses" },
      { slug: "ghazal", label: "Ghazal & Sufi", blurb: "Seated, acoustic evenings" },
    ],
  },
  {
    slug: "comedy-theater",
    label: "Comedy & Theater",
    icon: Drama,
    tagline: "Stand-up, plays and improv",
    hue: 75,
    subcategories: [
      { slug: "standup", label: "Stand-Up Specials", blurb: "Hour-long touring sets" },
      { slug: "improv", label: "Improv Nights", blurb: "Unscripted, audience-led" },
      { slug: "plays", label: "Contemporary Plays", blurb: "New writing and revivals" },
      { slug: "musicals", label: "Musicals", blurb: "Full orchestra productions" },
      { slug: "openmic", label: "Open Mic", blurb: "New material, low stakes" },
    ],
  },
  {
    slug: "sports",
    label: "Sports",
    icon: Trophy,
    tagline: "Leagues, finals and marquee fixtures",
    hue: 62,
    subcategories: [
      { slug: "cricket", label: "Cricket", blurb: "Internationals and league nights" },
      { slug: "football", label: "Football", blurb: "Derby fixtures and cup ties" },
      { slug: "motorsport", label: "Motorsport", blurb: "Race weekends and paddock passes" },
      { slug: "combat", label: "Combat Sports", blurb: "Title fights, ringside tiers" },
      { slug: "esports", label: "Esports", blurb: "Majors and regional finals" },
    ],
  },
  {
    slug: "experiences",
    label: "Experiences & Fests",
    icon: PartyPopper,
    tagline: "Multi-day festivals and one-off nights",
    hue: 45,
    subcategories: [
      { slug: "multiday", label: "Multi-Day Festivals", blurb: "Camping and weekend passes" },
      { slug: "food", label: "Food & Drink", blurb: "Tasting menus and pop-ups" },
      { slug: "art", label: "Art & Immersive", blurb: "Installations and walk-throughs" },
      { slug: "nye", label: "New Year & Seasonal", blurb: "Countdown nights" },
      { slug: "travel", label: "Travel Experiences", blurb: "Curated trips with entry" },
    ],
  },
  {
    slug: "workshops",
    label: "Workshops",
    icon: Wrench,
    tagline: "Small-format, hands-on sessions",
    hue: 55,
    subcategories: [
      { slug: "masterclass", label: "Masterclasses", blurb: "Taught by working artists" },
      { slug: "photography", label: "Photography", blurb: "Field sessions and darkroom" },
      { slug: "music-prod", label: "Music Production", blurb: "Studio and live-set craft" },
      { slug: "wellness", label: "Wellness", blurb: "Movement, breath and sound" },
      { slug: "craft", label: "Craft & Making", blurb: "Ceramics, print, woodwork" },
    ],
  },
];

/** Cities the location selector offers. Mock — no cities table yet. */
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
