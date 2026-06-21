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
  onZoomChange,
  onReleaseDirection,
}: {
  onDirection: (dir: Direction) => void;
  onZoomChange: (delta: number) => void;
  onReleaseDirection?: (dir: Direction | null) => void;
}) {
  const js = useRef(createJoystick());
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistance = useRef<number | null>(null);
  const pinching = useRef(false);
  const heldDir = useRef<Direction | null>(null);
  const [stick, setStick] = useState<{
    originX: number;
    originY: number;
    nubX: number;
    nubY: number;
  } | null>(null);

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
      if (dir) {
        onDirection(dir);
      } else {
        onReleaseDirection?.(held);
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
    const releasedDir = heldDir.current;
    endJoystick(js.current);
    heldDir.current = null;
    setStick(null);
    onReleaseDirection?.(releasedDir);
  };

  const distanceBetweenPointers = (): number | null => {
    const values = Array.from(pointers.current.values());
    if (values.length < 2) return null;
    const [a, b] = values;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const endPinch = () => {
    pinching.current = false;
    pinchDistance.current = null;
  };

  const trackPointer = (id: number, x: number, y: number) => {
    pointers.current.set(id, { x, y });
  };

  const forgetPointer = (id: number) => {
    pointers.current.delete(id);
    if (pointers.current.size < 2) endPinch();
  };

  return (
    <div
      data-touch-surface
      onWheel={(e) => {
        e.preventDefault();
        onZoomChange(e.deltaY > 0 ? 0.12 : -0.12);
      }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        trackPointer(e.pointerId, e.clientX, e.clientY);
        if (pointers.current.size >= 2) {
          release();
          pinching.current = true;
          pinchDistance.current = distanceBetweenPointers();
          return;
        }
        if (js.current.active) return;
        beginJoystick(js.current, e.pointerId, e.clientX, e.clientY);
        updateStickUi();
      }}
      onPointerMove={(e) => {
        if (pointers.current.has(e.pointerId)) {
          trackPointer(e.pointerId, e.clientX, e.clientY);
        }
        if (pinching.current) {
          const nextDistance = distanceBetweenPointers();
          const prevDistance = pinchDistance.current;
          if (nextDistance !== null && prevDistance !== null) {
            onZoomChange((prevDistance - nextDistance) / 140);
          }
          pinchDistance.current = nextDistance;
          return;
        }
        if (!js.current.active || e.pointerId !== js.current.pointerId) return;
        moveJoystick(js.current, e.clientX, e.clientY);
        syncDirection();
        updateStickUi();
      }}
      onPointerUp={(e) => {
        forgetPointer(e.pointerId);
        if (e.pointerId !== js.current.pointerId) return;
        release();
      }}
      onPointerCancel={(e) => {
        forgetPointer(e.pointerId);
        release();
      }}
      style={{
        position: "absolute",
        inset: 0,
        touchAction: "none",
        zIndex: 4,
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
