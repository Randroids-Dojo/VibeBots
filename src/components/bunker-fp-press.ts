/**
 * Pure decision logic for presses on the first-person look zone: a
 * quick still tap acts with the current tool, a long still hold over
 * an unchanged crosshair target fires the quick pry (the touch mirror
 * of desktop right-click), and anything that wandered is a look drag.
 * Kept free of DOM and React so the rules are unit-testable in node;
 * the HUD owns the timers and pointer bookkeeping.
 */

/** Taps on the look zone shorter than this act with the current tool. */
export const FP_TAP_MS = 250;
/** ... unless the pointer wandered further than this (a look drag). */
export const FP_TAP_SLOP_PX = 12;
/** A still press held this long quick-pries the crosshair target,
 * regardless of the selected tool (long-press = right-click). */
export const FP_LONG_PRESS_MS = 450;

export interface FpLookPress {
  active: boolean;
  pointerId: number;
  /** Last seen pointer position (the look-drag integrator). */
  x: number;
  y: number;
  startX: number;
  startY: number;
  startedAt: number;
  /** Peak distance from the press origin, in px. */
  moved: number;
  /** Set once the hold window fired, so release cannot also act. */
  longPressFired: boolean;
  /** Crosshair target snapshot captured at press start. The target
   * store only swaps the snapshot object when a field changes, so
   * reference equality against the live snapshot proves the target
   * never moved during the hold. */
  targetAtStart: unknown;
}

export function createFpLookPress(): FpLookPress {
  return {
    active: false,
    pointerId: -1,
    x: 0,
    y: 0,
    startX: 0,
    startY: 0,
    startedAt: 0,
    moved: 0,
    longPressFired: false,
    targetAtStart: null,
  };
}

export function beginFpLookPress(
  press: FpLookPress,
  pointerId: number,
  x: number,
  y: number,
  now: number,
  target: unknown,
): void {
  press.active = true;
  press.pointerId = pointerId;
  press.x = x;
  press.y = y;
  press.startX = x;
  press.startY = y;
  press.startedAt = now;
  press.moved = 0;
  press.longPressFired = false;
  press.targetAtStart = target;
}

/** True when a still-held press has sat through the hold window with
 * the crosshair target unchanged since press start: fire the quick
 * pry. The caller marks longPressFired so it fires at most once and
 * the release cannot also act. */
export function shouldFireFpLongPress(
  press: FpLookPress,
  now: number,
  targetNow: unknown,
): boolean {
  return (
    press.active &&
    !press.longPressFired &&
    now - press.startedAt >= FP_LONG_PRESS_MS &&
    press.moved < FP_TAP_SLOP_PX &&
    targetNow === press.targetAtStart
  );
}

/** True when a released press was a quick, still tap that no long
 * press already consumed: fire the normal act with the current tool. */
export function shouldFireFpTapAct(press: FpLookPress, now: number): boolean {
  return (
    press.active &&
    !press.longPressFired &&
    now - press.startedAt < FP_TAP_MS &&
    press.moved < FP_TAP_SLOP_PX
  );
}
