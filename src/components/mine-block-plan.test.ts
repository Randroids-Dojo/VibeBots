import { describe, expect, it } from "vitest";
import type { MineCell } from "@/sim/mine";
import {
  beginBlockPlan,
  CELL_JOINT_BELOW,
  CELL_JOINT_CORNER,
  CELL_JOINT_RIGHT,
  createBlockInstancePlan,
  instancedBlockDraw,
  pushBlockInstance,
  solidCellJointMask,
  solidCellJointOccupies,
} from "./mine-block-plan";

// The geometry/material references are opaque to the plan (it only stores
// and forwards them), so stand-ins are enough to exercise the pooling.
// biome-ignore lint/suspicious/noExplicitAny: opaque three handles under test
const GEO = { id: "geo" } as any;
// biome-ignore lint/suspicious/noExplicitAny: opaque three handles under test
const MAT = { id: "mat" } as any;

function cell(
  partial: Partial<MineCell> & { kind: MineCell["kind"] },
): MineCell {
  return partial as MineCell;
}

describe("instancedBlockDraw", () => {
  it("streams the static solid bodies", () => {
    expect(instancedBlockDraw(cell({ kind: "dirt" }))).toBe(true);
    expect(instancedBlockDraw(cell({ kind: "rock" }))).toBe(true);
    expect(instancedBlockDraw(cell({ kind: "metal" }))).toBe(true);
    expect(instancedBlockDraw(cell({ kind: "ore", ore: "coal" }))).toBe(true);
  });

  it("leaves teetering and fallen blocks to React (they wobble)", () => {
    expect(instancedBlockDraw(cell({ kind: "dirt", fallIn: 3 }))).toBe(false);
    expect(instancedBlockDraw(cell({ kind: "rock", fallIn: 1 }))).toBe(false);
    expect(instancedBlockDraw(cell({ kind: "rock", fallen: true }))).toBe(
      false,
    );
    expect(
      instancedBlockDraw(cell({ kind: "ore", ore: "coal", fallIn: 2 })),
    ).toBe(false);
  });

  it("leaves the inline-material kinds and empty tunnels to React", () => {
    expect(instancedBlockDraw(cell({ kind: "boulder" }))).toBe(false);
    expect(instancedBlockDraw(cell({ kind: "gas" }))).toBe(false);
    expect(instancedBlockDraw(cell({ kind: "magma" }))).toBe(false);
    expect(instancedBlockDraw(cell({ kind: "part-cache" }))).toBe(false);
    expect(instancedBlockDraw(cell({ kind: "empty" }))).toBe(false);
  });

  it("treats an ore cell with no ore id as not instanced", () => {
    expect(instancedBlockDraw(cell({ kind: "ore" }))).toBe(false);
  });
});

describe("solid cell joint adjacency", () => {
  it("classifies occupied bodies without treating open haze as solid", () => {
    expect(solidCellJointOccupies(cell({ kind: "dirt" }))).toBe(true);
    expect(solidCellJointOccupies(cell({ kind: "ore", fallIn: 2 }))).toBe(true);
    expect(solidCellJointOccupies(cell({ kind: "rock", fallen: true }))).toBe(
      true,
    );
    expect(solidCellJointOccupies(cell({ kind: "boulder" }))).toBe(true);
    expect(solidCellJointOccupies(cell({ kind: "magma" }))).toBe(true);
    expect(solidCellJointOccupies(cell({ kind: "part-cache" }))).toBe(true);
    expect(solidCellJointOccupies(cell({ kind: "empty" }))).toBe(false);
    expect(solidCellJointOccupies(cell({ kind: "gas", gasSeeped: true }))).toBe(
      false,
    );
    expect(solidCellJointOccupies(cell({ kind: "gas" }))).toBe(true);
    expect(solidCellJointOccupies(undefined)).toBe(false);
  });

  it("draws only shared edges and fully enclosed corners", () => {
    const dirt = cell({ kind: "dirt" });
    const empty = cell({ kind: "empty" });
    expect(solidCellJointMask(dirt, empty, empty, empty)).toBe(0);
    expect(solidCellJointMask(dirt, dirt, empty, empty)).toBe(CELL_JOINT_RIGHT);
    expect(solidCellJointMask(dirt, empty, dirt, empty)).toBe(CELL_JOINT_BELOW);
    expect(solidCellJointMask(dirt, dirt, dirt, empty)).toBe(
      CELL_JOINT_RIGHT | CELL_JOINT_BELOW,
    );
    expect(solidCellJointMask(dirt, dirt, dirt, dirt)).toBe(
      CELL_JOINT_RIGHT | CELL_JOINT_BELOW | CELL_JOINT_CORNER,
    );
  });

  it("never puts a bridge behind an empty center cell", () => {
    const dirt = cell({ kind: "dirt" });
    expect(solidCellJointMask(cell({ kind: "empty" }), dirt, dirt, dirt)).toBe(
      0,
    );
  });
});

describe("block instance plan", () => {
  it("starts empty", () => {
    const plan = createBlockInstancePlan();
    expect(plan.count).toBe(0);
    expect(plan.items).toHaveLength(0);
  });

  it("records instances and flags rotation only when non-zero", () => {
    const plan = createBlockInstancePlan();
    pushBlockInstance(plan, GEO, MAT, 4, -7, 0, 0, 0);
    pushBlockInstance(plan, GEO, MAT, 5, -7, 0.3, 0.1, 0.2);
    expect(plan.count).toBe(2);
    expect(plan.items[0]).toMatchObject({ x: 4, y: -7, rotated: false });
    expect(plan.items[1]).toMatchObject({ x: 5, y: -7, rotated: true });
    expect(plan.items[1].rotX).toBeCloseTo(0.3);
  });

  it("reuses pooled entries across ticks instead of allocating", () => {
    const plan = createBlockInstancePlan();
    pushBlockInstance(plan, GEO, MAT, 1, -1, 0, 0, 0);
    pushBlockInstance(plan, GEO, MAT, 2, -1, 0, 0, 0);
    const firstEntry = plan.items[0];
    const secondEntry = plan.items[1];

    beginBlockPlan(plan);
    expect(plan.count).toBe(0);
    // The backing entries survive the reset for reuse.
    expect(plan.items).toHaveLength(2);

    pushBlockInstance(plan, GEO, MAT, 9, -3, 0, 0, 0);
    // Same object reused, not a fresh allocation.
    expect(plan.items[0]).toBe(firstEntry);
    expect(plan.items[0]).toMatchObject({ x: 9, y: -3 });
    // The stale second entry is still parked for the next push.
    expect(plan.items[1]).toBe(secondEntry);
    expect(plan.count).toBe(1);
  });

  it("clears a previously-set rotation flag when reused axis-aligned", () => {
    const plan = createBlockInstancePlan();
    pushBlockInstance(plan, GEO, MAT, 0, 0, 1, 0, 0);
    expect(plan.items[0].rotated).toBe(true);
    beginBlockPlan(plan);
    pushBlockInstance(plan, GEO, MAT, 0, 0, 0, 0, 0);
    expect(plan.items[0].rotated).toBe(false);
  });
});
