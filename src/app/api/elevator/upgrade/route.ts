import { refreshPlayerAchievements } from "@/server/achievements";
import { db, storageConfigured } from "@/server/db";
import { getMinePlayerProfile, getOrCreatePlayerId } from "@/server/player";
import {
  ELEVATOR_SEGMENT_ROWS,
  elevatorSegmentPrice,
  refundRailSupportsInDiff,
  type WorldDiff,
} from "@/sim/mine";

export const runtime = "nodejs";

/**
 * Buys the next elevator rail segment (REQ-028, Q-011 default B): one
 * conditional statement so the spend and the depth bump land together,
 * guarded against concurrent double-buys by the current-depth match.
 */
export async function POST(): Promise<Response> {
  if (!storageConfigured()) {
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const profile = await getMinePlayerProfile(sql, playerId);
  const rows = (await sql`
    SELECT diff FROM mine_worlds
    WHERE player_id = ${playerId}`) as Array<{
    diff: unknown;
  }>;
  const depth = profile?.elevator_depth ?? 0;
  const segment = depth / ELEVATOR_SEGMENT_ROWS + 1;
  const price = elevatorSegmentPrice(segment);
  const nextDepth = depth + ELEVATOR_SEGMENT_ROWS;
  const oldDiff = (rows[0]?.diff ?? []) as WorldDiff;
  const refund = refundRailSupportsInDiff(oldDiff, depth, nextDepth);
  const refundedLadders = refund.refunded.ladder ?? 0;
  const refundedPlanks = refund.refunded.plank ?? 0;

  const updated = (await sql`
    UPDATE players
    SET emeralds = emeralds - ${price},
        elevator_depth = ${nextDepth},
        ladder_count = ladder_count + ${refundedLadders},
        plank_count = plank_count + ${refundedPlanks}
    WHERE id = ${playerId}
      AND emeralds >= ${price}
      AND elevator_depth = ${depth}
    RETURNING emeralds, elevator_depth, ladder_count, plank_count`) as Array<{
    emeralds: number;
    elevator_depth: number;
    ladder_count: number;
    plank_count: number;
  }>;
  if (updated.length === 0) {
    return Response.json(
      { error: "not enough vibes (or already extended)" },
      { status: 409 },
    );
  }
  if (rows[0]?.diff) {
    await sql`
      UPDATE mine_worlds
      SET diff = ${JSON.stringify(refund.diff)}::jsonb,
          updated_at = now()
      WHERE player_id = ${playerId}`;
  }
  try {
    await refreshPlayerAchievements(sql, playerId);
  } catch {
    // Stamps are cosmetic and must never block a successful rail buy.
  }
  return Response.json({
    elevator: updated[0].elevator_depth,
    balance: updated[0].emeralds,
    diff: refund.diff,
    refundedLadders,
    refundedSupports: refund.refunded,
    ladders: updated[0].ladder_count,
    planks: updated[0].plank_count,
  });
}
