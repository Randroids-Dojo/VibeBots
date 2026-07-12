import { describe, expect, it } from "vitest";
import {
  ACCENT_LIGHT_COUNT,
  ACCENT_SLOTS,
  accentEmitterCount,
  pushAccentEmitter,
  resetAccentEmitters,
} from "./mine-accent-lights";

describe("accent light pool", () => {
  it("fills slots in order until the pool is full", () => {
    resetAccentEmitters();
    pushAccentEmitter(1, -2, 0.5, "#e08aff", 1.4, 4, 1.6, 9);
    pushAccentEmitter(3, -4, 0.3, "#f5c542", 0.45, 1.6, 1.8, 4);
    expect(accentEmitterCount()).toBe(2);
    expect(ACCENT_SLOTS[0]).toMatchObject({
      x: 1,
      y: -2,
      z: 0.5,
      color: "#e08aff",
      intensity: 1.4,
      lightDistance: 4,
      decay: 1.6,
    });
    expect(ACCENT_SLOTS[1].color).toBe("#f5c542");
  });

  it("keeps the nearest emitters when offered more than the pool holds", () => {
    resetAccentEmitters();
    pushAccentEmitter(0, 0, 0, "#a", 1, 1, 1, 25);
    pushAccentEmitter(0, 0, 0, "#b", 1, 1, 1, 1);
    pushAccentEmitter(0, 0, 0, "#c", 1, 1, 1, 16);
    pushAccentEmitter(0, 0, 0, "#d", 1, 1, 1, 4);
    expect(accentEmitterCount()).toBe(ACCENT_LIGHT_COUNT);
    const kept = ACCENT_SLOTS.map((slot) => slot.color).sort();
    expect(kept).toEqual(["#b", "#c", "#d"]);
  });

  it("ignores an emitter farther than every kept one", () => {
    resetAccentEmitters();
    pushAccentEmitter(0, 0, 0, "#a", 1, 1, 1, 1);
    pushAccentEmitter(0, 0, 0, "#b", 1, 1, 1, 2);
    pushAccentEmitter(0, 0, 0, "#c", 1, 1, 1, 3);
    pushAccentEmitter(0, 0, 0, "#far", 1, 1, 1, 99);
    expect(ACCENT_SLOTS.map((slot) => slot.color)).not.toContain("#far");
  });

  it("reset starts a fresh gather without touching mounted slot data", () => {
    resetAccentEmitters();
    pushAccentEmitter(0, 0, 0, "#a", 1, 1, 1, 1);
    resetAccentEmitters();
    expect(accentEmitterCount()).toBe(0);
  });
});
