import { describe, expect, it } from "vitest";
import { BLUEPRINTS } from "./blueprints";
import { validateDesign } from "./design";
import { PART_CATALOG } from "./parts";

describe("starter blueprints", () => {
  it("offers one blueprint per chassis, all with unique ids", () => {
    const ids = BLUEPRINTS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    const cores = BLUEPRINTS.map(
      (b) =>
        b.design.parts.find((p) => PART_CATALOG[p.partId]?.category === "core")
          ?.partId,
    );
    expect(new Set(cores)).toEqual(
      new Set(["core-cube", "wedge-core", "tower-core"]),
    );
  });

  for (const blueprint of BLUEPRINTS) {
    it(`${blueprint.id} is a valid, in-budget design`, () => {
      const result = validateDesign(blueprint.design);
      expect(result.ok).toBe(true);
      // Every part id resolves and every connection joins matching kinds is
      // covered by validateDesign; assert the design is non-trivial so a
      // blueprint is never just a bare core.
      expect(blueprint.design.parts.length).toBeGreaterThanOrEqual(4);
    });
  }
});
