import { describe, expect, it } from "vitest";
import {
  addConsumables,
  LADDER_RECOVERY_FLOOR,
  normalizeBeaconLabel,
  PLANK_RECOVERY_FLOOR,
  STARTING_CONSUMABLES,
  supportSalvageValue,
} from "./consumables";

describe("mine consumable helpers", () => {
  it("rounds support salvage down with a minimum value", () => {
    expect(supportSalvageValue("ladder")).toBe(1);
    expect(supportSalvageValue("plank")).toBe(1);
    expect(supportSalvageValue("beacon")).toBe(30);
  });

  it("normalizes beacon labels by collapsing whitespace and truncating", () => {
    expect(normalizeBeaconLabel("  Deep   Camp Name  ")).toBe("Deep Camp Na");
    expect(normalizeBeaconLabel("\tNorth\nGate\t")).toBe("North Gate");
  });

  it("adds consumable counts by key and locks starter recovery defaults", () => {
    expect(
      addConsumables(
        { dynamite: 1, rope: 2, ladder: 3, plank: 4, beacon: 5 },
        { dynamite: 5, rope: 4, ladder: 3, plank: 2, beacon: 1 },
      ),
    ).toEqual({ dynamite: 6, rope: 6, ladder: 6, plank: 6, beacon: 6 });
    expect(LADDER_RECOVERY_FLOOR).toBe(8);
    expect(PLANK_RECOVERY_FLOOR).toBe(4);
    expect(STARTING_CONSUMABLES).toEqual({
      dynamite: 0,
      rope: 0,
      ladder: 8,
      plank: 4,
      beacon: 0,
    });
  });
});
