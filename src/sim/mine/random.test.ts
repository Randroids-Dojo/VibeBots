import { describe, expect, it } from "vitest";
import { cellRandom } from "./random";

describe("mine deterministic random helper", () => {
  it("is stable for identical coordinates and salt", () => {
    expect(cellRandom(123, 4, -2, 7)).toBe(cellRandom(123, 4, -2, 7));
  });

  it("changes when the salt changes", () => {
    expect(cellRandom(123, 4, -2, 7)).not.toBe(cellRandom(123, 4, -2, 8));
  });

  it("returns values in the half-open unit interval", () => {
    for (let seed = 1; seed <= 5; seed++) {
      for (let row = 0; row <= 20; row += 5) {
        for (let col = -3; col <= 3; col += 3) {
          const value = cellRandom(seed, row, col, 0x9e37);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(1);
        }
      }
    }
  });
});
