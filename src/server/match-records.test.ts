import { describe, expect, it } from "vitest";
import { matchAchievementCounters } from "./match-records";

type SqlRows = Array<Record<string, unknown>>;

/** Tagged-template stub returning one canned totals row. */
function sqlReturning(row: Record<string, unknown>) {
  return (async () => [row] as SqlRows) as unknown as Parameters<
    typeof matchAchievementCounters
  >[0];
}

describe("matchAchievementCounters", () => {
  it("counts distinct chassis with at least one fight each", async () => {
    const counters = await matchAchievementCounters(
      sqlReturning({
        match_wins: 4,
        saw_match_wins: 1,
        cube_fights: 7,
        wedge_fights: 0,
        tower_fights: 2,
      }),
      "player-1",
    );
    expect(counters).toEqual({
      matchWins: 4,
      sawMatchWins: 1,
      chassisFought: 2,
    });
  });

  it("reports zero chassis for a player with no matches", async () => {
    const counters = await matchAchievementCounters(
      sqlReturning({
        match_wins: 0,
        saw_match_wins: 0,
        cube_fights: 0,
        wedge_fights: 0,
        tower_fights: 0,
      }),
      "player-1",
    );
    expect(counters.chassisFought).toBe(0);
  });
});
