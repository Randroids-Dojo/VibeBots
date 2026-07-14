import { describe, expect, it } from "vitest";
import {
  beginFpLookPress,
  createFpLookPress,
  FP_LONG_PRESS_MS,
  FP_TAP_MS,
  FP_TAP_SLOP_PX,
  shouldFireFpLongPress,
  shouldFireFpTapAct,
} from "./bunker-fp-press";

const TARGET_A = { kind: "part" };
const TARGET_B = { kind: "rock-diggable" };

function heldPress(target: unknown = TARGET_A) {
  const press = createFpLookPress();
  beginFpLookPress(press, 7, 100, 200, 1_000, target);
  return press;
}

describe("shouldFireFpLongPress", () => {
  it("fires after the hold window when still and the target is unchanged", () => {
    const press = heldPress();
    expect(
      shouldFireFpLongPress(press, 1_000 + FP_LONG_PRESS_MS, TARGET_A),
    ).toBe(true);
  });

  it("does not fire before the hold window", () => {
    const press = heldPress();
    expect(
      shouldFireFpLongPress(press, 1_000 + FP_LONG_PRESS_MS - 1, TARGET_A),
    ).toBe(false);
  });

  it("does not fire when the crosshair target changed during the hold", () => {
    const press = heldPress(TARGET_A);
    expect(
      shouldFireFpLongPress(press, 1_000 + FP_LONG_PRESS_MS, TARGET_B),
    ).toBe(false);
  });

  it("does not fire when the pointer wandered past the tap slop", () => {
    const press = heldPress();
    press.moved = FP_TAP_SLOP_PX;
    expect(
      shouldFireFpLongPress(press, 1_000 + FP_LONG_PRESS_MS, TARGET_A),
    ).toBe(false);
  });

  it("fires at most once per press", () => {
    const press = heldPress();
    expect(
      shouldFireFpLongPress(press, 1_000 + FP_LONG_PRESS_MS, TARGET_A),
    ).toBe(true);
    press.longPressFired = true;
    expect(
      shouldFireFpLongPress(press, 1_000 + FP_LONG_PRESS_MS * 2, TARGET_A),
    ).toBe(false);
  });

  it("does not fire once the press is released", () => {
    const press = heldPress();
    press.active = false;
    expect(
      shouldFireFpLongPress(press, 1_000 + FP_LONG_PRESS_MS, TARGET_A),
    ).toBe(false);
  });
});

describe("shouldFireFpTapAct", () => {
  it("acts on a quick still tap", () => {
    const press = heldPress();
    expect(shouldFireFpTapAct(press, 1_000 + FP_TAP_MS - 1)).toBe(true);
  });

  it("does not act after the tap window", () => {
    const press = heldPress();
    expect(shouldFireFpTapAct(press, 1_000 + FP_TAP_MS)).toBe(false);
  });

  it("does not act when the pointer wandered (a look drag)", () => {
    const press = heldPress();
    press.moved = FP_TAP_SLOP_PX;
    expect(shouldFireFpTapAct(press, 1_000 + FP_TAP_MS - 1)).toBe(false);
  });

  it("does not act when a long press already fired", () => {
    const press = heldPress();
    press.longPressFired = true;
    expect(shouldFireFpTapAct(press, 1_000 + FP_TAP_MS - 1)).toBe(false);
  });

  it("begin resets slop, hold, and target from the previous press", () => {
    const press = heldPress(TARGET_A);
    press.moved = 40;
    press.longPressFired = true;
    beginFpLookPress(press, 9, 10, 20, 5_000, TARGET_B);
    expect(press.moved).toBe(0);
    expect(press.longPressFired).toBe(false);
    expect(press.targetAtStart).toBe(TARGET_B);
    expect(
      shouldFireFpLongPress(press, 5_000 + FP_LONG_PRESS_MS, TARGET_B),
    ).toBe(true);
  });
});
