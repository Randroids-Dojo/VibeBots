import { describe, expect, it } from "vitest";
import {
  activatePortalAction,
  collectAction,
  type MineAction,
  portalWarpAction,
} from "./actions";
import type { MineState } from "./cells";
import type { MineConsumables } from "./consumables";
import { START_COL } from "./digging";
import { DEFAULT_GEAR, ELEVATOR_COL } from "./gear";
import { oreDef } from "./ores";
import { applyAction, replayTrip } from "./replay";
import {
  cellAt,
  createMine,
  exportDiff,
  FALL_DELAY_ACTIONS,
  GAS_SEEP_BUDGET,
  GAS_SEEPED_FADE_ACTIONS,
  GAS_WISP_DISPERSE_DRAIN,
  SPAN_COLLAPSE_DELAY_ACTIONS,
  setCell,
} from "./world";

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

/**
 * Fabricated wide tunnel at row 8: cols START_COL..START_COL+width-2 are
 * pre-dug, the last cell is one swing from breaking, and the ceiling,
 * floor, upper rows, and side walls are pinned so pristine rolls (gas,
 * caches, boulders) cannot blur the contracts. The miner stands one cell
 * short of the final dig.
 */
function wideTunnelState(width: number): MineState {
  const state = createMine(77, DEFAULT_GEAR, stock({ plank: 2 }));
  for (let i = 0; i < width - 1; i++)
    setCell(state, START_COL + i, 8, { kind: "empty" });
  setCell(state, START_COL + width - 1, 8, { kind: "dirt", hp: 1 });
  for (let i = 0; i < width; i++) {
    setCell(state, START_COL + i, 7, { kind: "dirt" });
    setCell(state, START_COL + i, 6, { kind: "dirt" });
  }
  setCell(state, START_COL - 1, 8, { kind: "metal" });
  setCell(state, START_COL + width, 8, { kind: "metal" });
  for (let i = -1; i <= width; i++)
    setCell(state, START_COL + i, 9, { kind: "dirt" });
  state.miner.col = START_COL + width - 2;
  state.miner.row = 8;
  return state;
}

