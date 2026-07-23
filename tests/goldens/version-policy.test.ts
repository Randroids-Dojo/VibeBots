import { describe, expect, it } from "vitest";
import { SIM_VERSION } from "../../src/sim/constants";
import { MINE_VERSION } from "../../src/sim/mine/consumables";
import {
  assessVersionPolicy,
  fieldDifferences,
  type GoldenVector,
} from "./harness";

function vector(overrides: Partial<GoldenVector> = {}): GoldenVector {
  return {
    schemaVersion: 1,
    id: "GOLDEN-WORLD-9999",
    kind: "world",
    seed: 1,
    stepCount: 1,
    simVersion: SIM_VERSION,
    actionLog: [],
    expected: { snapshotHash: "old", outcomes: {} },
    manifestId: "test",
    ...overrides,
  };
}

describe("golden version policy", () => {
  it("blocks changed simulation output while SIM_VERSION is unchanged", () => {
    expect(() => assessVersionPolicy(vector(), true)).toThrow(
      "deterministic output changed while SIM_VERSION stayed",
    );
  });

  it("blocks changed mine output while MINE_VERSION is unchanged", () => {
    expect(() =>
      assessVersionPolicy(
        vector({
          id: "GOLDEN-MINING-9999",
          kind: "mining",
          mineVersion: MINE_VERSION,
        }),
        true,
      ),
    ).toThrow("deterministic output changed while MINE_VERSION stayed");
  });

  it("allows changed output after the relevant version bump", () => {
    expect(
      assessVersionPolicy(vector({ simVersion: SIM_VERSION - 1 }), true),
    ).toEqual({ kind: "ok" });
  });

  it("warns when a version bump changes no covered vector", () => {
    expect(
      assessVersionPolicy(vector({ simVersion: SIM_VERSION - 1 }), false),
    ).toMatchObject({ kind: "warning" });
  });

  it("reports nested semantic changes by field path", () => {
    expect(
      fieldDifferences(
        { outcomes: { payout: 40 }, snapshotHash: "old" },
        { outcomes: { payout: 41 }, snapshotHash: "new" },
      ).map((difference) => difference.path),
    ).toEqual(["$.outcomes.payout", "$.snapshotHash"]);
  });
});
