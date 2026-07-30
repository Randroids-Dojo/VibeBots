"use client";

import type { ReactNode, RefObject } from "react";
import { useDismissControls } from "./dismissible-dialog-frame";
import {
  HUD_BORDER,
  HUD_RADIUS_MEDIUM,
  HUD_TEXT,
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
export const MINE_SHEET_BOTTOM = "calc(84px + env(safe-area-inset-bottom))";

/**
 * Above the hotbar (z 9) and the toast lane (z 8) so a mode owns the
 * bottom of the screen, and below the bunker sheet's own modal layer (20)
 * and the first-paint veil (30).
 */
const SHEET_Z = 12;
const BACKDROP_Z = 11;

export function MineBottomSheet({
  label,
  open,
  onDismiss,
  children,
  actions,
  sheetRef,
  testId,
  ariaLive,
  modal = false,
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
  /**
   * Off by default, and deliberately. Scrap mode and elevator placement
   * are world-interaction modes: the player taps supports in the canvas
   * or walks to a column while the sheet is open, so a blocking backdrop
   * would swallow the very input the mode exists for. Those modes are
   * dismissed by Escape, gamepad cancel, TV back, or their own Cancel.
   * Turn this on only for a sheet that really does block the world.
   */
  modal?: boolean;
}) {
  useDismissControls(open, onDismiss);
  if (!open) return null;

  return (
    <>
      {modal && (
        /*
         * Stops short of the bottom inset so the hotbar stays visible
         * underneath (the caller dims it). Covering it would hide the
         * controls the mode is about to be used with.
         */
        <button
          type="button"
          data-sheet-backdrop="true"
          aria-label={`Dismiss ${label.toLowerCase()}`}
          onClick={onDismiss}
          style={{
            position: "absolute",
            inset: "0 0 calc(68px + env(safe-area-inset-bottom)) 0",
            zIndex: BACKDROP_Z,
            border: 0,
            padding: 0,
            background: "rgba(2, 6, 12, 0.18)",
            cursor: "pointer",
          }}
        />
      )}
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
          background: "rgba(14, 20, 28, 0.96)",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.42)",
          color: HUD_TEXT,
          pointerEvents: "auto",
        }}
      >
        {children}
        {actions && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {actions}
          </div>
        )}
      </section>
    </>
  );
}

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
    border: `1px solid ${confirm && enabled ? "#54e0c7" : "#2c3a5c"}`,
    background: confirm
      ? enabled
        ? "#172b30"
        : "rgba(23, 43, 48, 0.35)"
      : "rgba(38, 48, 74, 0.55)",
    color: confirm ? (enabled ? "#54e0c7" : "#8b93a7") : "#cdd6ea",
    fontWeight: 800,
    cursor: enabled ? "pointer" : "default",
  };
}
