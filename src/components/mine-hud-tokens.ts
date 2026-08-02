/**
 * HUD design tokens (mine surface).
 *
 * These are `var()` references into the one palette declared in
 * `src/app/mine.css`, so TypeScript and CSS cannot hold different ideas of
 * what the accent colour is. Inline styles resolve custom properties the
 * same way a stylesheet rule does.
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
export const HUD_SURFACE = "var(--hud-surface)";
export const HUD_SURFACE_SOLID = "var(--hud-surface-solid)";

export const HUD_BORDER = "var(--hud-border)";

export const HUD_TEXT = "var(--hud-text)";
export const HUD_TEXT_MUTED = "var(--hud-text-muted)";

/** The teal used for anything the player can act on or has armed. */
export const HUD_ACCENT = "var(--hud-accent)";
export const HUD_ACCENT_TEXT = "var(--hud-accent-text)";
export const HUD_ACCENT_SURFACE = "var(--hud-accent-surface)";
export const HUD_ACCENT_GLOW = "var(--hud-accent-glow)";

/** Readiness states: the trip home is at risk, or getting close to it. */
export const HUD_DANGER = "var(--hud-danger)";
export const HUD_DANGER_TEXT = "var(--hud-danger-text)";
export const HUD_WARN = "var(--hud-warn)";
export const HUD_WARN_TEXT = "var(--hud-warn-text)";

/** The reserve marker has to read on both the filled and empty track. */
export const HUD_RESERVE_TICK = "var(--hud-reserve-tick)";

/** Vibes and carried-value numerals, and the dropped-cargo marker. */
export const HUD_GOLD = "var(--hud-gold)";

export const HUD_RADIUS_PILL = 999;
export const HUD_RADIUS_LARGE = 14;
export const HUD_RADIUS_MEDIUM = 12;
export const HUD_RADIUS_SMALL = 8;

/**
 * Minimum touch target for controls this redesign owns. The zoom pair is
 * still 42px and is not converted yet; it retires with its own slice.
 */
export const HUD_TOUCH_MIN = 44;

/**
 * Stacking order for the mine surface, in one place.
 *
 * These were scattered magic numbers, and got it wrong twice: a hotbar menu
 * opened underneath the bunker backdrop, and the settings menu sat beneath
 * the toast lane and the hotbar that were added above it. The rule is that
 * anything the player opened on purpose outranks the persistent HUD.
 *
 * The bunker sheet (19/20), the first-paint veil (30), and the loading
 * notices (40) live in mine.css and sit above everything here.
 */
export const HUD_LAYER = {
  /** Depth ribbon: background furniture, never covers a control. */
  ribbon: 6,
  /** Always-on chrome: the settings gear and the zoom pair. */
  chrome: 7,
  /** Transient feedback, above chrome but below anything interactive. */
  toast: 8,
  /** The hotbar and the context action: the persistent controls. */
  controls: 9,
  /** Mode sheets and their backdrop. */
  sheetBackdrop: 11,
  sheet: 12,
  /** Menus the player opened: they outrank every layer above. */
  menu: 14,
} as const;

export const HUD_FONT_SMALL = "0.8rem";
export const HUD_FONT_BODY = "0.95rem";
export const HUD_FONT_LARGE = "1.35rem";
