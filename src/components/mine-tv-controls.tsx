"use client";

import type { CSSProperties } from "react";
import type { Direction } from "@/sim/mine";
import { HUD_BOTTOM_INSET, HUD_HOTBAR_ROW_HEIGHT } from "./mine-hud-tokens";

/**
 * TV remote control deck (Fire TV et al). Silk's remote moves a virtual
 * mouse cursor and Select clicks, so drag gestures (the touch thumbstick)
 * are unplayable from the couch. This deck is the remote-native
 * alternative: large stationary buttons where one click is one move and
 * holding Select auto-repeats through the shared direction cadence, so
 * parking the cursor on "dig down" and holding Select keeps digging.
 *
 * Press semantics mirror the keyboard path: pointerdown presses the
 * cadence, pointerup releases it. Keyboard activation (a focused button
 * on an attached USB/Bluetooth keyboard) gets the same hold behavior via
 * keydown/keyup, matching HoldToBuyButton's convention.
 */

const DIRECTION_LABELS: Record<Direction, string> = {
  up: "Move up",
  down: "Move down",
  left: "Move left",
  right: "Move right",
};

const DIRECTION_GLYPHS: Record<Direction, string> = {
  up: "▲",
  down: "▼",
  left: "◀",
  right: "▶",
};

const deckButtonStyle: CSSProperties = {
  width: 62,
  height: 62,
  borderRadius: 14,
  border: "1px solid #2c3a5c",
  background: "rgba(17, 21, 31, 0.82)",
  color: "#cdd6ea",
  fontSize: 22,
  fontWeight: 800,
  cursor: "pointer",
  touchAction: "none",
  userSelect: "none",
  pointerEvents: "auto",
};

export interface TvCenterAction {
  label: string;
  disabled: boolean;
  onAct: () => void;
}

function TvDirectionButton({
  dir,
  onPress,
  onRelease,
  style,
}: {
  dir: Direction;
  onPress: (dir: Direction) => void;
  onRelease: (dir: Direction | null) => void;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      aria-label={DIRECTION_LABELS[dir]}
      data-tv-direction={dir}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        onPress(dir);
      }}
      onPointerUp={() => onRelease(dir)}
      onPointerCancel={() => onRelease(dir)}
      onKeyDown={(e) => {
        if (e.repeat) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPress(dir);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") onRelease(dir);
      }}
      onBlur={() => onRelease(dir)}
      style={{ ...deckButtonStyle, ...style }}
    >
      {DIRECTION_GLYPHS[dir]}
    </button>
  );
}

export function MineTvControls({
  onDirectionPress,
  onDirectionRelease,
  centerAction,
}: {
  onDirectionPress: (dir: Direction) => void;
  onDirectionRelease: (dir: Direction | null) => void;
  centerAction: TvCenterAction | null;
}) {
  return (
    <section
      aria-label="TV remote controls"
      data-tv-controls="true"
      style={{
        position: "absolute",
        left: 24,
        // The deck sits above the hotbar row, not on top of it: the bottom
        // control row moved into this corner with the HUD redesign, and its
        // leftmost slots covered the deck's down arrow so a remote could not
        // dig down at all.
        bottom: `calc(${HUD_BOTTOM_INSET} + ${HUD_HOTBAR_ROW_HEIGHT + 12}px)`,
        zIndex: 9,
        display: "grid",
        gridTemplateColumns: "62px 62px 62px",
        gridTemplateRows: "62px 62px 62px",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      <span />
      <TvDirectionButton
        dir="up"
        onPress={onDirectionPress}
        onRelease={onDirectionRelease}
      />
      <span />
      <TvDirectionButton
        dir="left"
        onPress={onDirectionPress}
        onRelease={onDirectionRelease}
      />
      {centerAction ? (
        <button
          type="button"
          aria-label={centerAction.label}
          data-tv-center-action={centerAction.label}
          disabled={centerAction.disabled}
          onClick={centerAction.onAct}
          style={{
            ...deckButtonStyle,
            fontSize: 13,
            color: "#54e0c7",
            borderColor: "#2c5c52",
            opacity: centerAction.disabled ? 0.42 : 1,
            cursor: centerAction.disabled ? "default" : "pointer",
          }}
        >
          {centerAction.label}
        </button>
      ) : (
        <span />
      )}
      <TvDirectionButton
        dir="right"
        onPress={onDirectionPress}
        onRelease={onDirectionRelease}
      />
      <span />
      <TvDirectionButton
        dir="down"
        onPress={onDirectionPress}
        onRelease={onDirectionRelease}
      />
      <span />
    </section>
  );
}
