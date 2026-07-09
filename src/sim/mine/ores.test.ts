import { describe, expect, it } from "vitest";
import {
  EARLY_ORE_BOOST_PEAK,
  EARLY_ORE_BOOST_ROWS,
  earlyOreBoost,
  oreChanceAt,
  oreDef,
} from "./ores";
import { generatedCell } from "./world";

describe("early ore boost (F-060)", () => {
  it("peaks on the first row and tapers to 1 by the boost horizon", () => {
    expect(earlyOreBoost(1)).toBeCloseTo(EARLY_ORE_BOOST_PEAK);
    expect(earlyOreBoost(EARLY_ORE_BOOST_ROWS)).toBe(1);
    // Rows past the horizon and the surface are untouched.
    expect(earlyOreBoost(EARLY_ORE_BOOST_ROWS + 1)).toBe(1);
    expect(earlyOreBoost(0)).toBe(1);
    // Monotonic taper across the boosted band.
    expect(earlyOreBoost(1)).toBeGreaterThan(earlyOreBoost(2));
    expect(earlyOreBoost(2)).toBeGreaterThan(earlyOreBoost(3));
  });

  it("gives coal a real chance on the very first dug row", () => {
    // The tier-0 ore band now opens at row 1 instead of ramping from zero,
    // so the opening cut is not guaranteed dirt.
    expect(oreChanceAt(oreDef("coal"), 1)).toBeGreaterThan(0);
  });

  it("packs more ore into the first rows than deeper untouched rows", () => {
    const oreInRow = (seed: number, row: number): number => {
      let count = 0;
      for (let col = -40; col <= 40; col++) {
        if (generatedCell(seed, col, row).kind === "ore") count += 1;
      }
      return count;
    };
    // Averaged over seeds the boosted first row out-yields a mid row where
    // only the coal band is active but no boost applies.
    let earlyTotal = 0;
    let plainTotal = 0;
    for (let seed = 1; seed <= 12; seed++) {
      earlyTotal += oreInRow(seed, 1);
      plainTotal += oreInRow(seed, EARLY_ORE_BOOST_ROWS + 2);
    }
    expect(earlyTotal).toBeGreaterThan(plainTotal);
    // And the first row is never barren of ore across this sample.
    expect(earlyTotal).toBeGreaterThan(0);
  });
});
