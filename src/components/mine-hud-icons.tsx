"use client";

/**
 * One HUD icon set.
 *
 * The HUD was built from emoji, which is why it read as a collection of
 * stickers rather than one system: emoji render with per-platform colour,
 * weight, and metrics, they cannot be tinted for a disabled or danger
 * state, and a couple were semantically weak on their own (a ball of yarn
 * for Recall Rope, a satellite dish for a warp beacon). Worse, the
 * settings button and the hotbar's tools slot were the same gear glyph.
 *
 * These are one stroke weight on one 24x24 grid, drawn in `currentColor`
 * so every state the HUD already expresses through colour (muted, armed,
 * danger, disabled) tints the icon for free, with no second asset.
 *
 * Decorative by contract: every control that uses one carries its own
 * `aria-label`, so the icons are `aria-hidden` and never announced.
 */

export type HudIconName =
  | "battery"
  | "ladder"
  | "bag"
  | "coin"
  | "plank-left"
  | "plank-right"
  | "dynamite"
  | "rope"
  | "tools"
  | "beacon"
  | "scrap"
  | "settings";

/**
 * Path data only. Every icon inherits stroke, width, and linecaps from the
 * wrapper, so a new icon cannot quietly ship a different weight, and none
 * of them may name a colour.
 */
const ICON_PATHS: Record<HudIconName, string> = {
  // Cell body, terminal, one charge bar. More bars turn to mush at 16px.
  battery: "M3 8.5h13v7H3z M18.5 11v2 M5.5 10.5v3",
  ladder: "M8 3v18 M16 3v18 M8 7.5h8 M8 12h8 M8 16.5h8",
  // Body, a flap seam, and two square straps. An arc over the top reads
  // as a padlock shackle at this size, which is what the first pass drew.
  bag: "M5 8h14v12H5z M5 12.5h14 M9 8V5.5h6V8",
  coin: "M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16z M12 8.5v7 M10 10.5h4",
  // A thick board and a large arrow: both parts have to survive 22px.
  "plank-left": "M9 9h11v6H9z M6.5 12H2 M5 9l-3 3 3 3",
  "plank-right": "M4 9h11v6H4z M17.5 12H22 M19 9l3 3-3 3",
  // Upright stick with a band, and a fuse leaving the top.
  dynamite: "M8 10h8v10H8z M8 14h8 M12 10V6.5 M12 6.5c2.5 0 2.5-3 0-3",
  // A hook: "pull me home" reads better than a coil, which looked like a 2.
  rope: "M9 3.5h6 M12 3.5v10 M12 13.5a4 4 0 1 1-4 4",
  // One bold wrench. Distinct from the settings glyph below.
  tools: "M20 5.5a5 5 0 0 1-6.5 6.5L6 19.5 4.5 18l7.5-7.5A5 5 0 0 1 18.5 4z",
  beacon: "M12 12v9 M9 21h6 M8.5 8.5a5 5 0 0 1 7 0 M6 6a8.5 8.5 0 0 1 12 0",
  scrap: "M5 9a7 7 0 0 1 12-3 M19 15a7 7 0 0 1-12 3 M5 5v4h4 M19 19v-4h-4",
  // Sliders, not a gear: at 20px a gear's teeth read as sun rays, and the
  // tools slot already owns "mechanical".
  settings: "M4 7h16 M4 12h16 M4 17h16 M9 5v4 M15 10v4 M8 15v4",
};

export function HudIcon({
  name,
  size = 16,
}: {
  name: HudIconName;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Flows inline next to label text, and still behaves in a flex row.
      style={{
        display: "inline-block",
        verticalAlign: "-0.15em",
        flexShrink: 0,
      }}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export const HUD_ICON_NAMES = Object.keys(ICON_PATHS) as HudIconName[];
