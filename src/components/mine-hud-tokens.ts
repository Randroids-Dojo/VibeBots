/**
 * HUD design tokens (mine surface).
 *
 * The mine HUD grew six independent style objects in `mine-panel.tsx`,
 * each repeating the same literal hex strings. That is one reason the
 * HUD reads as several unrelated toolbars instead of one system (see
 * docs/research/mine-hud-redesign-2026-07.html). Every HUD colour,
 * radius, and type size the shared style constants use lives here, and
 * `mine-hud-tokens.test.ts` fails if one of those constants goes back
 * to a raw literal.
 */

/** Panel and control fills. */
export const HUD_SURFACE = "rgba(17, 21, 31, 0.82)";
export const HUD_SURFACE_SOLID = "rgba(17, 21, 31, 0.88)";

export const HUD_BORDER = "#26304a";

export const HUD_TEXT = "#e6e8ee";

/** The teal used for anything the player can act on or has armed. */
export const HUD_ACCENT = "#54e0c7";
export const HUD_ACCENT_TEXT = "#eafff9";
export const HUD_ACCENT_SURFACE = "rgba(15, 31, 37, 0.94)";
export const HUD_ACCENT_GLOW = "0 0 18px rgba(84, 224, 199, 0.2)";

export const HUD_RADIUS_PILL = 999;
export const HUD_RADIUS_LARGE = 14;
export const HUD_RADIUS_MEDIUM = 12;
export const HUD_RADIUS_SMALL = 8;

export const HUD_FONT_SMALL = "0.8rem";
export const HUD_FONT_BODY = "0.95rem";
export const HUD_FONT_LARGE = "1.35rem";
