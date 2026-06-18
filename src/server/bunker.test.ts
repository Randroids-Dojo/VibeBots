import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAchievementProgress } from "./achievements";
import { finishBunkerRaid } from "./bunker";

vi.mock("./achievements", () => ({
  applyAchievementProgress: vi.fn(async () => {}),
}));

describe("bunker server helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(applyAchievementProgress).mockClear();
  });

  it("does not pay a raid reward when the finish row was already claimed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T00:05:00.000Z"));
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT raid_id, snapshot")) {
        return [
          {
            raid_id: "raid-1",
            started_at: "2026-06-18T00:00:00.000Z",
            duration_seconds: 180,
            snapshot: {
              raidId: "raid-1",
              tier: 1,
              durationSeconds: 180,
              clankers: [],
              totalPartDurability: 180,
              incomingDamage: 100,
              breached: false,
              survived: true,
              reward: { vibes: 30, defenseXp: 60 },
            },
          },
        ];
      }
      if (query.includes("UPDATE bunker_raids")) return [];
      if (query.includes("UPDATE players")) {
        throw new Error("reward should not be paid");
      }
      return [];
    });

    const result = await finishBunkerRaid(sql as never, "player-1");

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "raid already finished",
    });
  });

  it("reports defense XP, level-up rewards, and the first defense stamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T00:05:00.000Z"));
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT raid_id, snapshot")) {
        return [
          {
            raid_id: "raid-1",
            started_at: "2026-06-18T00:00:00.000Z",
            duration_seconds: 180,
            snapshot: {
              raidId: "raid-1",
              tier: 1,
              durationSeconds: 180,
              clankers: [],
              totalPartDurability: 180,
              incomingDamage: 100,
              breached: false,
              survived: true,
              reward: { vibes: 30, defenseXp: 60 },
            },
          },
        ];
      }
      if (query.includes("UPDATE bunker_raids")) return [{ raid_id: "raid-1" }];
      if (query.includes("SELECT track_xp, defense_xp")) {
        return [{ track_xp: 0, defense_xp: 60 }];
      }
      if (query.includes("SELECT achievement_id")) return [];
      if (query.includes("UPDATE players")) return [{ defense_xp: 120 }];
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 30, track_xp: 0, defense_xp: 120 }];
      }
      if (query.includes("SELECT footprint, core, parts")) return [];
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      return [];
    });

    const result = await finishBunkerRaid(sql as never, "player-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reward).toEqual({
      survived: true,
      vibesGained: 30,
      xpGained: 60,
      defenseXpBefore: 60,
      defenseXpAfter: 120,
      levelBefore: 1,
      levelAfter: 2,
      leveledUp: true,
      beaconLimitBefore: 2,
      beaconLimitAfter: 3,
      stampAwarded: true,
    });
    expect(applyAchievementProgress).toHaveBeenCalledWith(sql, "player-1", {
      bunkerRaidsSurvived: 1,
    });
  });
});
