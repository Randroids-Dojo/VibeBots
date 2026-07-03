import type { db } from "./db";

type Sql = Awaited<ReturnType<typeof db>>;

/**
 * Server-verified arena match records (battle slice B4): one row per
 * official resolve of a player fight. The table is the durable source
 * for battle stamps (Rule 14) and the workshop record chip; nothing
 * gameplay-affecting reads it.
 */

export type MatchOutcome = "win" | "loss" | "draw";

export interface MatchRecordInput {
  botName: string;
  opponentName: string;
  outcome: MatchOutcome;
  resultHash: string;
  simVersion: number;
  durationTicks: number;
  /** Unique part ids on the player's design, for part-themed stamps. */
  usedPartIds: readonly string[];
}

export interface MatchRecordSummary {
  wins: number;
  losses: number;
  draws: number;
  recent: Array<{
    botName: string;
    opponentName: string;
    outcome: MatchOutcome;
    createdAt: string;
  }>;
}

export async function recordMatchResult(
  sql: Sql,
  playerId: string,
  record: MatchRecordInput,
): Promise<void> {
  await sql`
    INSERT INTO match_records
      (player_id, bot_name, opponent_name, outcome, result_hash,
       sim_version, duration_ticks, used_part_ids)
    VALUES
      (${playerId}, ${record.botName}, ${record.opponentName},
       ${record.outcome}, ${record.resultHash}, ${record.simVersion},
       ${record.durationTicks}, ${JSON.stringify(record.usedPartIds)})`;
}

export async function loadMatchRecordSummary(
  sql: Sql,
  playerId: string,
): Promise<MatchRecordSummary> {
  const totals = (await sql`
    SELECT outcome, COUNT(*)::int AS count
    FROM match_records
    WHERE player_id = ${playerId}
    GROUP BY outcome`) as Array<{ outcome: string; count: number }>;
  const recent = (await sql`
    SELECT bot_name, opponent_name, outcome, created_at
    FROM match_records
    WHERE player_id = ${playerId}
    ORDER BY created_at DESC, id DESC
    LIMIT 10`) as Array<{
    bot_name: string;
    opponent_name: string;
    outcome: string;
    created_at: string;
  }>;
  const countFor = (outcome: MatchOutcome) =>
    totals.find((row) => row.outcome === outcome)?.count ?? 0;
  return {
    wins: countFor("win"),
    losses: countFor("loss"),
    draws: countFor("draw"),
    recent: recent.map((row) => ({
      botName: row.bot_name,
      opponentName: row.opponent_name,
      outcome: (["win", "loss", "draw"].includes(row.outcome)
        ? row.outcome
        : "draw") as MatchOutcome,
      createdAt: String(row.created_at),
    })),
  };
}

/** Durable stamp counters derived straight from the records table. */
export async function matchAchievementCounters(
  sql: Sql,
  playerId: string,
): Promise<{ matchWins: number; sawMatchWins: number }> {
  const rows = (await sql`
    SELECT
      COUNT(*) FILTER (WHERE outcome = 'win')::int AS match_wins,
      COUNT(*) FILTER (
        WHERE outcome = 'win' AND used_part_ids ? 'saw-blade'
      )::int AS saw_match_wins
    FROM match_records
    WHERE player_id = ${playerId}`) as Array<{
    match_wins: number;
    saw_match_wins: number;
  }>;
  return {
    matchWins: rows[0]?.match_wins ?? 0,
    sawMatchWins: rows[0]?.saw_match_wins ?? 0,
  };
}
