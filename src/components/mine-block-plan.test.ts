import { describe, expect, it } from "vitest";
import type { MineCell } from "@/sim/mine";
import {
  beginBlockPlan,
  createBlockInstancePlan,
  instancedBlockDraw,
  pushBlockInstance,
  solidCellJointDraw,
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

describe("solidCellJointDraw", () => {
  it("fills every occupied body class, including moving solids", () => {
    expect(solidCellJointDraw(cell({ kind: "dirt" }))).toBe(true);
    expect(solidCellJointDraw(cell({ kind: "ore", fallIn: 2 }))).toBe(true);
    expect(solidCellJointDraw(cell({ kind: "rock", fallen: true }))).toBe(true);
    expect(solidCellJointDraw(cell({ kind: "boulder" }))).toBe(true);
    expect(solidCellJointDraw(cell({ kind: "magma" }))).toBe(true);
    expect(solidCellJointDraw(cell({ kind: "part-cache" }))).toBe(true);
  });

  it("leaves empty tunnels and seeped gas open", () => {
    expect(solidCellJointDraw(cell({ kind: "empty" }))).toBe(false);
    expect(solidCellJointDraw(cell({ kind: "gas", gasSeeped: true }))).toBe(
      false,
    );
    expect(solidCellJointDraw(cell({ kind: "gas" }))).toBe(true);
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
