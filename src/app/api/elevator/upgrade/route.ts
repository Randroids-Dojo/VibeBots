import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { ELEVATOR_SEGMENT_ROWS, elevatorSegmentPrice } from "@/sim/mine";

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
  const rows = (await sql`
    SELECT elevator_depth FROM players WHERE id = ${playerId}`) as Array<{
    elevator_depth: number;
  }>;
  const depth = rows[0]?.elevator_depth ?? 0;
  const segment = depth / ELEVATOR_SEGMENT_ROWS + 1;
  const price = elevatorSegmentPrice(segment);
  const nextDepth = depth + ELEVATOR_SEGMENT_ROWS;

  const updated = (await sql`
    UPDATE players
    SET emeralds = emeralds - ${price}, elevator_depth = ${nextDepth}
    WHERE id = ${playerId}
      AND emeralds >= ${price}
      AND elevator_depth = ${depth}
    RETURNING emeralds, elevator_depth`) as Array<{
    emeralds: number;
    elevator_depth: number;
  }>;
  if (updated.length === 0) {
    return Response.json(
      { error: "not enough credits (or already extended)" },
      { status: 409 },
    );
  }
  return Response.json({
    elevator: updated[0].elevator_depth,
    balance: updated[0].emeralds,
  });
}
