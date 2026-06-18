import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_DEFINITIONS,
  achievementIdsUnlockedBy,
  buildAchievementViews,
  DEFAULT_ACHIEVEMENT_STATS,
  mergeAchievementStats,
} from "./achievements";

const baseSnapshot = {
  deepestDepth: 0,
  pickaxeLevel: 1,
  batteryLevel: 1,
  cargoLevel: 1,
  lanternLevel: 1,
  blastLevel: 1,
  warpcoilLevel: 1,
  elevatorDepth: 0,
  elevatorSpeedLevel: 1,
  stats: DEFAULT_ACHIEVEMENT_STATS,
};

describe("achievements", () => {
  it("keeps achievement ids unique", () => {
    const ids = ACHIEVEMENT_DEFINITIONS.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("unlocks depth and tool stamps from persistent records", () => {
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        deepestDepth: 24,
        pickaxeLevel: 2,
        elevatorDepth: 12,
      }),
    ).toEqual(
      expect.arrayContaining([
        "depth-first-chip",
        "depth-clay-boots",
        "depth-granite-nerves",
        "tool-better-pick",
        "tool-winch-builder",
      ]),
    );
  });

  it("merges lifetime counters and one-trip max values", () => {
    const first = mergeAchievementStats(DEFAULT_ACHIEVEMENT_STATS, {
      sales: 1,
      maxTripVibes: 25,
      laddersPlaced: 3,
    });
    expect(
      mergeAchievementStats(first, {
        sales: 1,
        maxTripVibes: 12,
        laddersPlaced: 7,
      }),
    ).toMatchObject({
      sales: 2,
      maxTripVibes: 25,
      laddersPlaced: 10,
    });
  });

  it("builds visible locked and collected stamp views", () => {
    const views = buildAchievementViews(
      { ...baseSnapshot, deepestDepth: 1 },
      new Map([["depth-first-chip", "2026-06-18T00:00:00.000Z"]]),
    );
    const first = views.find((view) => view.id === "depth-first-chip");
    const clay = views.find((view) => view.id === "depth-clay-boots");
    expect(first).toMatchObject({
      unlocked: true,
      progress: { current: 1, target: 1 },
    });
    expect(clay).toMatchObject({
      unlocked: false,
      progress: { current: 1, target: 12 },
    });
  });
});
