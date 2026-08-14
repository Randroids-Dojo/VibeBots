import { describe, expect, it } from "vitest";
import { computeBalance } from "@/sim/balance";
import type { BotDesign } from "@/sim/design";
import { isTippy, TIPPY_DEGREES, tipOverDegrees } from "./bot-balance";

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

describe("tipOverDegrees", () => {
  it("reports the tall chassis as tippier than the low one", () => {
    // The archetype difference the three cores exist to express: the tower
    // rides high and goes over sooner, the wedge is low and wide.
    const wedge = tipOverDegrees(computeBalance(twoWheeler("wedge-core")));
    const cube = tipOverDegrees(computeBalance(twoWheeler("core-cube")));
    const tower = tipOverDegrees(computeBalance(twoWheeler("tower-core")));

    expect(tower).toBeLessThan(cube);
    expect(cube).toBeLessThan(wedge);
    for (const lean of [wedge, cube, tower]) {
      expect(lean).toBeGreaterThan(0);
      expect(lean).toBeLessThan(90);
    }
  });

  it("is zero when nothing holds the bot up", () => {
    expect(
      tipOverDegrees({
        totalMass: 1,
        centerOfMass: { x: 0, y: 1, z: 0 },
        centerOfMassHeight: 1,
        support: [],
        supportingIids: [],
        stabilityMargin: -1,
        balanced: false,
      }),
    ).toBe(0);
    expect(
      tipOverDegrees({
        totalMass: 1,
        centerOfMass: { x: 0, y: 0, z: 0 },
        centerOfMassHeight: 0,
        support: [],
        supportingIids: [],
        stabilityMargin: 1,
        balanced: true,
      }),
    ).toBe(0);
  });
});

describe("isTippy", () => {
  it("is false for a bot that leans well past the threshold", () => {
    const wedge = computeBalance(twoWheeler("wedge-core"));
    expect(tipOverDegrees(wedge)).toBeGreaterThan(TIPPY_DEGREES);
    expect(isTippy(wedge)).toBe(false);
  });

  it("is false for a bot that does not stand at all", () => {
    // Unbalanced is a worse problem than tippy, and is reported separately.
    const unbalanced = {
      totalMass: 1,
      centerOfMass: { x: 0, y: 1, z: 0 },
      centerOfMassHeight: 1,
      support: [],
      supportingIids: [],
      stabilityMargin: -0.5,
      balanced: false,
    };
    expect(isTippy(unbalanced)).toBe(false);
  });
});
