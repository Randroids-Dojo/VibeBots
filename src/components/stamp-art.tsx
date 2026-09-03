import { type ReactElement, useId } from "react";
import {
  ACHIEVEMENT_BY_ID,
  type AchievementCategory,
} from "@/lib/achievements";

/**
 * Hand-drawn postage-stamp art for the Stamp Book (REQ-032). Every
 * achievement gets a unique pictogram on a shared perforated frame so
 * the collect alert and the book read as one set. Pure SVG: no runtime
 * 3D text, no textures, safe on every backend (Rule 10).
 */

interface StampPalette {
  paper: string;
  ink: string;
  accent: string;
}

const CATEGORY_PALETTES: Record<AchievementCategory, StampPalette> = {
  depth: { paper: "#0d2029", ink: "#54e0c7", accent: "#8fe9f2" },
  haul: { paper: "#241c0d", ink: "#f5c542", accent: "#ffe59a" },
  tools: { paper: "#141b2c", ink: "#9db8e8", accent: "#dce5f7" },
  survival: { paper: "#122417", ink: "#7ee08a", accent: "#c8f5cd" },
  battle: { paper: "#2a1313", ink: "#ff8a7a", accent: "#ffc2b8" },
};

const FALLBACK_PALETTE: StampPalette = {
  paper: "#161b28",
  ink: "#aab2c7",
  accent: "#e6e8ee",
};

/**
 * One pictogram per achievement id, drawn on a 64x64 grid (art area
 * roughly x 12-52, y 12-52). Strokes inherit the category ink from the
 * wrapping group; accents are passed in for highlights.
 */
const STAMP_PICTOGRAMS: Record<
  string,
  (palette: StampPalette) => ReactElement
