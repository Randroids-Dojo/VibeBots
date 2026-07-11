import { describe, expect, it } from "vitest";
import {
  celestialPositionFor,
  daylightGradeFor,
  fogRangeForStratum,
  localClockHour,
  SURFACE_CYCLE_SECONDS,
  surfaceCycleHour,
  surfaceHourFor,
} from "./time-of-day";

describe("surface shift cycle", () => {
  it("covers night, dawn, day, and dusk with distinct art grades", () => {
    const night = daylightGradeFor(0);
    const dawn = daylightGradeFor(6.5);
    const day = daylightGradeFor(13);
    const dusk = daylightGradeFor(19);

    expect([night.phase, dawn.phase, day.phase, dusk.phase]).toEqual([
      "night",
      "dawn",
      "day",
      "dusk",
    ]);
    expect(
      new Set([night.skyColor, dawn.skyColor, day.skyColor, dusk.skyColor])
        .size,
    ).toBe(4);
    expect(night.starOpacity).toBe(1);
    expect(day.starOpacity).toBe(0);
    expect(day.sunStrength).toBeGreaterThan(dawn.sunStrength);
    expect(dusk.fogColor).not.toBe(night.fogColor);
  });

  it("interpolates smoothly through transition hours", () => {
    const beforeDawn = daylightGradeFor(5);
    const sunrise = daylightGradeFor(6);
    const morning = daylightGradeFor(8);
    expect(sunrise.sunStrength).toBeGreaterThan(beforeDawn.sunStrength);
    expect(morning.sunStrength).toBeGreaterThan(sunrise.sunStrength);
    expect(sunrise.starOpacity).toBeLessThan(beforeDawn.starOpacity);
  });

  it("maps one wall-clock cycle onto a full in-world day", () => {
    const cycleMs = SURFACE_CYCLE_SECONDS * 1_000;
    expect(surfaceCycleHour(0)).toBe(0);
    expect(surfaceCycleHour(cycleMs / 4)).toBe(6);
    expect(surfaceCycleHour(cycleMs / 2)).toBe(12);
    expect(surfaceCycleHour(cycleMs * 0.75)).toBe(18);
    expect(surfaceCycleHour(cycleMs)).toBe(0);
    expect(surfaceCycleHour(-cycleMs / 4)).toBe(18);
  });

  it("derives a fractional hour from the local clock", () => {
    expect(localClockHour(new Date(2024, 0, 1, 13, 30, 36))).toBeCloseTo(
      13.51,
      2,
    );
  });

  it("freezes QA overrides and reduced motion instead of accelerating", () => {
    expect(surfaceHourFor(90_000, false, 4.5, 19)).toBe(19);
    expect(surfaceHourFor(90_000, true, 4.5)).toBe(4.5);
    expect(surfaceHourFor(90_000, false, 4.5)).toBe(surfaceCycleHour(90_000));
    expect(surfaceHourFor(90_000, false, 4.5, -2)).toBe(22);
  });

  it("moves one celestial key from sunrise through noon to sunset", () => {
    const sunrise = celestialPositionFor(6);
    const noon = celestialPositionFor(12);
    const sunset = celestialPositionFor(18);
    const midnight = celestialPositionFor(0);
    expect(sunrise[0]).toBeCloseTo(4);
    expect(noon[1]).toBeCloseTo(8);
    expect(sunset[0]).toBeCloseTo(-4);
    expect(noon[2]).toBeCloseTo(midnight[2]);
    expect(midnight[2]).toBeGreaterThan(0);
  });

  it("wraps fractional and out-of-range grade hours", () => {
    expect(daylightGradeFor(24.5)).toEqual(daylightGradeFor(0.5));
    expect(daylightGradeFor(-2)).toEqual(daylightGradeFor(22));
  });
});

describe("depth-tuned fog", () => {
  it("breathes at the surface and presses in when deep", () => {
    const surface = fogRangeForStratum(0);
    const deep = fogRangeForStratum(6);
    expect(surface.near).toBeGreaterThan(deep.near);
    expect(surface.far).toBeGreaterThan(deep.far);
  });

  it("never collapses past its floor", () => {
    const abyss = fogRangeForStratum(40);
    expect(abyss.near).toBe(7.5);
    expect(abyss.far).toBe(17);
    expect(abyss.far).toBeGreaterThan(abyss.near);
  });
});
