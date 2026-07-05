import { describe, expect, it } from "vitest";
import { validateDesign } from "./design";
import { REPLICA_OPPONENTS } from "./opponents";
import { PART_CATALOG } from "./parts";

describe("replica opponents", () => {
  it("has unique ids and models a distinct real bot each", () => {
    const ids = REPLICA_OPPONENTS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    const inspirations = REPLICA_OPPONENTS.map((o) => o.inspiredBy);
    expect(new Set(inspirations).size).toBe(inspirations.length);
    expect(REPLICA_OPPONENTS.length).toBeGreaterThanOrEqual(3);
  });

  for (const opponent of REPLICA_OPPONENTS) {
    it(`${opponent.id} is a valid, in-budget design with exactly one core`, () => {
      const result = validateDesign(opponent.design);
      expect(result.ok).toBe(true);
      const cores = opponent.design.parts.filter(
        (p) => PART_CATALOG[p.partId]?.category === "core",
      );
      expect(cores).toHaveLength(1);
      // A non-trivial bot: a core plus drive and at least one non-core part.
      expect(opponent.design.parts.length).toBeGreaterThanOrEqual(4);
    });
  }
});
