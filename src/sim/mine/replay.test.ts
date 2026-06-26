import { describe, expect, it } from "vitest";
import type { MineConsumables } from "./consumables";
import { DEFAULT_GEAR } from "./gear";
import { oreDef } from "./ores";
import { applyAction, replayTrip } from "./replay";
import { cellAt, createMine, setCell } from "./world";

function stock(over: Partial<MineConsumables>): MineConsumables {
  return {
    dynamite: 0,
    rope: 0,
    ladder: 0,
    plank: 0,
    beacon: 0,
    ...over,
  };
}

describe("mine replay orchestration", () => {
  it("banks carried ore and parts when recall succeeds", () => {
    const state = createMine(42, DEFAULT_GEAR, stock({ rope: 1 }));
    state.miner.row = 4;
    state.miner.carried = { coal: 2 };
    state.miner.carriedParts = ["drill"];

    expect(applyAction(state, "recall")).toMatchObject({
      ok: true,
      recalled: true,
      collapsed: false,
    });
    expect(state.miner.row).toBe(0);
    expect(state.miner.bankedCredits).toBe(2);
    expect(state.miner.bankedParts).toEqual(["drill"]);
    expect(state.consumables.rope).toBe(0);
    expect(state.used.rope).toBe(1);
  });

  it("preserves abandoned cargo as a recoverable dropped bag", () => {
    const state = createMine(42);
    state.miner.row = 2;
    state.miner.carried = { copper: 3 };
    state.miner.carriedSalvageCredits = 4;
    state.miner.carriedParts = ["drill"];
    setCell(state, 0, 2, { kind: "empty" });

    expect(applyAction(state, "abandon")).toMatchObject({
      ok: true,
      collapsed: true,
      abandoned: true,
    });
    expect(state.miner.lostCargo).toEqual({
      col: 0,
      row: 2,
      value: 3 * oreDef("copper").value + 4,
      parts: ["drill"],
    });
    expect(cellAt(state, 0, 2)?.bag).toEqual({
      ores: { copper: 3 },
      salvageCredits: 4,
      parts: ["drill"],
    });
  });

  it("plants dynamite first and detonates it after the miner moves clear", () => {
    const state = createMine(42, DEFAULT_GEAR, stock({ dynamite: 1 }));
    state.miner.row = 1;
    setCell(state, 0, 1, { kind: "empty" });
    setCell(state, 1, 1, { kind: "empty" });
    setCell(state, 0, 2, { kind: "rock", rockTier: 1 });

    expect(applyAction(state, "dynamite-1")).toMatchObject({
      ok: true,
      dynamitePlanted: { col: 0, row: 1, tier: 1 },
    });
    expect(state.pendingDynamite).toEqual({ col: 0, row: 1, tier: 1 });

    const moved = applyAction(state, "right");

    expect(moved.ok).toBe(true);
    if (!moved.ok) throw new Error("expected dynamite clear move to succeed");
    expect(state.pendingDynamite).toBeUndefined();
    expect(moved.exploded).toEqual({ col: 0, row: 1, tier: 1 });
    expect(cellAt(state, 0, 2)?.kind).toBe("empty");
  });

  it("runs elevator rides through replayTrip and counts successful moves", () => {
    const result = replayTrip(
      42,
      ["left", "left", "left", "left", "left", "ride-down", "ride-up"],
      { ...DEFAULT_GEAR, elevator: 12, elevatorSpeed: 1 },
      stock({}),
    );

    expect(result.moves).toBe(7);
    expect(result.maxDepth).toBe(6);
    expect(result.diff).toEqual([
      [-5, 1, { kind: "empty" }],
      [-5, 2, { kind: "empty" }],
      [-5, 3, { kind: "empty" }],
      [-5, 4, { kind: "empty" }],
      [-5, 5, { kind: "empty" }],
      [-5, 6, { kind: "empty" }],
    ]);
  });

  it("keeps stationary drop actions from reclaiming deferred ore immediately", () => {
    const state = createMine(42);
    state.miner.row = 1;
    state.miner.carried = { coal: 4 };
    setCell(state, 0, 1, { kind: "empty" });

    expect(applyAction(state, "drop:coal:2")).toMatchObject({
      ok: true,
      droppedFromBag: 2,
    });
    expect(state.miner.carried.coal).toBe(2);
    expect(applyAction(state, "drop:coal:2")).toMatchObject({
      ok: true,
      droppedFromBag: 2,
    });
    expect(state.miner.carried.coal).toBeUndefined();
  });
});
