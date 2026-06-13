"use client";

import {
  beginJoystick,
  createJoystick,
  endJoystick,
  JOYSTICK_DEADZONE,
  JOYSTICK_RADIUS,
  moveJoystick,
  readJoystick,
} from "@randroids-dojo/vibekit";
import { useRef, useState } from "react";
import type { Direction } from "@/sim/mine";

/** Repeat cadence while the stick is held past the deadzone. Half the
 * old 220ms: a held stick walks at a readable pace, not a sprint. */
const REPEAT_MS = 440;
/** Floor between any two fires, including direction changes. The first
 * fire on a fresh press is still immediate, so taps stay responsive. */
const MIN_FIRE_MS = 200;
/** A new axis must clearly dominate before the direction switches. */
const AXIS_HYSTERESIS = 1.35;

/**
 * Float-where-you-tap thumbstick (VibeKit virtual-joystick): pressing
 * anywhere on the mine view spawns the stick under the finger; the
 * dominant axis past the deadzone fires a move immediately and then
 * repeats while held. Buttons, menus, and panels sit above this
 * overlay in the stacking order, so they keep their normal taps.
 */
export function MineTouchControls({
  onDirection,
}: {
  onDirection: (dir: Direction) => void;
}) {
  const js = useRef(createJoystick());
  const heldDir = useRef<Direction | null>(null);
  const lastFire = useRef(0);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [stick, setStick] = useState<{
    originX: number;
    originY: number;
    nubX: number;
    nubY: number;
  } | null>(null);

  const stopRepeat = () => {
    if (repeatTimer.current) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  };

  const fire = (dir: Direction) => {
    lastFire.current = Date.now();
    onDirection(dir);
  };

  const syncDirection = () => {
    const v = readJoystick(js.current);
    const len = Math.hypot(v.x, v.y);
    const held = heldDir.current;
    let dir: Direction | null = null;
    if (len >= JOYSTICK_DEADZONE) {
      const ax = Math.abs(v.x);
      const ay = Math.abs(v.y);
      // Hysteresis: near the diagonal, a drag would otherwise flip the
      // dominant axis on every pointer event and machine-gun alternating
      // moves. Stay on the held axis until the other clearly wins.
      const lateralHeld = held === "left" || held === "right";
      const verticalHeld = held === "up" || held === "down";
      const lateral = lateralHeld
        ? ay <= ax * AXIS_HYSTERESIS
        : verticalHeld
          ? ax > ay * AXIS_HYSTERESIS
          : ax >= ay;
      dir = lateral ? (v.x > 0 ? "right" : "left") : v.y > 0 ? "down" : "up";
    }
    if (dir !== held) {
      heldDir.current = dir;
      stopRepeat();
      if (dir) {
        // Rate-clamped even across direction changes.
        if (Date.now() - lastFire.current >= MIN_FIRE_MS) fire(dir);
        repeatTimer.current = setInterval(() => {
          if (heldDir.current) fire(heldDir.current);
        }, REPEAT_MS);
      }
    }
  };

  const updateStickUi = () => {
    const s = js.current;
    if (!s.active) {
      setStick(null);
      return;
    }
    const v = readJoystick(s);
    setStick({
      originX: s.originX,
      originY: s.originY,
      nubX: s.originX + v.x * JOYSTICK_RADIUS,
      nubY: s.originY + v.y * JOYSTICK_RADIUS,
    });
  };

  const release = () => {
    endJoystick(js.current);
    heldDir.current = null;
    stopRepeat();
    setStick(null);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only touch surface; keyboard moves live on the document handler and the dig buttons
    <div
      data-touch-surface
      onPointerDown={(e) => {
        if (js.current.active) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        beginJoystick(js.current, e.pointerId, e.clientX, e.clientY);
        updateStickUi();
      }}
      onPointerMove={(e) => {
        if (!js.current.active || e.pointerId !== js.current.pointerId) return;
        moveJoystick(js.current, e.clientX, e.clientY);
        syncDirection();
        updateStickUi();
      }}
      onPointerUp={(e) => {
        if (e.pointerId !== js.current.pointerId) return;
        release();
      }}
      onPointerCancel={release}
      style={{
        position: "absolute",
        inset: 0,
        touchAction: "none",
      }}
    >
      {stick && (
        <div style={{ pointerEvents: "none" }}>
          <div
            data-joystick
            style={{
              position: "fixed",
              left: stick.originX - JOYSTICK_RADIUS,
              top: stick.originY - JOYSTICK_RADIUS,
              width: JOYSTICK_RADIUS * 2,
              height: JOYSTICK_RADIUS * 2,
              borderRadius: "50%",
              border: "2px solid rgba(84, 224, 199, 0.45)",
              background: "rgba(17, 21, 31, 0.25)",
            }}
          />
          <div
            style={{
              position: "fixed",
              left: stick.nubX - 24,
              top: stick.nubY - 24,
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "rgba(84, 224, 199, 0.55)",
              boxShadow: "0 0 14px rgba(84, 224, 199, 0.4)",
            }}
          />
        </div>
      )}
    </div>
  );
}
