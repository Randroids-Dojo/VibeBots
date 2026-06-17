import { db, storageConfigured } from "@/server/db";
import { getMinePlayerProfile, getOrCreatePlayerId } from "@/server/player";
import { refundRailSupportsInDiff, type WorldDiff } from "@/sim/mine";

export const runtime = "nodejs";

/**
 * The player's persistent mine (REQ-026): seed, world diff, and the
 * trip counter. Created on first visit with a server-issued seed (which
 * also closes the client-seed search exploit from F-011 for worlds).
 */
export async function GET(): Promise<Response> {
  if (!storageConfigured()) {
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const seed = Math.floor(Math.random() * 4294967296);
  const rows = (await sql`
    INSERT INTO mine_worlds (player_id, seed)
    VALUES (${playerId}, ${seed})
    ON CONFLICT (player_id) DO UPDATE SET player_id = mine_worlds.player_id
    RETURNING seed, diff, trip_count`) as Array<{
    seed: string | number;
    diff: unknown;
    trip_count: number;
  }>;
  let diff = (rows[0].diff ?? []) as WorldDiff;
  const profile = await getMinePlayerProfile(sql, playerId);
  const railDepth = profile?.elevator_depth ?? 0;
  let refundedSupports: Partial<Record<"ladder" | "plank", number>> = {};
  if (railDepth > 0 && !profile?.elevator_support_refund_at) {
    const refund = refundRailSupportsInDiff(diff, 0, railDepth);
    const refundedLadders = refund.refunded.ladder ?? 0;
    const refundedPlanks = refund.refunded.plank ?? 0;
    const updated = (await sql`
      UPDATE players
      SET ladder_count = ladder_count + ${refundedLadders},
          plank_count = plank_count + ${refundedPlanks},
          elevator_support_refund_at = now()
      WHERE id = ${playerId}
        AND elevator_support_refund_at IS NULL
      RETURNING id`) as Array<{ id: string }>;
    if (updated.length > 0) {
      diff = refund.diff;
      refundedSupports = refund.refunded;
      await sql`
        UPDATE mine_worlds
        SET diff = ${JSON.stringify(diff)}::jsonb,
            updated_at = now()
        WHERE player_id = ${playerId}`;
    }
  }
  return Response.json({
    seed: Number(rows[0].seed),
    diff,
    tripIndex: rows[0].trip_count,
    refundedSupports,
  });
}