describe("structural integrity (wide spans)", () => {
  it("destabilizes the whole ceiling above a five-wide unpropped span", () => {
    const state = wideTunnelState(5);
    const result = applyAction(state, "right");
    expect(result.ok && result.fallingRockTriggered).toBe(true);
    expect(result.ok && result.fallingRockWarnings).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      const ceiling = cellAt(state, START_COL + i, 7);
      expect(ceiling?.fallIn).toBe(SPAN_COLLAPSE_DELAY_ACTIONS);
      expect(ceiling?.spanUnstable).toBe(true);
    }
  });

  it("leaves a four-wide span stable", () => {
    const state = wideTunnelState(4);
    const result = applyAction(state, "right");
    expect(result.ok).toBe(true);
    expect(result.ok && result.fallingRockTriggered).toBeUndefined();
    for (let i = 0; i < 4; i++)
      expect(cellAt(state, START_COL + i, 7)?.fallIn).toBeUndefined();
  });

  it("re-stabilizes the condemned roof when a plank splits the span", () => {
    const state = wideTunnelState(5);
    applyAction(state, "right");
    // The miner stands in the freshly dug fifth cell; a plank one cell
    // left splits the span into runs of 3 and 1 and props its own
    // ceiling, so every condemned cell is rescued.
    const planked = applyAction(state, "plank-left");
    expect(planked.ok && planked.plankPlaced).toEqual({
      col: START_COL + 3,
      row: 8,
    });
    for (let i = 0; i < 5; i++) {
      const ceiling = cellAt(state, START_COL + i, 7);
      expect(ceiling?.fallIn).toBeUndefined();
      expect(ceiling?.spanUnstable).toBeUndefined();
    }
  });

  it("re-condemns the roof when the propping plank breaks", () => {
    const state = wideTunnelState(5);
    applyAction(state, "right");
    applyAction(state, "plank-left");
    applyAction(state, "left");
    // Standing on the plank, smash through it (PLANK_HITS swings).
    let broke = false;
    for (let swing = 0; swing < 5 && !broke; swing++) {
      const result = applyAction(state, "down");
      broke = result.ok && result.supportCollected?.plank === 1;
    }
    expect(broke).toBe(true);
    for (let i = 0; i < 5; i++) {
      const ceiling = cellAt(state, START_COL + i, 7);
      expect(ceiling?.fallIn).toBe(SPAN_COLLAPSE_DELAY_ACTIONS);
      expect(ceiling?.spanUnstable).toBe(true);
    }
  });

  it("keeps a direct undercut teeter through a plank rescue", () => {
    const state = createMine(99, DEFAULT_GEAR, stock({ plank: 1 }));
    setCell(state, START_COL, 8, { kind: "empty" });
    setCell(state, START_COL + 1, 8, { kind: "dirt", hp: 1 });
    setCell(state, START_COL + 1, 7, { kind: "rock", rockTier: 1 });
    setCell(state, START_COL, 7, { kind: "dirt" });
    setCell(state, START_COL - 1, 8, { kind: "metal" });
    setCell(state, START_COL + 2, 8, { kind: "metal" });
    setCell(state, START_COL, 9, { kind: "dirt" });
    setCell(state, START_COL + 1, 9, { kind: "dirt" });
    state.miner.col = START_COL;
    state.miner.row = 8;
    const dug = applyAction(state, "right");
    expect(dug.ok && dug.fallingRockWarnings).toEqual([
      { col: START_COL + 1, row: 7 },
    ]);
    expect(cellAt(state, START_COL + 1, 7)?.spanUnstable).toBeUndefined();
    const planked = applyAction(state, "plank-left");
    expect(planked.ok).toBe(true);
    // The plank action ticks the countdown but never cancels a real
    // undercut: only span-condemned cells are rescuable.
    expect(cellAt(state, START_COL + 1, 7)?.fallIn).toBe(
      FALL_DELAY_ACTIONS - 1,
    );
  });

  it("drops the condemned roof on schedule, crushing and preserving ore", () => {
    const state = wideTunnelState(5);
    setCell(state, START_COL + 1, 7, {
      kind: "ore",
      ore: "coal",
      oreRemaining: 3,
    });
    applyAction(state, "right");
    applyAction(state, "left");
    applyAction(state, "right");
    applyAction(state, "left");
    const last = applyAction(state, "right");
    expect(last.ok && last.collapsed).toBe(true);
    expect(last.ok && last.crushed).toBe(true);
    // The roof landed in the tunnel: dirt filled row 8, the ore deposit
    // relocated intact, and the vacated row did not cascade upward.
    expect(cellAt(state, START_COL + 1, 8)).toMatchObject({
      kind: "ore",
      ore: "coal",
      oreRemaining: 3,
    });
    expect(cellAt(state, START_COL, 8)?.kind).toBe("dirt");
    for (let i = 0; i < 5; i++) {
      expect(cellAt(state, START_COL + i, 7)?.kind).toBe("empty");
      expect(cellAt(state, START_COL + i, 6)?.fallIn).toBeUndefined();
    }
  });

  it("replays a span collapse identically from the same log", () => {
    const fabricated = createMine(4242);
    // Shaft down to row 7; the tunnel row 8 cells all take one swing.
    // The shaft column's ceiling is the shaft hole itself, so the
    // condemned roof is the four dirt cells over cols +1..+4.
    for (let row = 1; row <= 7; row++)
      setCell(fabricated, START_COL, row, { kind: "dirt", hp: 1 });
    for (let i = 0; i < 5; i++) {
      setCell(fabricated, START_COL + i, 8, { kind: "dirt", hp: 1 });
      if (i > 0) {
        setCell(fabricated, START_COL + i, 7, { kind: "dirt" });
        setCell(fabricated, START_COL + i, 6, { kind: "dirt" });
      }
      setCell(fabricated, START_COL + i, 9, { kind: "dirt" });
    }
    setCell(fabricated, START_COL - 1, 8, { kind: "metal" });
    setCell(fabricated, START_COL + 5, 8, { kind: "metal" });
    const diff = exportDiff(fabricated);
    const actions: MineAction[] = [
      ...Array.from({ length: 8 }, () => "down" as const),
      ...Array.from({ length: 4 }, () => "right" as const),
      "left",
      "right",
      "left",
      "right",
    ];
    const a = replayTrip(4242, actions, DEFAULT_GEAR, stock({}), diff);
    const b = replayTrip(4242, actions, DEFAULT_GEAR, stock({}), diff);
    expect(a.moves).toBe(actions.length);
    expect(b).toEqual(a);
    // The collapse is visible in the persisted diff: the vacated ceiling
    // cells survive as empties.
    expect(
      a.diff.some(
        ([col, row, cell]) =>
          col === START_COL + 2 && row === 7 && cell.kind === "empty",
      ),
    ).toBe(true);
  });
});

