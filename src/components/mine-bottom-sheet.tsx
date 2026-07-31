"use client";

import type { ReactNode, RefObject } from "react";
import { useDismissControls } from "./dismissible-dialog-frame";
import {
  HUD_ACCENT,
  HUD_BORDER,
  HUD_RADIUS_MEDIUM,
  HUD_TEXT,
  HUD_TEXT_MUTED,
  HUD_TOUCH_MIN,
} from "./mine-hud-tokens";

/**
 * One anchor for every mode panel.
 *
 * Scrap mode, elevator placement, and the bunker sheet each grew their own
 * coordinates (bottom 82, a centred prompt at 154, and bottom 106), their
 * own border and shadow, and their own confirm/cancel styling. Three
 * bespoke boxes for the same job read as three unrelated features
 * (docs/research/mine-hud-redesign-2026-07.html section 4.11).
 *
 * Everything that puts the mine into a mode now rises from this one edge,
 * with one dismissal contract: tap outside, Escape, gamepad cancel, or TV
 * back, all via `useDismissControls`, which the working agreement requires
 * of any new floating gameplay panel.
 */
export const MINE_SHEET_BOTTOM = "var(--mine-sheet-bottom)";

/**
 * Above the hotbar (z 9) and the toast lane (z 8) so a mode owns the
 * bottom of the screen, and below the bunker sheet's own modal layer (20)
 * and the first-paint veil (30).
 */
const SHEET_Z = 12;

export function MineBottomSheet({
  label,
  open,
  onDismiss,
  children,
  actions,
  sheetRef,
  testId,
  ariaLive,
}: {
  label: string;
  open: boolean;
  onDismiss: () => void;
  children?: ReactNode;
  actions?: ReactNode;
  /** For panels that take focus when they open. */
  sheetRef?: RefObject<HTMLElement | null>;
  testId?: string;
  ariaLive?: "polite" | "assertive";
}) {
  useDismissControls(open, onDismiss);
  if (!open) return null;

  return (
    <section
      ref={sheetRef}
      tabIndex={sheetRef ? -1 : undefined}
      aria-label={label}
      aria-live={ariaLive}
      data-testid={testId}
      data-mine-sheet="true"
      style={{
        position: "absolute",
        left: 10,
        right: 10,
        bottom: MINE_SHEET_BOTTOM,
        zIndex: SHEET_Z,
        maxHeight: "min(46vh, 320px)",
        overflowY: "auto",
        padding: 12,
        borderRadius: HUD_RADIUS_MEDIUM,
        border: `1px solid ${HUD_BORDER}`,
        background: "var(--hud-sheet-surface)",
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.42)",
        color: HUD_TEXT,
        pointerEvents: "auto",
      }}
    >
      {children}
      {actions && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>{actions}</div>
      )}
    </section>
  );
}

/**
 * Sheet-button tones. These have one consumer and no stylesheet reader, so
 * they stay literals here rather than becoming global custom properties:
 * the shared palette is what has to be single-sourced, not every colour.
 */
const SHEET_BUTTON_BORDER = "#2c3a5c";
const CONFIRM_SURFACE = "#172b30";
const CONFIRM_SURFACE_OFF = "rgb(23 43 48 / 0.35)";
const CANCEL_SURFACE = "rgb(38 48 74 / 0.55)";
const CANCEL_TEXT = "#cdd6ea";

/** Confirm and cancel share one shape across every mode sheet. */
export function sheetActionStyle(
  enabled: boolean,
  tone: "confirm" | "cancel",
): React.CSSProperties {
  const confirm = tone === "confirm";
  return {
    flex: confirm ? 1 : "0 0 auto",
    minWidth: confirm ? undefined : 84,
    minHeight: HUD_TOUCH_MIN,
    borderRadius: HUD_RADIUS_MEDIUM,
    border: `1px solid ${confirm && enabled ? HUD_ACCENT : SHEET_BUTTON_BORDER}`,
    background: confirm
      ? enabled
        ? CONFIRM_SURFACE
        : CONFIRM_SURFACE_OFF
      : CANCEL_SURFACE,
    color: confirm ? (enabled ? HUD_ACCENT : HUD_TEXT_MUTED) : CANCEL_TEXT,
    fontWeight: 800,
    cursor: enabled ? "pointer" : "default",
  };
}
