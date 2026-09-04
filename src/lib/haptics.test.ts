import { afterEach, describe, expect, it, vi } from "vitest";
import { buzz, HAPTIC_PLACE, HAPTIC_REMOVE } from "./haptics";

describe("haptics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls navigator.vibrate with the given pattern", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    buzz(HAPTIC_PLACE);
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_PLACE);
    buzz(HAPTIC_REMOVE);
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_REMOVE);
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

  it("uses distinct patterns for place and remove", () => {
    expect(HAPTIC_REMOVE).not.toEqual(HAPTIC_PLACE);
  });
});
