import { describe, expect, it } from "vitest";
import { TEST_BOT_DESIGN } from "./design";
import { designPartCounts, validateDesignInventory } from "./inventory";

describe("inventory validation", () => {
  it("ignores the free core and counts non-core parts per design", () => {
    const counts = designPartCounts(TEST_BOT_DESIGN);
    expect(counts.get("core-cube")).toBeUndefined();
    expect(counts.get("drive-wheel")).toBe(2);
    expect(counts.get("ram-spike")).toBe(1);
  });

  it("accepts designs covered by owned inventory", () => {
    const result = validateDesignInventory(TEST_BOT_DESIGN, [
      { part_id: "drive-wheel", count: 2 },
      { part_id: "ram-spike", count: 1 },
    ]);
    expect(result.ok).toBe(true);
  });

  it("reports every part that exceeds owned inventory", () => {
    const result = validateDesignInventory(TEST_BOT_DESIGN, [
      { part_id: "drive-wheel", count: 1 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("Drive Wheel: uses 2, owns 1");
      expect(result.errors.join("\n")).toContain("Ram Spike: uses 1, owns 0");
    }
  });
});
