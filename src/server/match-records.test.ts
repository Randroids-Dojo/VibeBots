import { describe, expect, it } from "vitest";
import { matchAchievementCounters } from "./match-records";

type SqlRows = Array<Record<string, unknown>>;

interface CapturedQuery {
  text: string;
  values: unknown[];
}

/** Tagged-template stub returning one canned totals row while capturing
 * the query text and bound values, so tests exercise the SQL contract
 * (predicates and bindings), not just the row mapping. */
function sqlReturning(row: Record<string, unknown>, captured: CapturedQuery) {
  return (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    captured.text = strings.join("?");
    captured.values = values;
    return [row] as SqlRows;
  }) as unknown as Parameters<typeof matchAchievementCounters>[0];
}

describe("matchAchievementCounters", () => {
  it("counts distinct chassis with at least one fight each", async () => {
    const captured: CapturedQuery = { text: "", values: [] };
    const counters = await matchAchievementCounters(
      sqlReturning(
        {
          match_wins: 4,
          saw_match_wins: 1,
          rule_matches: 2,
          pit_matches: 3,
          cube_fights: 7,
          wedge_fights: 0,
          tower_fights: 2,
        },
        captured,
      ),
      "player-1",
    );
    expect(counters).toEqual({
      matchWins: 4,
      sawMatchWins: 1,
      chassisFought: 2,
      ruleMatches: 2,
      pitMatches: 3,
    });
    // Pit Fighter counts records whose fight ran in the Pit.
    expect(captured.text).toContain("WHERE arena_id = 'pit'");
    // First Orders (F-252) counts records whose design carried a rule.
    expect(captured.text).toContain("WHERE rule_count > 0");
    // The SQL contract: one jsonb key-exists predicate per chassis, and
    // the three core ids plus the player id ride as bound values.
    expect(captured.text.match(/used_part_ids \? \?/g)).toHaveLength(3);
    expect(captured.values).toEqual(
      expect.arrayContaining([
        "core-cube",
        "wedge-core",
        "tower-core",
        "player-1",
      ]),
    );
  });

  it("reports zero chassis for a player with no matches", async () => {
    const counters = await matchAchievementCounters(
      sqlReturning(
        {
          match_wins: 0,
          saw_match_wins: 0,
          rule_matches: 0,
          pit_matches: 0,
          cube_fights: 0,
          wedge_fights: 0,
          tower_fights: 0,
        },
        { text: "", values: [] },
      ),
      "player-1",
    );
    expect(counters.chassisFought).toBe(0);
    expect(counters.ruleMatches).toBe(0);
    expect(counters.pitMatches).toBe(0);
  });
});
