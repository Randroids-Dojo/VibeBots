import { db, storageConfigured } from "@/server/db";
import {
  getMinePlayerProfile,
  getOrCreateActiveSaveSlot,
  mineElevatorColumnFromProfile,
} from "@/server/player";
import {
  elevatorRailInstalledInDiff,
  installElevatorRailInDiff,
  type WorldDiff,
} from "@/sim/mine";

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
  const { playerId, session } = await getOrCreateActiveSaveSlot();
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
  const railColumn = profile ? mineElevatorColumnFromProfile(profile) : null;
  let tripIndex = rows[0].trip_count;
  let refundedSupports: Partial<Record<"ladder" | "plank", number>> = {};
  const installation =
    railDepth > 0 && railColumn !== null
      ? installElevatorRailInDiff(diff, railColumn, 0, railDepth)
      : null;
  const railNeedsRepair =
    railDepth > 0 &&
    railColumn !== null &&
    !elevatorRailInstalledInDiff(diff, railColumn, railDepth);
  if (
    installation &&
    (!profile?.elevator_rail_installed_at || railNeedsRepair)
  ) {
    const refundedLadders = installation.refunded.ladder ?? 0;
    const refundedPlanks = installation.refunded.plank ?? 0;
    const updated = (await sql`
      WITH world_lock AS MATERIALIZED (
        SELECT player_id
        FROM mine_worlds
        WHERE player_id = ${playerId}
          AND trip_count = ${rows[0].trip_count}
          AND diff = ${JSON.stringify(diff)}::jsonb
        FOR UPDATE
      ), player_lock AS MATERIALIZED (
        SELECT id, elevator_support_refund_at IS NULL AS refund_supports
        FROM players
        WHERE id = ${playerId}
          AND (elevator_rail_installed_at IS NULL OR ${railNeedsRepair})
          AND EXISTS (SELECT 1 FROM world_lock)
        FOR UPDATE
      ), world_update AS (
        UPDATE mine_worlds
        SET diff = ${JSON.stringify(installation.diff)}::jsonb,
            trip_count = trip_count + 1,
            updated_at = now()
        WHERE player_id = ${playerId}
          AND EXISTS (SELECT 1 FROM player_lock)
        RETURNING player_id, trip_count
      ), player_update AS (
        UPDATE players
        SET ladder_count = ladder_count + CASE
              WHEN elevator_support_refund_at IS NULL THEN ${refundedLadders}
              ELSE 0
            END,
            plank_count = plank_count + CASE
              WHEN elevator_support_refund_at IS NULL THEN ${refundedPlanks}
              ELSE 0
            END,
            elevator_support_refund_at = COALESCE(elevator_support_refund_at, now()),
            elevator_rail_installed_at = now()
        WHERE id = ${playerId}
          AND (elevator_rail_installed_at IS NULL OR ${railNeedsRepair})
          AND EXISTS (SELECT 1 FROM world_update)
        RETURNING id
      )
      SELECT player_update.id,
             player_lock.refund_supports,
             world_update.trip_count
      FROM player_update
      JOIN player_lock ON player_lock.id = player_update.id
      JOIN world_update ON world_update.player_id = player_update.id`) as Array<{
      id: string;
      refund_supports: boolean;
      trip_count: number;
    }>;
    if (updated.length > 0) {
      diff = installation.diff;
      tripIndex = updated[0].trip_count;
      refundedSupports = updated[0].refund_supports
        ? installation.refunded
        : {};
    } else {
      // Another save mutation won the guarded write. Return that winner's
      // checkpoint instead of pairing a stale diff with freshly loaded gear.
      const current = (await sql`
        SELECT diff, trip_count
        FROM mine_worlds
        WHERE player_id = ${playerId}`) as Array<{
        diff: unknown;
        trip_count: number;
      }>;
      if (current[0]) {
        diff = (current[0].diff ?? []) as WorldDiff;
        tripIndex = current[0].trip_count;
      }
    }
  }
  return Response.json({
    seed: Number(rows[0].seed),
    diff,
    tripIndex,
    activeSlot: session.activeSlot,
    refundedSupports,
  });
}
