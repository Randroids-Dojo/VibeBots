import { afterEach, describe, expect, it, vi } from "vitest";
import { buzz, HAPTIC_MERGE, HAPTIC_PLACE, HAPTIC_REMOVE } from "./haptics";

describe("haptics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls navigator.vibrate with the given pattern", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    buzz(HAPTIC_PLACE);
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_PLACE);
    buzz(HAPTIC_MERGE);
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_MERGE);
  });

  it("no-ops when vibrate is unavailable", () => {
    vi.stubGlobal("navigator", {});
    expect(() => buzz(HAPTIC_REMOVE)).not.toThrow();
  });

  it("swallows errors thrown by vibrate", () => {
    const vibrate = vi.fn(() => {
      throw new Error("not allowed");
    });
    vi.stubGlobal("navigator", { vibrate });
    expect(() => buzz(HAPTIC_PLACE)).not.toThrow();
  });

  it("uses distinct patterns for place, merge, and remove", () => {
    expect(HAPTIC_PLACE).not.toEqual(HAPTIC_MERGE);
    expect(HAPTIC_REMOVE).not.toEqual(HAPTIC_PLACE);
    // The merge is the signature moment: a multi-step pattern, not a single tap.
    expect(Array.isArray(HAPTIC_MERGE)).toBe(true);
  });
});
