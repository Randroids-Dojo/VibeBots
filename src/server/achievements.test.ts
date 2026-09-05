import { describe, expect, it, vi } from "vitest";
import type { BunkerFootprint } from "@/sim/bunker";
import { bunkerSpawnPocketCells } from "@/sim/bunker-blocks";
import {
  applyAchievementProgress,
  refreshPlayerAchievements,
} from "./achievements";

import { matchAchievementCounters } from "./match-records";

vi.mock("./match-records", () => ({
  matchAchievementCounters: vi.fn(async () => ({
    matchWins: 0,
    sawMatchWins: 0,
    chassisFought: 0,
    ruleMatches: 0,
    pitMatches: 0,
  })),
}));

const FOOTPRINT: BunkerFootprint = { col: 1, row: 40, width: 7, height: 5 };
const POCKET = bunkerSpawnPocketCells(FOOTPRINT);

/** A dug cell outside the spawn pocket (depth beyond the pocket), so it
 * always reads as a real player dig regardless of the pocket size. */
function realDig(index: number) {
  return {
    col: FOOTPRINT.col + FOOTPRINT.width - 1,
    row: 41 + index,
    depth: 4,
  };
}

type DugCell = { col: number; row: number; depth: number };

/** Minimal sql mock for the achievement pipeline: a stored stats row,
 * the profile snapshot (with the durable bunkers.dug set and footprint),
 * and the unlock inserts. Captures every stats write for assertions. */
function makeAchievementSql({
  storedStats = {},
  dug = null,
  footprint = FOOTPRINT,
  priorUnlocks = [],
}: {
  storedStats?: Record<string, number>;
  dug?: DugCell[] | null;
  footprint?: BunkerFootprint | null;
  priorUnlocks?: string[];
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
            has_painted_design: false,
            bunker_dug: dug,
            bunker_footprint: dug === null ? null : footprint,
            mine_diff: [],
          },
        ];
      }
      if (query.includes("SELECT achievement_id, unlocked_at")) {
        return priorUnlocks.map((id) => ({
          achievement_id: id,
          unlocked_at: "2026-07-01T00:00:00.000Z",
        }));
      }
      if (query.includes("INSERT INTO player_achievements ")) {
        const id = String(values[1]);
        // ON CONFLICT DO NOTHING: an already-unlocked row inserts nothing.
        if (priorUnlocks.includes(id)) return [];
        return [{ achievement_id: id }];
      }
      return [];
    },
  );
  return { sql, statsWrites };
}

describe("First Orders (F-252)", () => {
  it("stamps from the records' rule count, never from bench state", async () => {
    const { sql, statsWrites } = makeAchievementSql({});
    // Nothing on the bench reaches this path; only the records counter
    // can move the stat, and a fight with a rule aboard moves it to 1.
    const none = await applyAchievementProgress(sql as never, "player-1", {});
    expect(none).not.toContain("battle-first-orders");
    vi.mocked(matchAchievementCounters).mockResolvedValueOnce({
      matchWins: 0,
      sawMatchWins: 0,
      chassisFought: 0,
      ruleMatches: 1,
      pitMatches: 0,
    });
    const stamped = await applyAchievementProgress(
      sql as never,
      "player-1",
      {},
    );
    expect(stamped).toContain("battle-first-orders");
    // The persisted stats carry only bench-side patches; the derived
    // counter lives in the records and is recomputed at snapshot time.
    expect(statsWrites.length).toBeGreaterThan(0);
  });
});

describe("Pit Fighter (arenas program)", () => {
  it("stamps from the records' arena count, never from bench state", async () => {
    const { sql } = makeAchievementSql({});
    vi.mocked(matchAchievementCounters).mockResolvedValueOnce({
      matchWins: 0,
      sawMatchWins: 0,
      chassisFought: 0,
      ruleMatches: 0,
      pitMatches: 1,
    });
    const stamped = await applyAchievementProgress(
      sql as never,
      "player-1",
      {},
    );
    expect(stamped).toContain("battle-pit-fighter");
  });
});

describe("Groundbreaker backfill", () => {
  it("counts no player digs for a fresh claim whose dug is only the spawn pocket", async () => {
    const { sql, statsWrites } = makeAchievementSql({ dug: [...POCKET] });

    const newStamps = await applyAchievementProgress(
      sql as never,
      "player-1",
      {},
    );

    // The authored pocket is not player behavior: no stamp, counter stays 0.
    expect(newStamps).not.toContain("bunker-groundbreaker");
    expect(statsWrites).toHaveLength(1);
    expect(statsWrites[0].bunkerCellsDug).toBe(0);
  });

  it("unlocks Groundbreaker on the first real dig outside the pocket", async () => {
    const { sql } = makeAchievementSql({ dug: [...POCKET, realDig(0)] });

    const refresh = await refreshPlayerAchievements(sql as never, "player-1");

    const groundbreaker = refresh.achievements.find(
      (achievement) => achievement.id === "bunker-groundbreaker",
    );
    expect(groundbreaker?.progress.current).toBe(1);
    expect(refresh.newlyUnlocked).toContain("bunker-groundbreaker");
  });

  it("counts only cells outside the pocket, once each", async () => {
    // The pocket plus three real digs reads as three, not pocket+3, and
    // is stable whether the same set arrives from a dig or a reload.
    const { sql } = makeAchievementSql({
      dug: [...POCKET, realDig(0), realDig(1), realDig(2)],
    });

    const refresh = await refreshPlayerAchievements(sql as never, "player-1");

    const groundbreaker = refresh.achievements.find(
      (achievement) => achievement.id === "bunker-groundbreaker",
    );
    expect(groundbreaker?.progress.current).toBe(3);
  });

  it("keeps a stamp already earned even when the durable dug is only the pocket", async () => {
    // An alpha profile that unlocked Groundbreaker under the old count
    // must not lose it: Math.max grandfathers the recorded stat, so the
    // pocket-exclusion never drops the counter below what it already was.
    const { sql } = makeAchievementSql({
      storedStats: { bunkerCellsDug: 1 },
      dug: [...POCKET],
      priorUnlocks: ["bunker-groundbreaker"],
    });

    const refresh = await refreshPlayerAchievements(sql as never, "player-1");

    const groundbreaker = refresh.achievements.find(
      (achievement) => achievement.id === "bunker-groundbreaker",
    );
    // The counter is grandfathered to 1 (not dropped to 0 by the pocket
    // exclusion), so the stamp stays unlocked and does not re-fire.
    expect(groundbreaker?.progress.current).toBe(1);
    expect(groundbreaker?.unlocked).toBe(true);
    expect(refresh.newlyUnlocked).not.toContain("bunker-groundbreaker");
  });

  it("falls back to the raw dug count when the row cannot prove its footprint", async () => {
    // Without a footprint the pocket cannot be located, so no cells are
    // subtracted (never a magic pocket size).
    const { sql } = makeAchievementSql({
      dug: [realDig(0), realDig(1)],
      footprint: null,
    });

    const refresh = await refreshPlayerAchievements(sql as never, "player-1");

    const groundbreaker = refresh.achievements.find(
      (achievement) => achievement.id === "bunker-groundbreaker",
    );
    expect(groundbreaker?.progress.current).toBe(2);
  });

  it("reports zero player digs when the player has no bunker", async () => {
    const { sql, statsWrites } = makeAchievementSql({ dug: null });

    const newStamps = await applyAchievementProgress(
      sql as never,
      "player-1",
      {},
    );

    expect(newStamps).not.toContain("bunker-groundbreaker");
    expect(statsWrites[0].bunkerCellsDug).toBe(0);
  });
});
