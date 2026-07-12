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
  activeBiomePortals: 0,
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
    const stamps = ACHIEVEMENT_DEFINITIONS.map(
      (definition) => definition.stamp,
    );
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it("unlocks Buttoned Up from a sealed raid survival, not a plain one", () => {
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        stats: { ...DEFAULT_ACHIEVEMENT_STATS, bunkerRaidsSurvived: 3 },
      }),
    ).not.toContain("survival-buttoned-up");
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        stats: { ...DEFAULT_ACHIEVEMENT_STATS, raidsSurvivedSealed: 1 },
      }),
    ).toContain("survival-buttoned-up");
  });

  it("merges bunkerSkinsBought additively like other lifetime counters", () => {
    const merged = mergeAchievementStats(
      { ...DEFAULT_ACHIEVEMENT_STATS, bunkerSkinsBought: 1 },
      { bunkerSkinsBought: 1 },
    );
    expect(merged.bunkerSkinsBought).toBe(2);
    expect(
      mergeAchievementStats(DEFAULT_ACHIEVEMENT_STATS, {}).bunkerSkinsBought,
    ).toBe(0);
  });

  it("unlocks Fresh Coat from a paid skin purchase", () => {
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        stats: { ...DEFAULT_ACHIEVEMENT_STATS, bunkerSkinsBought: 1 },
      }),
    ).toContain("tools-fresh-coat");
    expect(achievementIdsUnlockedBy(baseSnapshot)).not.toContain(
      "tools-fresh-coat",
    );
  });

  it("unlocks the roof-rescue and collapse-survival stamps from trip counters", () => {
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        stats: { ...DEFAULT_ACHIEVEMENT_STATS, roofRescues: 1 },
      }),
    ).toContain("survival-roof-rescue");
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        stats: { ...DEFAULT_ACHIEVEMENT_STATS, collapsesSurvived: 1 },
      }),
    ).toContain("survival-walked-away");
    // A plain recovery (the old Close Call) proves neither.
    const recovered = achievementIdsUnlockedBy({
      ...baseSnapshot,
      stats: { ...DEFAULT_ACHIEVEMENT_STATS, recoveries: 2 },
    });
    expect(recovered).not.toContain("survival-roof-rescue");
    expect(recovered).not.toContain("survival-walked-away");
  });

  it("unlocks Chassis Tour only after all three cores have fought", () => {
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        stats: { ...DEFAULT_ACHIEVEMENT_STATS, chassisFought: 2 },
      }),
    ).not.toContain("battle-chassis-tour");
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        stats: { ...DEFAULT_ACHIEVEMENT_STATS, chassisFought: 3 },
      }),
    ).toContain("battle-chassis-tour");
  });

  it("unlocks Mastercrafted from a maxed-part design record", () => {
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        stats: { ...DEFAULT_ACHIEVEMENT_STATS, partsMaxed: 1 },
      }),
    ).toContain("tools-mastercrafted");
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        stats: { ...DEFAULT_ACHIEVEMENT_STATS, matchWins: 5 },
      }),
    ).not.toContain("tools-mastercrafted");
  });

  it("merges derived mastery levels by high water, not by sum", () => {
    const merged = mergeAchievementStats(
      { ...DEFAULT_ACHIEVEMENT_STATS, chassisFought: 2, partsMaxed: 1 },
      { chassisFought: 2, partsMaxed: 1 },
    );
    expect(merged.chassisFought).toBe(2);
    expect(merged.partsMaxed).toBe(1);
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

  it("unlocks biome portal stamps from durable portal counts", () => {
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        activeBiomePortals: 2,
      }),
    ).toEqual(
      expect.arrayContaining(["depth-biome-scout", "depth-portal-network"]),
    );
  });

  it("merges lifetime counters and one-trip max values", () => {
    const first = mergeAchievementStats(DEFAULT_ACHIEVEMENT_STATS, {
      sales: 1,
      maxTripVibes: 25,
      bagDrops: 1,
      laddersPlaced: 3,
    });
    expect(
      mergeAchievementStats(first, {
        sales: 1,
        maxTripVibes: 12,
        bagDrops: 4,
        laddersPlaced: 7,
      }),
    ).toMatchObject({
      sales: 2,
      maxTripVibes: 25,
      bagDrops: 5,
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
