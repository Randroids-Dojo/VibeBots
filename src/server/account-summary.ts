import type { db } from "./db";

type Sql = Awaited<ReturnType<typeof db>>;

export interface AccountSaveSummary {
  exists: boolean;
  createdAt: string | null;
  balance: number;
  deepestDepth: number;
  partsOwned: number;
  designs: number;
  stamps: number;
}

export async function accountSaveSummary(
  sql: Sql,
  playerId: string | null,
): Promise<AccountSaveSummary | null> {
  if (!playerId) return null;
  const rows = (await sql`
    SELECT p.created_at,
           p.emeralds,
           p.deepest_depth,
           COALESCE((
             SELECT SUM(pp.count)::int
             FROM player_parts pp
             WHERE pp.player_id = p.id
           ), 0)::int AS parts_owned,
           (
             SELECT COUNT(*)::int
             FROM bot_designs bd
             WHERE bd.player_id = p.id
           ) AS designs,
           (
             SELECT COUNT(*)::int
             FROM player_achievements pa
             WHERE pa.player_id = p.id
           ) AS stamps
    FROM players p
    WHERE p.id = ${playerId}`) as Array<{
    created_at: string;
    emeralds: number;
    deepest_depth: number;
    parts_owned: number;
    designs: number;
    stamps: number;
  }>;
  const row = rows[0];
  if (!row) {
    return {
      exists: false,
      createdAt: null,
      balance: 0,
      deepestDepth: 0,
      partsOwned: 0,
      designs: 0,
      stamps: 0,
    };
  }
  return {
    exists: true,
    createdAt: row.created_at,
    balance: row.emeralds,
    deepestDepth: row.deepest_depth,
    partsOwned: row.parts_owned,
    designs: row.designs,
    stamps: row.stamps,
  };
}
