import { describe, expect, it } from "vitest";
import {
  batteryLowThreshold,
  batteryWarnThreshold,
  computeReadiness,
  type MineReadinessInput,
} from "./mine-readiness";

const BASE: MineReadinessInput = {
  depth: 10,
  energy: 60,
  maxEnergy: 60,
  climbCost: 10,
  routeReachable: true,
  laddersNeeded: 2,
  laddersCarried: 5,
};

const at = (overrides: Partial<MineReadinessInput> = {}) =>
  computeReadiness({ ...BASE, ...overrides });

describe("computeReadiness", () => {
  it("treats the surface as safe no matter what the estimate says", () => {
    const readiness = at({
      depth: 0,
      energy: 0,
      routeReachable: false,
      laddersNeeded: 9,
      laddersCarried: 0,
    });
    expect(readiness.routeState).toBe("surface");
    expect(readiness.level).toBe("surface");
    expect(readiness.batteryLow).toBe(false);
    expect(readiness.ladderShort).toBe(false);
    expect(readiness.routeBlocked).toBe(false);
  });

  it("reports a clear route when charge and ladders both cover the climb", () => {
    const readiness = at();
    expect(readiness.routeState).toBe("clear");
    expect(readiness.level).toBe("clear");
    expect(readiness.ladderShortfall).toBe(0);
  });

  it("warns before the trip home is actually at risk", () => {
    // Between the two thresholds: still enough to climb out, but the
    // player should start heading back.
    const climbCost = 10;
    const energy =
      (batteryLowThreshold(climbCost) + batteryWarnThreshold(climbCost)) / 2;
    const readiness = at({ climbCost, energy });
    expect(readiness.batteryLow).toBe(false);
    expect(readiness.level).toBe("warn");
    expect(readiness.routeState).toBe("clear");
  });

  it("keeps the shipped battery-low threshold exactly", () => {
    const climbCost = 10;
    const threshold = batteryLowThreshold(climbCost);
    expect(threshold).toBe(10 * 1.25 + 2);
    expect(at({ climbCost, energy: threshold - 0.01 }).batteryLow).toBe(true);
    expect(at({ climbCost, energy: threshold }).batteryLow).toBe(false);
  });

  it("flags a ladder shortfall and counts the missing ladders", () => {
    const readiness = at({ laddersNeeded: 4, laddersCarried: 1 });
    expect(readiness.ladderShort).toBe(true);
    expect(readiness.ladderShortfall).toBe(3);
    expect(readiness.routeState).toBe("short");
    expect(readiness.level).toBe("danger");
  });

  it("never reports a negative shortfall when the player is overstocked", () => {
    expect(at({ laddersNeeded: 1, laddersCarried: 9 }).ladderShortfall).toBe(0);
  });

  it("reports a blocked route ahead of a ladder shortfall", () => {
    const readiness = at({
      routeReachable: false,
      laddersNeeded: 4,
      laddersCarried: 0,
    });
    expect(readiness.routeBlocked).toBe(true);
    expect(readiness.routeState).toBe("blocked");
    // An unreachable route means the ladder count is not the real problem.
    expect(readiness.ladderShort).toBe(false);
    expect(readiness.level).toBe("danger");
  });

  it("places the reserve tick at the climb cost share of the battery", () => {
    const readiness = at({ energy: 30, maxEnergy: 60, climbCost: 15 });
    expect(readiness.chargeFraction).toBeCloseTo(0.5);
    expect(readiness.reserveFraction).toBeCloseTo(0.25);
  });

  it("clamps both fractions into 0..1", () => {
    const over = at({ energy: 999, maxEnergy: 60, climbCost: 999 });
    expect(over.chargeFraction).toBe(1);
    expect(over.reserveFraction).toBe(1);
    const under = at({ energy: -5, climbCost: -5 });
    expect(under.chargeFraction).toBe(0);
    expect(under.reserveFraction).toBe(0);
  });

  it("yields 0 rather than NaN if the battery capacity is ever zero", () => {
    const readiness = at({ energy: 0, maxEnergy: 0, climbCost: 0 });
    expect(readiness.chargeFraction).toBe(0);
    expect(readiness.reserveFraction).toBe(0);
  });

  it("escalates a warn to danger once charge crosses the reserve", () => {
    const climbCost = 12;
    const warn = at({ climbCost, energy: batteryWarnThreshold(climbCost) - 1 });
    const danger = at({
      climbCost,
      energy: batteryLowThreshold(climbCost) - 1,
    });
    expect(warn.level).toBe("warn");
    expect(danger.level).toBe("danger");
  });
});