/**
 * A teetering boulder one action from dropping past a gas pocket: the
 * fall vacates the cell beside the gas and uncorks it. Every cell the
 * scenario touches is pinned so pristine rolls stay out of the way.
 */
function uncorkedGasState(): MineState {
  const state = createMine(555, DEFAULT_GEAR, stock({}));
  const c = START_COL;
  state.miner.col = c;
  state.miner.row = 6;
  setCell(state, c - 1, 6, { kind: "empty" });
  setCell(state, c - 1, 7, { kind: "dirt" });
  setCell(state, c, 6, { kind: "empty" });
  setCell(state, c, 7, { kind: "dirt" });
  setCell(state, c + 1, 5, { kind: "dirt" });
  setCell(state, c + 1, 6, { kind: "boulder", fallIn: 1 });
  setCell(state, c + 1, 7, { kind: "empty" });
  setCell(state, c + 1, 8, { kind: "dirt" });
  setCell(state, c + 2, 5, { kind: "dirt" });
  setCell(state, c + 2, 6, { kind: "gas" });
  setCell(state, c + 2, 7, { kind: "dirt" });
  setCell(state, c + 3, 6, { kind: "dirt" });
  return state;
}

describe("gas propagation (uncorked pockets)", () => {
  it("uncorks a pocket when a fall vacates its neighbor and leaks a wisp", () => {
    const state = uncorkedGasState();
    const c = START_COL;
    expect(applyAction(state, "left")).toMatchObject({ ok: true });
    // The boulder dropped from (c+1,6) to (c+1,7); the vacated cell sits
    // beside the pocket, which uncorked and leaked its first wisp back
    // into that opening.
    expect(cellAt(state, c + 1, 7)?.kind).toBe("boulder");
    expect(cellAt(state, c + 1, 6)).toMatchObject({
      kind: "gas",
      gasSeeped: true,
      gasFadeIn: GAS_SEEPED_FADE_ACTIONS,
    });
    expect(cellAt(state, c + 2, 6)?.gasSeepBudget).toBe(GAS_SEEP_BUDGET - 1);
  });

  it("keeps wisps out of cells holding supports", () => {
    const state = createMine(558, DEFAULT_GEAR, stock({}));
    const c = START_COL;
    state.miner.col = c;
    state.miner.row = 6;
    setCell(state, c - 1, 6, { kind: "empty" });
    setCell(state, c - 1, 7, { kind: "dirt" });
    setCell(state, c, 6, { kind: "empty" });
    setCell(state, c, 7, { kind: "dirt" });
    // The uncorked pocket's only open neighbor holds a plank: the leak
    // stalls against the support and the budget waits, unspent.
    setCell(state, c + 1, 5, { kind: "dirt" });
    setCell(state, c + 1, 6, { kind: "empty", plank: true });
    setCell(state, c + 1, 7, { kind: "dirt" });
    setCell(state, c + 2, 5, { kind: "dirt" });
    setCell(state, c + 2, 6, { kind: "gas", gasSeepBudget: GAS_SEEP_BUDGET });
    setCell(state, c + 2, 7, { kind: "dirt" });
    setCell(state, c + 3, 6, { kind: "dirt" });
    applyAction(state, "left");
    expect(cellAt(state, c + 1, 6)).toMatchObject({
      kind: "empty",
      plank: true,
    });
    expect(cellAt(state, c + 2, 6)?.gasSeepBudget).toBe(GAS_SEEP_BUDGET);
  });

  it("lets the miner shoulder through a wisp for extra battery drain", () => {
    const state = uncorkedGasState();
    const c = START_COL;
    applyAction(state, "left");
    applyAction(state, "right");
    const before = state.miner.energy;
    const through = applyAction(state, "right");
    expect(through).toMatchObject({ ok: true });
    expect(state.miner).toMatchObject({ col: c + 1, row: 6 });
    expect(cellAt(state, c + 1, 6)?.kind).toBe("empty");
    expect(before - state.miner.energy).toBeGreaterThanOrEqual(
      GAS_WISP_DISPERSE_DRAIN,
    );
  });

  it("vents a whole leak through one dig, wisps free of charge", () => {
    const state = createMine(556, DEFAULT_GEAR, stock({}));
    const c = START_COL;
    state.miner.col = c;
    state.miner.row = 6;
    setCell(state, c, 6, { kind: "empty" });
    setCell(state, c, 7, { kind: "dirt" });
    setCell(state, c + 1, 5, { kind: "dirt" });
    setCell(state, c + 1, 6, { kind: "dirt", hp: 1 });
    setCell(state, c + 1, 7, { kind: "dirt" });
    setCell(state, c + 2, 5, { kind: "dirt" });
    setCell(state, c + 2, 6, {
      kind: "gas",
      gasSeeped: true,
      gasFadeIn: GAS_SEEPED_FADE_ACTIONS,
    });
    setCell(state, c + 2, 7, { kind: "dirt" });
    setCell(state, c + 3, 6, { kind: "gas" });
    setCell(state, c + 3, 5, { kind: "dirt" });
    setCell(state, c + 3, 7, { kind: "dirt" });
    setCell(state, c + 4, 6, { kind: "dirt" });
    const dug = applyAction(state, "right");
    expect(dug).toMatchObject({ ok: true, vented: 1 });
    expect(cellAt(state, c + 2, 6)?.kind).toBe("empty");
    expect(cellAt(state, c + 3, 6)?.kind).toBe("empty");
  });

  it("fades an orphaned wisp back to clear air", () => {
    const state = createMine(557, DEFAULT_GEAR, stock({}));
    const c = START_COL;
    state.miner.col = c;
    state.miner.row = 6;
    setCell(state, c - 1, 6, { kind: "empty" });
    setCell(state, c - 1, 7, { kind: "dirt" });
    setCell(state, c, 6, { kind: "empty" });
    setCell(state, c, 7, { kind: "dirt" });
    setCell(state, c + 1, 6, {
      kind: "gas",
      gasSeeped: true,
      gasFadeIn: 2,
    });
    applyAction(state, "left");
    expect(cellAt(state, c + 1, 6)?.kind).toBe("gas");
    applyAction(state, "right");
    expect(cellAt(state, c + 1, 6)?.kind).toBe("empty");
  });

  it("replays a gas leak identically from the same log", () => {
    const fixture = uncorkedGasState();
    fixture.miner.col = START_COL;
    fixture.miner.row = 0;
    // Shaft down to the gallery so the replay reaches the scenario.
    for (let row = 1; row <= 5; row++)
      setCell(fixture, START_COL, row, { kind: "dirt", hp: 1 });
    const diff = exportDiff(fixture);
    const actions: MineAction[] = [
      ...Array.from({ length: 6 }, () => "down" as const),
      "left",
      "right",
      "right",
      "left",
    ];
    const a = replayTrip(555, actions, DEFAULT_GEAR, stock({}), diff);
    const b = replayTrip(555, actions, DEFAULT_GEAR, stock({}), diff);
    expect(a.moves).toBe(actions.length);
    expect(b).toEqual(a);
  });
});
