import { describe, expect, it } from "vitest";
import { SIM_VERSION } from "../../src/sim/constants";
import { MINE_VERSION } from "../../src/sim/mine/consumables";
import {
  assessVersionPolicy,
  fieldDifferences,
  type GoldenChangeManifest,
  type GoldenVector,
  validateManifestLink,
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

  it("rejects a hand-edited baseline whose manifest version did not advance", () => {
    const manifests: GoldenChangeManifest[] = [
      {
        id: "initial",
        createdAt: "2026-07-22T00:00:00.000Z",
        reason: "Initial baseline",
        changes: [
          {
            vectorId: "GOLDEN-WORLD-9999",
            kind: "world",
            changedFields: ["$"],
            oldSnapshotHash: null,
            newSnapshotHash: "old",
            oldOutcomes: null,
            newOutcomes: { value: 1 },
            versionDecision: {
              constant: "SIM_VERSION",
              from: null,
              to: SIM_VERSION,
            },
          },
        ],
      },
      {
        id: "manual-edit",
        createdAt: "2026-07-23T00:00:00.000Z",
        reason: "Manually replace expected output",
        changes: [
          {
            vectorId: "GOLDEN-WORLD-9999",
            kind: "world",
            changedFields: ["$.outcomes.value", "$.snapshotHash"],
            oldSnapshotHash: "old",
            newSnapshotHash: "new",
            oldOutcomes: { value: 1 },
            newOutcomes: { value: 2 },
            versionDecision: {
              constant: "SIM_VERSION",
              from: SIM_VERSION,
              to: SIM_VERSION,
            },
          },
        ],
      },
    ];

    expect(() =>
      validateManifestLink(
        vector({
          expected: { snapshotHash: "new", outcomes: { value: 2 } },
          manifestId: "manual-edit",
        }),
        manifests,
      ),
    ).toThrow("manifest version does not advance");
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
