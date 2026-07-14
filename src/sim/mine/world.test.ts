import { describe, expect, it } from "vitest";
import type { WorldDiff } from "./cells";
import { MINE_BOTTOM_ROW } from "./consumables";
import { DEFAULT_GEAR } from "./gear";
import {
  cellAt,
  createMine,
  elevatorRailInstalledInDiff,
  exportDiff,
  generatedCell,
  installElevatorRailInDiff,
  setCell,
} from "./world";

describe("mine world module", () => {
  it("generates deterministic pristine cells from seed and coordinates", () => {
    const a = createMine(42);
    const b = createMine(42);

    for (let row = 0; row < 24; row++) {
      for (let col = -3; col <= 3; col++) {
        expect(cellAt(a, col, row)).toEqual(cellAt(b, col, row));
      }
    }
  });

  it("keeps the row 1000 hard floor outside the mutable diff", () => {
    const state = createMine(42, DEFAULT_GEAR);

    expect(generatedCell(42, 0, MINE_BOTTOM_ROW)).toEqual({ kind: "metal" });
    setCell(state, 0, MINE_BOTTOM_ROW, { kind: "empty" });
    expect(cellAt(state, 0, MINE_BOTTOM_ROW)).toEqual({ kind: "metal" });
    expect(exportDiff(state)).toEqual([]);
  });

  it("refunds traversal supports covered by new elevator rail", () => {
    const result = installElevatorRailInDiff(
      [
        [9, 1, { kind: "empty", ladder: true }],
        [9, 2, { kind: "dirt", plank: true }],
        [9, 3, { kind: "empty", ladder: true }],
        [-5, 1, { kind: "empty", ladder: true }],
      ],
      9,
      0,
      2,
    );

    expect(result.refunded).toEqual({ ladder: 1, plank: 1 });
    expect(result.diff).toEqual([
      [-5, 1, { kind: "empty", ladder: true }],
      [9, 1, { kind: "empty" }],
      [9, 2, { kind: "empty" }],
      [9, 3, { kind: "empty", ladder: true }],
    ]);
  });

  it("persists a newly installed rail cell in a pristine shaft", () => {
    const result = installElevatorRailInDiff([], 17, 0, 1);

    expect(result).toEqual({
      diff: [[17, 1, { kind: "empty" }]],
      refunded: {},
    });
  });

  it("keeps durable payloads when rail clears terrain and supports", () => {
    const result = installElevatorRailInDiff(
      [
        [
          17,
          1,
          {
            kind: "ore",
            ore: "coal",
            oreRemaining: 3,
            ladder: true,
            beacon: true,
            beaconOrder: 4,
            beaconLabel: "Lift Cache",
            drop: { copper: 2 },
            dropDeferred: { copper: 1 },
            bag: {
              ores: { coal: 3 },
              salvageCredits: 7,
              parts: ["drill"],
            },
          },
        ],
      ],
      17,
      0,
      1,
    );

    expect(result.refunded).toEqual({ ladder: 1 });
    expect(result.diff).toEqual([
      [
        17,
        1,
        {
          kind: "empty",
          beacon: true,
          beaconOrder: 4,
          beaconLabel: "Lift Cache",
          drop: { copper: 2 },
          dropDeferred: { copper: 1 },
          bag: {
            ores: { coal: 3 },
            salvageCredits: 7,
            parts: ["drill"],
          },
        },
      ],
    ]);
  });

  it("accepts canonical rail with durable payload keys in any order", () => {
    const diff = [
      [
        17,
        1,
        {
          dropDeferred: { copper: 1 },
          portalActive: false,
          bag: {
            parts: ["drill"],
            salvageCredits: 7,
            ores: { coal: 3 },
          },
          beaconLabel: "Lift Cache",
          drop: { copper: 2 },
          kind: "empty",
          beaconOrder: 4,
          beacon: true,
          portal: "winter",
        },
      ],
    ] satisfies WorldDiff;

    expect(elevatorRailInstalledInDiff(diff, 17, 1)).toBe(true);
  });

  it.each([
    ["a missing row", []],
    ["terrain", [[17, 1, { kind: "dirt" }]]],
    ["a ladder", [[17, 1, { kind: "empty", ladder: true }]]],
    ["a plank", [[17, 1, { kind: "empty", plank: true }]]],
    ["transient state", [[17, 1, { kind: "empty", fallIn: 2 }]]],
  ] satisfies Array<
    [string, WorldDiff]
  >)("rejects shaft rail containing %s", (_label, diff) => {
    expect(elevatorRailInstalledInDiff(diff, 17, 1)).toBe(false);
  });
});
