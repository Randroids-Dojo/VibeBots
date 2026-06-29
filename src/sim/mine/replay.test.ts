import { describe, expect, it } from "vitest";
import {
  activatePortalAction,
  collectAction,
  portalWarpAction,
} from "./actions";
import type { MineState } from "./cells";
import type { MineConsumables } from "./consumables";
import { START_COL } from "./digging";
import { DEFAULT_GEAR, ELEVATOR_COL } from "./gear";
import { oreDef } from "./ores";
import { applyAction, replayTrip } from "./replay";
import { cellAt, createMine, FALL_DELAY_ACTIONS, setCell } from "./world";

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

function pendingSideEffectState(
  consumables: Partial<MineConsumables> = {},
): MineState {
  const state = createMine(420, DEFAULT_GEAR, stock(consumables));
  state.miner.row = 2;
  setCell(state, START_COL, 2, { kind: "empty" });
  state.pendingDynamite = { col: START_COL, row: 2, tier: 1 };
  state.jumpHover = true;
  setCell(state, START_COL + 1, 5, {
    kind: "boulder",
    fallIn: FALL_DELAY_ACTIONS,
  });
  setCell(state, START_COL + 1, 6, { kind: "empty" });
  return state;
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

  it("keeps manual bag drops out of generic turn finalization", () => {
    const state = pendingSideEffectState();
    state.miner.carried = { coal: 3 };

    expect(applyAction(state, "drop:coal:1")).toMatchObject({
      ok: true,
      droppedFromBag: 1,
      collapsed: false,
    });
    expect(state.pendingDynamite).toEqual({ col: START_COL, row: 2, tier: 1 });
    expect(state.jumpHover).toBe(true);
    expect(cellAt(state, START_COL + 1, 5)?.fallIn).toBe(FALL_DELAY_ACTIONS);
  });

  it("keeps recall and abandon on their terminal trip-control contract", () => {
    const recalled = pendingSideEffectState({ rope: 1 });

    expect(applyAction(recalled, "recall")).toMatchObject({
      ok: true,
      recalled: true,
      collapsed: false,
    });
    expect(recalled.pendingDynamite).toEqual({
      col: START_COL,
      row: 2,
      tier: 1,
    });
    expect(recalled.jumpHover).toBe(true);
    expect(cellAt(recalled, START_COL + 1, 5)?.fallIn).toBe(FALL_DELAY_ACTIONS);

    const abandoned = pendingSideEffectState();

    expect(applyAction(abandoned, "abandon")).toMatchObject({
      ok: true,
      abandoned: true,
      collapsed: true,
    });
    expect(abandoned.pendingDynamite).toBeUndefined();
    expect(abandoned.jumpHover).toBe(true);
    expect(cellAt(abandoned, START_COL + 1, 5)?.fallIn).toBe(
      FALL_DELAY_ACTIONS,
    );
    expect(abandoned.granted.ladder).toBe(0);
    expect(abandoned.granted.plank).toBe(0);
  });

  it("keeps warp, portal, and beacon actions out of generic finalization", () => {
    const beaconed = pendingSideEffectState({ beacon: 1 });

    expect(applyAction(beaconed, "place-beacon")).toMatchObject({
      ok: true,
      collapsed: false,
    });
    expect(beaconed.pendingDynamite).toEqual({
      col: START_COL,
      row: 2,
      tier: 1,
    });
    expect(beaconed.jumpHover).toBe(true);
    expect(applyAction(beaconed, "warp-home")).toMatchObject({
      ok: true,
      collapsed: false,
    });
    expect(beaconed.pendingDynamite).toEqual({
      col: START_COL,
      row: 2,
      tier: 1,
    });
    expect(applyAction(beaconed, "warp-down:0,2")).toMatchObject({
      ok: true,
      collapsed: false,
    });

    const portal = pendingSideEffectState();
    portal.miner.col = -75;
    portal.miner.row = 0;
    portal.pendingDynamite = { col: -75, row: 0, tier: 1 };
    expect(applyAction(portal, activatePortalAction("winter"))).toMatchObject({
      ok: true,
      collapsed: false,
    });
    expect(portal.pendingDynamite).toEqual({ col: -75, row: 0, tier: 1 });
    expect(applyAction(portal, portalWarpAction("base"))).toMatchObject({
      ok: true,
      collapsed: false,
    });
    expect(portal.pendingDynamite).toEqual({ col: -75, row: 0, tier: 1 });
  });

  it("runs movement, support collection, and elevator descent finalization", () => {
    const support = createMine(42);
    support.miner.col = START_COL;
    support.miner.row = 3;
    support.jumpHover = true;
    setCell(support, START_COL, 1, { kind: "empty", ladder: true });
    setCell(support, START_COL, 2, { kind: "empty", ladder: true });
    setCell(support, START_COL, 3, { kind: "empty", ladder: true });
    setCell(support, START_COL, 4, { kind: "empty" });
    setCell(support, START_COL, 5, { kind: "dirt" });

    const collected = applyAction(
      support,
      collectAction([{ type: "ladder", col: START_COL, row: 3 }]),
    );

    expect(collected.ok && collected.supportCollected).toEqual({ ladder: 1 });
    expect(collected.ok && collected.ladderFalls).toEqual([
      { from: { col: START_COL, row: 2 }, to: { col: START_COL, row: 4 } },
      { from: { col: START_COL, row: 1 }, to: { col: START_COL, row: 3 } },
    ]);
    expect(support.jumpHover).toBe(false);

    const falling = createMine(4301, { ...DEFAULT_GEAR, pickaxe: 4 });
    falling.miner.col = START_COL;
    falling.miner.row = 6;
    setCell(falling, START_COL, 6, { kind: "empty" });
    setCell(falling, START_COL, 7, { kind: "dirt" });
    setCell(falling, START_COL + 1, 5, { kind: "boulder" });
    setCell(falling, START_COL + 1, 6, { kind: "dirt", hp: 1 });
    setCell(falling, START_COL + 1, 7, { kind: "dirt" });
    setCell(falling, START_COL + 2, 6, { kind: "empty" });
    setCell(falling, START_COL + 2, 7, { kind: "dirt" });
    const dug = applyAction(falling, "right");
    expect(dug.ok && dug.fallingRockWarnings).toEqual([
      { col: START_COL + 1, row: 5 },
    ]);
    expect(cellAt(falling, START_COL + 1, 5)?.fallIn).toBe(FALL_DELAY_ACTIONS);

    const elevator = createMine(42, { ...DEFAULT_GEAR, elevator: 12 });
    elevator.miner.col = ELEVATOR_COL;
    setCell(elevator, ELEVATOR_COL, 1, { kind: "dirt", hp: 1 });
    setCell(elevator, ELEVATOR_COL + 1, 5, {
      kind: "boulder",
      fallIn: FALL_DELAY_ACTIONS,
    });
    setCell(elevator, ELEVATOR_COL + 1, 6, { kind: "empty" });
    setCell(elevator, ELEVATOR_COL + 1, 7, { kind: "dirt" });
    const ride = applyAction(elevator, "ride-down");
    expect(ride.ok).toBe(true);
    expect(elevator.miner.row).toBe(6);
    expect(cellAt(elevator, ELEVATOR_COL + 1, 5)?.fallIn).toBe(
      FALL_DELAY_ACTIONS - 1,
    );
  });
});
