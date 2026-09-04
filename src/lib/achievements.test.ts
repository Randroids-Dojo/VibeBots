import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENT_DEFINITIONS,
  achievementIdsUnlockedBy,
  achievementMetricValue,
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

  it("unlocks Groundbreaker from the first excavated claim-rock cell", () => {
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        stats: { ...DEFAULT_ACHIEVEMENT_STATS, bunkerCellsDug: 1 },
      }),
    ).toContain("bunker-groundbreaker");
    expect(achievementIdsUnlockedBy(baseSnapshot)).not.toContain(
      "bunker-groundbreaker",
    );
  });

  it("merges bunkerCellsDug additively like other lifetime counters", () => {
    const merged = mergeAchievementStats(
      { ...DEFAULT_ACHIEVEMENT_STATS, bunkerCellsDug: 3 },
      { bunkerCellsDug: 2 },
    );
    expect(merged.bunkerCellsDug).toBe(5);
    expect(
      mergeAchievementStats(DEFAULT_ACHIEVEMENT_STATS, {}).bunkerCellsDug,
    ).toBe(0);
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

  it("stamps First Orders after the first verified fight with a rule, and merges it as a high-water mark (F-252)", () => {
    expect(achievementIdsUnlockedBy(baseSnapshot)).not.toContain(
      "battle-first-orders",
    );
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        stats: { ...DEFAULT_ACHIEVEMENT_STATS, ruleMatches: 1 },
      }),
    ).toContain("battle-first-orders");
    // The counter is derived from the records at snapshot time, so a
    // patch of zero cannot take an earned stamp back.
    expect(
      mergeAchievementStats(
        { ...DEFAULT_ACHIEVEMENT_STATS, ruleMatches: 1 },
        { ruleMatches: 0 },
      ).ruleMatches,
    ).toBe(1);
  });

  it("no longer has a merge-level stamp (F-230)", () => {
    expect(
      ACHIEVEMENT_DEFINITIONS.find(
        (definition) => definition.id === "tools-mastercrafted",
      ),
    ).toBeUndefined();
  });

  it("merges derived mastery levels by high water, not by sum", () => {
    const merged = mergeAchievementStats(
      { ...DEFAULT_ACHIEVEMENT_STATS, chassisFought: 2 },
      { chassisFought: 2 },
    );
    expect(merged.chassisFought).toBe(2);
  });

  it("merges designsPainted by high water and resolves Custom Job through the metric (G5)", () => {
    // Derived from the saved designs, so two snapshots that each saw one
    // painted design still mean one, not two.
    expect(
      mergeAchievementStats(
        { ...DEFAULT_ACHIEVEMENT_STATS, designsPainted: 1 },
        { designsPainted: 1 },
      ).designsPainted,
    ).toBe(1);
    expect(
      mergeAchievementStats(
        { ...DEFAULT_ACHIEVEMENT_STATS, designsPainted: 0 },
        { designsPainted: 1 },
      ).designsPainted,
    ).toBe(1);
    expect(
      mergeAchievementStats(
        { ...DEFAULT_ACHIEVEMENT_STATS, designsPainted: 2 },
        {},
      ).designsPainted,
    ).toBe(2);
    const painted = {
      ...baseSnapshot,
      stats: { ...DEFAULT_ACHIEVEMENT_STATS, designsPainted: 1 },
    };
    expect(achievementMetricValue(baseSnapshot, "designsPainted")).toBe(0);
    expect(achievementMetricValue(painted, "designsPainted")).toBe(1);
    expect(
      ACHIEVEMENT_DEFINITIONS.find(
        (definition) => definition.id === "tools-custom-job",
      ),
    ).toMatchObject({ metric: "designsPainted", target: 1 });
    expect(achievementIdsUnlockedBy(baseSnapshot)).not.toContain(
      "tools-custom-job",
    );
    expect(achievementIdsUnlockedBy(painted)).toContain("tools-custom-job");
  });

  it("unlocks depth and tool stamps from persistent records", () => {
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        deepestDepth: 24,
        pickaxeLevel: 2,
        elevatorDepth: 1,
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

  it("unlocks Winch Builder on the first one-row elevator rail", () => {
    expect(
      ACHIEVEMENT_DEFINITIONS.find(
        (definition) => definition.id === "tool-winch-builder",
      ),
    ).toMatchObject({
      description: "Buy the first elevator rail.",
      metric: "elevatorDepth",
      target: 1,
    });
    expect(achievementIdsUnlockedBy(baseSnapshot)).not.toContain(
      "tool-winch-builder",
    );
    expect(
      achievementIdsUnlockedBy({ ...baseSnapshot, elevatorDepth: 1 }),
    ).toContain("tool-winch-builder");
  });

  it("unlocks Ride the Rail after one completed elevator journey", () => {
    expect(
      ACHIEVEMENT_DEFINITIONS.find(
        (definition) => definition.id === "survival-ride-rail",
      ),
    ).toMatchObject({
      description: "Take an elevator ride.",
      metric: "elevatorRides",
      target: 1,
    });
    expect(achievementIdsUnlockedBy(baseSnapshot)).not.toContain(
      "survival-ride-rail",
    );
    expect(
      achievementIdsUnlockedBy({
        ...baseSnapshot,
        stats: { ...DEFAULT_ACHIEVEMENT_STATS, elevatorRides: 1 },
      }),
    ).toContain("survival-ride-rail");
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
