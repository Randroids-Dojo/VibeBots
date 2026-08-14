import { describe, expect, it } from "vitest";
import {
  type BotDesign,
  CPU_WHIRLIGIG_DESIGN,
  TEST_BOT_DESIGN,
  validateDesign,
} from "@/sim/design";
import {
  computeBalance,
  convexHull,
  type Point2,
  signedDistanceToHull,
} from "./bot-balance";

/** A bare chassis on two drive wheels, for comparing cores against cores. */
function twoWheeler(coreId: string): BotDesign {
  return {
    name: coreId,
    parts: [
      { iid: "core", partId: coreId },
      { iid: "wheel-l", partId: "drive-wheel" },
      { iid: "wheel-r", partId: "drive-wheel" },
    ],
    connections: [
      {
        parentIid: "core",
        parentConnector: "axle-left",
        childIid: "wheel-l",
        childConnector: "hub",
      },
      {
        parentIid: "core",
        parentConnector: "axle-right",
        childIid: "wheel-r",
        childConnector: "hub",
      },
    ],
  };
}

describe("convexHull", () => {
  it("wraps scattered points and drops interior ones", () => {
    const hull = convexHull([
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 2 },
      { x: 0, z: 2 },
      { x: 1, z: 1 },
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual({ x: 1, z: 1 });
  });

  it("collapses duplicate and collinear input to a degenerate footprint", () => {
    expect(
      convexHull([
        { x: 1, z: 1 },
        { x: 1, z: 1 },
      ]),
    ).toEqual([{ x: 1, z: 1 }]);
    const line = convexHull([
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 2, z: 0 },
    ]);
    expect(line.length).toBeLessThan(3);
  });

  it("returns an empty hull for no points", () => {
    expect(convexHull([])).toEqual([]);
  });
});

describe("signedDistanceToHull", () => {
  const square: Point2[] = [
    { x: -1, z: -1 },
    { x: 1, z: -1 },
    { x: 1, z: 1 },
    { x: -1, z: 1 },
  ];

  it("is positive inside and measures the nearest edge", () => {
    expect(signedDistanceToHull({ x: 0, z: 0 }, square)).toBeCloseTo(1, 6);
    expect(signedDistanceToHull({ x: 0.5, z: 0 }, square)).toBeCloseTo(0.5, 6);
  });

  it("is negative outside", () => {
    expect(signedDistanceToHull({ x: 2, z: 0 }, square)).toBeCloseTo(-1, 6);
  });

  it("is never positive for a degenerate footprint", () => {
    const line: Point2[] = [
      { x: -1, z: 0 },
      { x: 1, z: 0 },
    ];
    expect(signedDistanceToHull({ x: 0, z: 0 }, line)).toBeLessThanOrEqual(0);
    expect(signedDistanceToHull({ x: 0, z: 0 }, [])).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });
});

describe("computeBalance", () => {
  it("agrees with the design stats on total mass", () => {
    const validation = validateDesign(TEST_BOT_DESIGN);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(computeBalance(TEST_BOT_DESIGN).totalMass).toBeCloseTo(
      validation.stats.totalMass,
      6,
    );
  });

  it("puts a symmetric bot's mass on the centreline, over its footprint", () => {
    const balance = computeBalance(twoWheeler("core-cube"));
    expect(balance.centerOfMass.x).toBeCloseTo(0, 6);
    expect(balance.centerOfMass.z).toBeCloseTo(0, 6);
    expect(balance.balanced).toBe(true);
    expect(balance.stabilityMargin).toBeGreaterThan(0);
    expect(balance.support.length).toBeGreaterThanOrEqual(3);
  });

  it("shifts the centre of mass toward an added heavy part", () => {
    const bare = twoWheeler("core-cube");
    // The hammer head is the densest part in the catalog; hang it off one
    // side and the mass must follow it.
    const lopsided: BotDesign = {
      ...bare,
      parts: [...bare.parts, { iid: "weight", partId: "hammer-head" }],
      connections: [
        ...bare.connections,
        {
          parentIid: "core",
          parentConnector: "top",
          childIid: "weight",
          childConnector: "mount",
        },
      ],
    };
    const before = computeBalance(bare);
    const after = computeBalance(lopsided);
    expect(after.totalMass).toBeGreaterThan(before.totalMass);
    // Mounted on top, so the mass rises.
    expect(after.centerOfMass.y).toBeGreaterThan(before.centerOfMass.y);
    expect(after.centerOfMassHeight).toBeGreaterThan(before.centerOfMassHeight);
  });

  it("reports the tall chassis as tippier than the low one", () => {
    // The archetype difference the cores exist to express: the tower rides
    // high and goes over sooner, the wedge is low and wide and does not.
    const wedge = computeBalance(twoWheeler("wedge-core"));
    const cube = computeBalance(twoWheeler("core-cube"));
    const tower = computeBalance(twoWheeler("tower-core"));

    expect(tower.centerOfMassHeight).toBeGreaterThan(wedge.centerOfMassHeight);
    expect(tower.tipOverDegrees).toBeLessThan(cube.tipOverDegrees);
    expect(cube.tipOverDegrees).toBeLessThan(wedge.tipOverDegrees);
    for (const balance of [wedge, cube, tower]) {
      expect(balance.tipOverDegrees).toBeGreaterThan(0);
      expect(balance.tipOverDegrees).toBeLessThan(90);
    }
  });

  it("counts a nose weapon into the footprint it can settle onto", () => {
    // The saw sits low on the nose, so it both moves mass forward and
    // extends the shape the bot can fall onto.
    const balance = computeBalance(CPU_WHIRLIGIG_DESIGN);
    expect(balance.centerOfMass.z).toBeLessThan(0);
    expect(balance.supportingIids).toContain("blade");
    expect(balance.balanced).toBe(true);
  });

  it("names every footprint part in design order", () => {
    const balance = computeBalance(TEST_BOT_DESIGN);
    const designOrder = TEST_BOT_DESIGN.parts.map((part) => part.iid);
    const positions = balance.supportingIids.map((iid) =>
      designOrder.indexOf(iid),
    );
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(balance.supportingIids).toContain("wheel-l");
    expect(balance.supportingIids).toContain("wheel-r");
  });

  it("handles a design with no resolvable parts without throwing", () => {
    const balance = computeBalance({
      name: "empty",
      parts: [{ iid: "ghost", partId: "does-not-exist" }],
      connections: [],
    });
    expect(balance.totalMass).toBe(0);
    expect(balance.support).toEqual([]);
    expect(balance.balanced).toBe(false);
    expect(balance.tipOverDegrees).toBe(0);
  });
});
