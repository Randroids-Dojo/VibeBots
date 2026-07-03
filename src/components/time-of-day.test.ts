import { describe, expect, it } from "vitest";
import { daylightGradeFor, fogRangeForStratum } from "./time-of-day";

describe("daylight grade", () => {
  it("holds full noon sun through the day plateau", () => {
    for (const hour of [10, 13, 16]) {
      const grade = daylightGradeFor(hour);
      expect(grade.phase).toBe("day");
      expect(grade.sunStrength).toBe(1);
      expect(grade.sunColor).toBe("#fff4e0");
    }
  });

  it("dims and cools at night but stays playable", () => {
    for (const hour of [0, 3, 23]) {
      const grade = daylightGradeFor(hour);
      expect(grade.phase).toBe("night");
      expect(grade.sunStrength).toBeGreaterThanOrEqual(0.6);
      expect(grade.sunStrength).toBeLessThan(0.7);
    }
  });

  it("warms through dawn and dusk transitions", () => {
    expect(daylightGradeFor(7).phase).toBe("dawn");
    expect(daylightGradeFor(19).phase).toBe("dusk");
    // Between the night anchor and full day, strength climbs.
    expect(daylightGradeFor(6).sunStrength).toBeGreaterThan(
      daylightGradeFor(5).sunStrength,
    );
    expect(daylightGradeFor(9).sunStrength).toBeGreaterThan(
      daylightGradeFor(7).sunStrength,
    );
  });

  it("wraps fractional and out-of-range hours", () => {
    expect(daylightGradeFor(24.5).phase).toBe(daylightGradeFor(0.5).phase);
    expect(daylightGradeFor(-2)).toEqual(daylightGradeFor(22));
    expect(daylightGradeFor(13.75).sunStrength).toBe(1);
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
