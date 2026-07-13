import { describe, expect, it, vi } from "vitest";
import {
  applyAchievementProgress,
  refreshPlayerAchievements,
} from "./achievements";

vi.mock("./match-records", () => ({
  matchAchievementCounters: vi.fn(async () => ({
    matchWins: 0,
    sawMatchWins: 0,
    chassisFought: 0,
  })),
}));

/** Minimal sql mock for the achievement pipeline: a stored stats row,
 * the profile snapshot (with a durable bunkers.dug count), and the
 * unlock inserts. Captures every stats write for assertions. */
function makeAchievementSql({
  storedStats = {},
  durableBunkerCellsDug = 0,
}: {
  storedStats?: Record<string, number>;
  durableBunkerCellsDug?: number;
}) {
  const statsWrites: Array<Record<string, number>> = [];
  const sql = vi.fn(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join(" ");
      if (query.includes("SELECT stats FROM player_achievement_stats")) {
        return [{ stats: storedStats }];
      }
      if (query.includes("INSERT INTO player_achievement_stats")) {
        statsWrites.push(JSON.parse(String(values[1])));
        return [];
      }
      if (query.includes("SELECT p.deepest_depth")) {
        return [
          {
            deepest_depth: 0,
            emeralds: 0,
            pickaxe_level: 1,
            lamp_level: 1,
            cargo_level: 1,
            lantern_level: 1,
            blast_level: 1,
            warpcoil_level: 1,
            elevator_depth: 0,
            elevator_speed_level: 1,
            parts_owned: 0,
            has_maxed_design: false,
            bunker_cells_dug: durableBunkerCellsDug,
            mine_diff: [],
          },
        ];
      }
      if (query.includes("SELECT achievement_id, unlocked_at")) return [];
      if (query.includes("INSERT INTO player_achievements ")) {
        return [{ achievement_id: String(values[1]) }];
      }
      return [];
    },
  );
  return { sql, statsWrites };
}

describe("Groundbreaker backfill", () => {
  it("unlocks from the durable dug count on an empty patch, without incrementing the stat", async () => {
    const { sql, statsWrites } = makeAchievementSql({
      durableBunkerCellsDug: 1,
    });

    const newStamps = await applyAchievementProgress(
      sql as never,
      "player-1",
      {},
    );

    expect(newStamps).toContain("bunker-groundbreaker");
    // The persisted counter stays untouched; the metric lives in the
    // durable bunkers.dug record, backfilled at snapshot time.
    expect(statsWrites).toHaveLength(1);
    expect(statsWrites[0].bunkerCellsDug).toBe(0);
  });

  it("counts each dug cell exactly once across dig-then-claim flows", async () => {
    // Three cells dug, then the claim banks the same three: neither
    // flow patches the counter, so the metric equals the durable dug
    // count (3), never a double-counted 6.
    const { sql } = makeAchievementSql({ durableBunkerCellsDug: 3 });

    const refresh = await refreshPlayerAchievements(sql as never, "player-1");

    const groundbreaker = refresh.achievements.find(
      (achievement) => achievement.id === "bunker-groundbreaker",
    );
    expect(groundbreaker?.progress.current).toBe(3);
    expect(refresh.newlyUnlocked).toContain("bunker-groundbreaker");
  });
});