> = {
  "depth-first-chip": ({ accent }) => (
    <g>
      <rect x="19" y="30" width="18" height="14" rx="1.5" />
      <path d="M28 30 l3 5 l-3 4" strokeWidth="2" />
      <path d="M41 17 L29 31" />
      <path d="M34 13 Q45 15 48 26" />
      <path d="M40 27 l4 -3 M42 32 l5 -1" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "depth-clay-boots": ({ accent }) => (
    <g>
      <path d="M25 16 h11 v14 q8 0 11 8 l1 4 q0 2 -2 2 H25 q-2 0 -2 -2 V18 q0 -2 2 -2 z" />
      <path d="M23 38 h13" strokeWidth="2" />
      <path d="M27 21 h7 M27 26 h7" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "depth-granite-nerves": ({ accent }) => (
    <g>
      <rect x="16" y="19" width="32" height="9" />
      <rect x="16" y="28" width="32" height="9" />
      <rect x="16" y="37" width="32" height="9" />
      <path d="M32 19 v9 M25 28 v9 M40 28 v9 M33 37 v9" strokeWidth="2" />
      <path d="M38 16 l-4 8 l5 8 l-6 8 l4 9" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "depth-glow-guide": ({ accent }) => (
    <g>
      <path d="M20 33 q0 -15 12 -15 q12 0 12 15 z" />
      <path d="M29 33 v9 q0 3 3 3 q3 0 3 -3 v-9" />
      <path
        d="M32 12 v4 M18 20 l3 3 M46 20 l-3 3"
        stroke={accent}
        strokeWidth="2"
      />
      <circle cx="26" cy="28" r="1.4" fill={accent} stroke="none" />
      <circle cx="36" cy="25" r="1.4" fill={accent} stroke="none" />
    </g>
  ),
  "depth-magma-hello": ({ accent }) => (
    <g>
      <path d="M14 43 q4.5 -5 9 0 t9 0 t9 0 t9 0" />
      <path d="M14 49 h36" strokeWidth="2" opacity="0.6" />
      <circle cx="24" cy="33" r="2.5" stroke={accent} />
      <circle cx="34" cy="26" r="3.5" stroke={accent} />
      <circle cx="43" cy="34" r="2" stroke={accent} />
      <path d="M34 17 v4" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "depth-ashfall-claim": ({ accent }) => (
    <g>
      <path d="M16 47 q16 -12 32 0" />
      <path d="M32 21 v18" />
      <path d="M32 21 l10 4 l-10 4 z" fill="currentColor" stroke="none" />
      <g fill={accent} stroke="none">
        <circle cx="20" cy="18" r="1.5" />
        <circle cx="26" cy="26" r="1.5" />
        <circle cx="44" cy="19" r="1.5" />
        <circle cx="41" cy="29" r="1.5" />
        <circle cx="17" cy="30" r="1.5" />
      </g>
    </g>
  ),
  "depth-black-seam": ({ accent, paper }) => (
    <g>
      <path
        d="M12 38 L38 12 L52 26 L26 52 z"
        fill="rgba(0, 0, 0, 0.45)"
        strokeWidth="2"
      />
      <path d="M31 25 l7 7 l-7 7 l-7 -7 z" fill={accent} stroke="none" />
      <path d="M31 25 v14 M24 32 h14" stroke={paper} strokeWidth="1.5" />
    </g>
  ),
  "depth-echo-vault": ({ accent }) => (
    <g>
      <path d="M17 47 v-13 q0 -15 15 -15 q15 0 15 15 v13" />
      <path d="M24 47 v-9 q0 -9 8 -9 q8 0 8 9 v9" strokeWidth="2" />
      <path
        d="M26 14 q6 -4 12 0 M28 9 q4 -2.5 8 0"
        stroke={accent}
        strokeWidth="2"
      />
    </g>
  ),
  "depth-core-approach": ({ accent }) => (
    <g>
      <circle cx="32" cy="35" r="15" />
      <circle cx="32" cy="35" r="9" strokeDasharray="4 3" strokeWidth="2" />
      <circle cx="32" cy="35" r="3.5" fill={accent} stroke="none" />
      <path d="M32 9 v7 M29 13 l3 3 l3 -3" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "depth-biome-scout": ({ accent }) => (
    <g>
      <ellipse cx="31" cy="29" rx="9" ry="13" />
      <path d="M31 20 q5 6 0 9 q-4 5 0 9" stroke={accent} strokeWidth="2" />
      <g fill="currentColor" stroke="none">
        <ellipse cx="25" cy="48" rx="2" ry="2.8" />
        <ellipse cx="32" cy="50" rx="2" ry="2.8" />
        <ellipse cx="39" cy="48" rx="2" ry="2.8" />
      </g>
    </g>
  ),
  "depth-portal-network": ({ accent }) => (
    <g>
      <ellipse cx="22" cy="26" rx="6.5" ry="10" />
      <ellipse cx="42" cy="38" rx="6.5" ry="10" />
      <path
        d="M27 32 q6 5 10 0"
        stroke={accent}
        strokeWidth="2"
        strokeDasharray="3 3"
      />
      <circle cx="22" cy="26" r="2" fill={accent} stroke="none" />
      <circle cx="42" cy="38" r="2" fill={accent} stroke="none" />
    </g>
  ),
  "haul-first-sale": ({ accent }) => (
    <g>
      <circle cx="26" cy="31" r="10" />
      <circle cx="26" cy="31" r="6" strokeWidth="2" strokeDasharray="3 2.5" />
      <path d="M37 36 l10 4 l-2 9 l-10 -4 z" strokeWidth="2" />
      <circle cx="43" cy="41" r="1.4" fill="currentColor" stroke="none" />
      <path d="M44 16 v6 M41 19 h6" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "haul-clean-pocket": ({ accent }) => (
    <g>
      <path d="M32 25 q-11 2 -11 12 q0 10 11 10 q11 0 11 -10 q0 -10 -11 -12 z" />
      <path d="M26 20 q6 3 12 0" />
      <path d="M27 25 l-2 -5 M37 25 l2 -5" strokeWidth="2" />
      <path d="M28 35 q4 4 8 0" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "haul-heavy-hold": ({ accent }) => (
    <g>
      <rect x="18" y="22" width="28" height="22" rx="1.5" />
      <path d="M27 22 v22 M37 22 v22" strokeWidth="2" />
      <path d="M18 30 h28" strokeWidth="2" />
      <g fill={accent} stroke="none">
        <circle cx="21.5" cy="25.5" r="1.3" />
        <circle cx="42.5" cy="25.5" r="1.3" />
        <circle cx="21.5" cy="40.5" r="1.3" />
        <circle cx="42.5" cy="40.5" r="1.3" />
      </g>
    </g>
  ),
  "haul-big-haul": ({ accent }) => (
    <g>
      <path d="M16 30 h32 l-5 13 H21 z" />
      <circle cx="24" cy="47" r="3.2" />
      <circle cx="40" cy="47" r="3.2" />
      <circle cx="22" cy="26" r="3" stroke={accent} />
      <circle cx="31" cy="23" r="4" stroke={accent} />
      <circle cx="40" cy="26" r="3" stroke={accent} />
    </g>
  ),
  "haul-cache-cracked": ({ accent }) => (
    <g>
      <rect x="20" y="25" width="24" height="18" rx="3" />
      <path d="M32 25 l-3 5 l4 5 l-3 5" strokeWidth="2" />
      <circle cx="37" cy="19" r="4" stroke={accent} strokeWidth="2" />
      <path
        d="M37 13.5 v2 M37 22.5 v2 M31.5 19 h2 M40.5 19 h2"
        stroke={accent}
        strokeWidth="2"
      />
    </g>
  ),
  "haul-parts-prospector": ({ accent }) => (
    <g>
      <circle cx="25" cy="26" r="6" />
      <path
        d="M25 18.5 v-3 M25 33.5 v3 M17.5 26 h-3 M32.5 26 h3"
        strokeWidth="2"
      />
      <circle cx="40" cy="23" r="4" stroke={accent} strokeWidth="2" />
      <path
        d="M40 17.5 v-2.5 M40 28.5 v2.5 M34.5 23 h-2.5 M45.5 23 h2.5"
        stroke={accent}
        strokeWidth="2"
      />
      <circle cx="33" cy="40" r="5" />
      <path
        d="M33 33.5 v-3 M33 46.5 v3 M26.5 40 h-3 M39.5 40 h3"
        strokeWidth="2"
      />
    </g>
  ),
  "haul-bag-sorter": ({ accent }) => (
    <g>
      <path d="M23 24 h14 l3 18 q0 4 -4 4 H24 q-4 0 -4 -4 z" />
      <path d="M26 24 q0 -5 4 -5 q4 0 4 5" strokeWidth="2" />
      <path d="M46 26 v13 M42.5 35 l3.5 4 l3.5 -4" stroke={accent} />
      <circle cx="30" cy="36" r="2.5" strokeWidth="2" />
    </g>
  ),
  "haul-pack-light": ({ accent }) => (
    <g>
      <path d="M20 48 Q33 36 44 16" />
      <path
        d="M42 22 q-6 3 -11 1 q5 -6 11 -9 q0 5 0 8 z"
        fill="currentColor"
        opacity="0.25"
        strokeWidth="2"
      />
      <path d="M36 32 q-6 1 -9 -2 M31 38 q-6 1 -9 -2" strokeWidth="2" />
      <path d="M20 48 l-4 2" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "tool-depot-regular": ({ accent }) => (
    <g>
      <path d="M16 21 h32 v7" />
      <path d="M16 21 v7 q4 5 8 0 q4 5 8 0 q4 5 8 0 q4 5 8 0" fill="none" />
      <path d="M19 32 v14 M45 32 v14" />
      <rect x="25" y="36" width="14" height="10" strokeWidth="2" />
      <path d="M28 41 h8" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "tool-better-pick": ({ accent }) => (
    <g>
      <path d="M18 25 Q32 13 46 25" />
      <path d="M32 19 V47" />
      <path
        d="M46 13 l1.6 3.4 l3.4 1.6 l-3.4 1.6 l-1.6 3.4 l-1.6 -3.4 l-3.4 -1.6 l3.4 -1.6 z"
        fill={accent}
        stroke="none"
      />
    </g>
  ),
  "tool-battery-upgrade": ({ accent }) => (
    <g>
      <rect x="23" y="19" width="18" height="28" rx="3" />
      <rect x="29" y="14" width="6" height="5" rx="1" strokeWidth="2" />
      <path
        d="M34 23 l-7 11 h5 l-3 10 l9 -13 h-5 l4 -8 z"
        fill={accent}
        stroke="none"
      />
    </g>
  ),
  "tool-roomy-hold": ({ accent }) => (
    <g>
      <rect x="23" y="23" width="18" height="18" rx="1.5" />
      <path
        d="M45 32 h7 M49 28.5 l3 3.5 l-3 3.5"
        stroke={accent}
        strokeWidth="2"
      />
      <path
        d="M19 32 h-7 M15 28.5 l-3 3.5 l3 3.5"
        stroke={accent}
        strokeWidth="2"
      />
      <path
        d="M32 19 v-7 M28.5 15 l3.5 -3 l3.5 3"
        stroke={accent}
        strokeWidth="2"
      />
      <path
        d="M32 45 v7 M28.5 49 l3.5 3 l3.5 -3"
        stroke={accent}
        strokeWidth="2"
      />
    </g>
  ),
  "tool-long-beam": ({ accent }) => (
    <g>
      <rect x="17" y="26" width="12" height="15" rx="2" />
      <path d="M20 26 q3 -7 6 0" strokeWidth="2" />
      <path
        d="M29 29 L52 21 L52 46 L29 38 z"
        fill="currentColor"
        opacity="0.16"
        stroke="none"
      />
      <path d="M29 29 L52 21 M29 38 L52 46" strokeWidth="2" />
      <circle cx="23" cy="33.5" r="2.4" fill={accent} stroke="none" />
    </g>
  ),
  "tool-blast-ring": ({ accent }) => (
    <g>
      <rect x="26" y="26" width="11" height="18" rx="2.5" />
      <path d="M31.5 26 q0 -6 5 -8" strokeWidth="2" />
      <g stroke={accent} strokeWidth="2">
        <path d="M37 12 v4 M43.5 14 l-2.6 3 M46 21 l-4 0.5 M30 13.5 l2.6 3" />
      </g>
      <circle cx="37" cy="17.5" r="1.6" fill={accent} stroke="none" />
    </g>
  ),
  "tool-warp-ready": ({ accent }) => (
    <g>
      <path d="M32 33 q3 -4 8 -1 q5 4 0 9 q-7 5 -13 -1 q-6 -8 3 -14 q11 -6 17 3" />
      <path d="M44 26 l3 3 l-4 2" stroke={accent} strokeWidth="2" />
      <circle cx="31" cy="33" r="2" fill={accent} stroke="none" />
    </g>
  ),
  "tool-winch-builder": ({ accent }) => (
    <g>
      <circle cx="32" cy="23" r="7" />
      <circle cx="32" cy="23" r="1.6" fill="currentColor" stroke="none" />
      <path d="M20 46 L29 29 M44 46 L35 29 M18 46 h28" strokeWidth="2" />
      <path d="M32 30 v10" />
      <path d="M32 40 q0 5 4 4 q3 -1 1 -4" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "tool-fast-car": ({ accent }) => (
    <g>
      <path d="M46 12 v40" strokeWidth="2" strokeDasharray="4 3" />
      <rect x="24" y="21" width="16" height="18" rx="2" />
      <path d="M32 21 v18" strokeWidth="2" />
      <path d="M32 12 v5 M40 14 v4" strokeWidth="2" />
      <g stroke={accent} strokeWidth="2">
        <path d="M12 25 h8 M10 31 h8 M12 37 h8" />
      </g>
    </g>
  ),
  "survival-ladder-home": ({ accent }) => (
    <g>
      <path d="M25 13 V51 M39 13 V51" />
      <path
        d="M25 19 h14 M25 26 h14 M25 33 h14 M25 40 h14 M25 47 h14"
        strokeWidth="2"
      />
      <path d="M46 18 l4 4 l-4 4" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "survival-bridge-builder": ({ accent }) => (
    <g>
      <path d="M12 36 h9 v10 M43 46 v-10 h9" />
      <path d="M20 34 h24" strokeWidth="4" />
      <path d="M23 31 v6 M32 31 v6 M41 31 v6" strokeWidth="2" />
      <path d="M25 38 l14 9 M39 38 l-14 9" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "survival-rope-save": ({ accent }) => (
    <g>
      <circle cx="29" cy="28" r="10" />
      <circle cx="29" cy="28" r="5" strokeWidth="2" />
      <path d="M37 34 q7 4 5 11 q-1.5 5 -7 5" />
      <path d="M35 50 q-3 -1 -3 -4" stroke={accent} strokeWidth="2" />
      <path d="M22 15 l4 4" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "survival-close-call": ({ accent }) => (
    <g>
      <path d="M20 37 q0 -17 12 -17 q12 0 12 17 z" />
      <path d="M15 37 h34" />
      <circle cx="32" cy="28" r="3" fill={accent} stroke="none" />
      <path d="M41 20 l-4 6 l5 5" stroke={accent} strokeWidth="2" />
      <path d="M26 44 l2 4 M38 44 l-2 4" strokeWidth="2" />
    </g>
  ),
  "survival-beacon-planted": ({ accent }) => (
    <g>
      <path d="M25 47 L32 21 L39 47" />
      <path d="M27 39 h10" strokeWidth="2" />
      <path d="M22 47 h20" strokeWidth="2" />
      <circle cx="32" cy="16" r="3.5" fill={accent} stroke="none" />
      <path
        d="M32 8 v3 M24 10 l2 2.5 M40 10 l-2 2.5 M21 18 l3 0.5 M43 18 l-3 0.5"
        stroke={accent}
        strokeWidth="2"
      />
    </g>
  ),
  "survival-ride-rail": ({ accent }) => (
    <g>
      <path d="M45 12 v40" strokeWidth="2" strokeDasharray="4 3" />
      <path d="M27 13 v9" strokeWidth="2" />
      <rect x="18" y="22" width="18" height="17" rx="2" />
      <circle cx="27" cy="28" r="2.4" strokeWidth="2" />
      <path d="M27 31 v5" strokeWidth="2" />
      <path d="M45 24 l-3.5 4 M45 24 l3.5 4" stroke={accent} strokeWidth="2" />
      <path d="M45 18 v6" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "survival-first-defense": ({ accent }) => (
    <g>
      <path d="M32 13 l15 5 v13 q0 13 -15 18 q-15 -5 -15 -18 v-13 z" />
      <path d="M32 22 v14 M26 28 l6 -6 l6 6" stroke={accent} strokeWidth="2" />
    </g>
  ),
  "battle-chassis-tour": ({ accent }) => (
    <g>
      {/* The three cores side by side: cube, wedge, tower. */}
      <rect x="14" y="30" width="11" height="11" rx="1.5" />
      <path d="M28 41 h11 l-11 -11 z" />
      <rect x="43" y="24" width="8" height="17" rx="1.5" />
      <path d="M12 46 h40" strokeWidth="2" />
      <circle cx="19.5" cy="22" r="2" fill={accent} stroke="none" />
      <circle cx="33" cy="22" r="2" fill={accent} stroke="none" />
      <circle cx="47" cy="16" r="2" fill={accent} stroke="none" />
    </g>
  ),
  "tools-mastercrafted": ({ accent }) => (
    <g>
      {/* A part gem over its three merge pips, the last one lit. */}
      <path d="M32 16 l10 8 v10 l-10 8 l-10 -8 v-10 z" />
      <path d="M32 24 l5 4 v6 l-5 4 l-5 -4 v-6 z" fill={accent} stroke="none" />
      <g stroke="none">
        <circle cx="24" cy="48" r="2.4" fill="currentColor" opacity="0.45" />
        <circle cx="32" cy="48" r="2.4" fill="currentColor" opacity="0.45" />
        <circle cx="40" cy="48" r="2.4" fill={accent} />
      </g>
    </g>
  ),
  "tools-custom-job": ({ accent }) => (
    <g>
      {/* A paint roller over a fresh stripe. */}
      <rect x="18" y="16" width="20" height="10" rx="3" />
      <path d="M38 21 h6 v8 h-8 v6" />
      <rect x="33" y="35" width="6" height="12" rx="2" />
      <path d="M14 50 h36" stroke={accent} strokeWidth="4" />
    </g>
  ),
  "survival-roof-rescue": ({ accent }) => (
    <g>
      {/* Condemned ceiling line held up by a plank prop. */}
      <path d="M16 22 h32" strokeWidth="2.5" />
      <path d="M20 22 l3 5 M32 22 l0 5 M44 22 l-3 5" strokeWidth="1.5" />
      <rect
        x="29"
        y="26"
        width="6"
        height="20"
        rx="1"
        fill={accent}
        stroke="none"
      />
      <path d="M23 46 h18" strokeWidth="2.5" />
    </g>
  ),
  "survival-walked-away": ({ accent }) => (
    <g>
      {/* Rubble pile behind a miner striding clear. */}
      <path d="M14 44 l6 -8 l5 4 l4 -7 l5 6 l3 -4 v9 z" />
      <path d="M18 30 l3 3 M27 25 l2 3 M36 28 l2 2" strokeWidth="1.5" />
      <circle cx="46" cy="30" r="3.5" fill={accent} stroke="none" />
      <path
        d="M46 34 v6 M46 36 l-4 4 M46 36 l4 3 M46 40 l-3 6 M46 40 l4 5"
        stroke={accent}
        strokeWidth="2"
      />
    </g>
  ),
  "survival-buttoned-up": ({ accent }) => (
    <g>
      <rect x="18" y="18" width="28" height="28" rx="2" />
      <path
        d="M32 14 v8 M32 42 v8 M14 32 h8 M42 32 h8"
        stroke={accent}
        strokeWidth="2"
      />
      <path d="M32 27 l5 5 l-5 5 l-5 -5 z" fill={accent} stroke="none" />
      <g fill="currentColor" stroke="none">
        <circle cx="22" cy="22" r="1.8" />
        <circle cx="42" cy="22" r="1.8" />
        <circle cx="22" cy="42" r="1.8" />
        <circle cx="42" cy="42" r="1.8" />
      </g>
    </g>
  ),
  "tools-fresh-coat": ({ accent }) => (
    <g>
      {/* A paintbrush laying a fresh stripe over wall panels. */}
      <rect x="14" y="34" width="12" height="12" rx="1.5" />
      <rect x="28" y="34" width="12" height="12" rx="1.5" />
      <rect x="42" y="34" width="8" height="12" rx="1.5" />
      <path d="M14 40 h36" strokeWidth="1.5" opacity="0.6" />
      <path d="M40 14 l6 6 l-14 14 l-6 -6 z" />
      <path
        d="M26 34 l-7 7 q-4 1 -5 -1 q-1 -2 2 -4 z"
        fill={accent}
        stroke="none"
      />
      <path
        d="M18 46 q8 3 14 0"
        stroke={accent}
        strokeWidth="2.5"
        fill="none"
      />
    </g>
  ),
  "bunker-groundbreaker": ({ accent }) => (
    <g>
      {/* A pick breaking the first cell out of coursed claim rock. */}
      <path d="M14 32 h12 M44 32 h6 M14 44 h36" strokeWidth="2" />
      <path
        d="M20 32 v12 M32 44 v-2 M44 32 v12"
        strokeWidth="1.5"
        opacity="0.7"
      />
      <rect
        x="26"
        y="30"
        width="18"
        height="14"
        rx="1"
        fill={accent}
        opacity="0.22"
        stroke="none"
      />
      <path d="M26 30 h18 v14 h-18 z" stroke={accent} strokeWidth="2" />
      <path d="M18 14 q14 -8 28 2" />
      <path d="M31 12 l6 24" stroke={accent} strokeWidth="2.5" />
      <path d="M22 26 l-4 -3 M46 26 l4 -4" strokeWidth="1.5" />
    </g>
  ),
  "battle-first-blood": ({ accent }) => (
    <g>
      <path d="M32 12 l3 5 v19 h-6 v-19 z" />
      <path d="M24 36 h16" />
      <path d="M32 36 v8" strokeWidth="2" />
      <circle cx="32" cy="47" r="2.2" strokeWidth="2" />
      <path d="M43 20 q4 5 0 8 q-4 -3 0 -8 z" fill={accent} stroke="none" />
    </g>
  ),
  "battle-veteran": ({ accent }) => (
    <g>
      <path d="M23 47 q-9 -11 -4 -24" />
      <path d="M41 47 q9 -11 4 -24" />
      <path
        d="M20 26 q-3 -2 -3 -5 q3 0 5 3 M18 33 q-3 -1 -4 -4 q3 -0.5 5 2 M22 40 q-3 0 -5 -3 q2.5 -1.5 5 1"
        strokeWidth="2"
      />
      <path
        d="M44 26 q3 -2 3 -5 q-3 0 -5 3 M46 33 q3 -1 4 -4 q-3 -0.5 -5 2 M42 40 q3 0 5 -3 q-2.5 -1.5 -5 1"
        strokeWidth="2"
      />
      <path
        d="M32 20 l2.4 5 l5.6 0.7 l-4.1 3.9 l1 5.4 l-4.9 -2.6 l-4.9 2.6 l1 -5.4 l-4.1 -3.9 l5.6 -0.7 z"
        fill={accent}
        stroke="none"
      />
    </g>
  ),
  "battle-buzzkill": ({ accent }) => (
    <g>
      <circle cx="32" cy="32" r="12" />
      <circle
        cx="32"
        cy="32"
        r="15.5"
        strokeWidth="4"
        strokeDasharray="4.5 7.5"
      />
      <circle cx="32" cy="32" r="3" fill={accent} stroke="none" />
      <path d="M32 24 v4 M32 36 v4 M24 32 h4 M36 32 h4" strokeWidth="2" />
    </g>
  ),
};

const FALLBACK_PICTOGRAM = ({ accent }: StampPalette): ReactElement => (
  <g>
    <circle cx="32" cy="32" r="13" />
    <circle cx="32" cy="32" r="3" fill={accent} stroke="none" />
  </g>
);

export function hasStampArt(achievementId: string): boolean {
  // Own-key check: `in` would accept inherited keys like "__proto__".
  return Object.hasOwn(STAMP_PICTOGRAMS, achievementId);
}

/** Perforation hole centers along one 64-unit stamp edge. */
const PERFORATION_STOPS = [4, 12, 20, 28, 36, 44, 52, 60];

export function StampArt({
  achievementId,
  size = 52,
}: {
  achievementId: string;
  size?: number;
}) {
  const maskId = useId();
  const category = ACHIEVEMENT_BY_ID.get(achievementId)?.category;
  const palette = category ? CATEGORY_PALETTES[category] : FALLBACK_PALETTE;
  const pictogram = hasStampArt(achievementId)
    ? STAMP_PICTOGRAMS[achievementId]
    : FALLBACK_PICTOGRAM;
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
    >
      <title>{achievementId}</title>
      <mask id={maskId}>
        <rect x="0" y="0" width="64" height="64" rx="4" fill="#fff" />
        {PERFORATION_STOPS.map((stop) => (
          <g key={stop} fill="#000">
            <circle cx={stop} cy="0" r="2.6" />
            <circle cx={stop} cy="64" r="2.6" />
            <circle cx="0" cy={stop} r="2.6" />
            <circle cx="64" cy={stop} r="2.6" />
          </g>
        ))}
      </mask>
      <g mask={`url(#${maskId})`}>
        <rect x="0" y="0" width="64" height="64" fill={palette.paper} />
        <rect
          x="6.5"
          y="6.5"
          width="51"
          height="51"
          rx="2"
          fill="none"
          stroke={palette.ink}
          strokeWidth="1.5"
          opacity="0.5"
        />
        <g
          stroke={palette.ink}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          color={palette.ink}
        >
          {pictogram(palette)}
        </g>
      </g>
    </svg>
  );
}
