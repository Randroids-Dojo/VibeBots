import { refreshPlayerAchievements } from "@/server/achievements";
import { recordBalanceEvent } from "@/server/balance-telemetry";
import { db, storageConfigured } from "@/server/db";
import {
  getMinePlayerProfile,
  getOrCreatePlayerId,
  mineElevatorColumnFromProfile,
} from "@/server/player";
import { sameOriginMutationRequired } from "@/server/request-guards";
import {
  pushEndpointHashFromRequest,
  queueSaveSyncPush,
} from "@/server/save-sync-push";
import { playerLevelProgress } from "@/sim/bunker";
import {
  elevatorRailPrice,
  installElevatorRailInDiff,
  MINE_BOTTOM_ROW,
  type WorldDiff,
} from "@/sim/mine";

export const runtime = "nodejs";

/**
 * Buys one elevator rail row. The first buy anchors the shaft at the chosen
 * surface column. Later buys retain that column. One CTE keeps the spend,
 * depth bump, support refund, and world carve behind the same concurrency gate.
 */
export async function POST(request: Request): Promise<Response> {
  const rejected = sameOriginMutationRequired(request);
  if (rejected) return rejected;
  if (!storageConfigured()) {
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return Response.json(
      { error: "content type must be application/json" },
      { status: 415 },
    );
  }
  const rawBody = await request.text();
  let requestedColumn: number | undefined;
  if (rawBody) {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: "invalid request body" }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return Response.json({ error: "invalid request body" }, { status: 400 });
    }
    const column = (body as { column?: unknown }).column;
    if (column !== undefined) {
      if (
        typeof column !== "number" ||
        !Number.isInteger(column) ||
        column < -100_000 ||
        column > 100_000
      ) {
        return Response.json(
          { error: "column must be an integer from -100000 to 100000" },
          { status: 400 },
        );
      }
      requestedColumn = column;
    }
  }

  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  const profile = await getMinePlayerProfile(sql, playerId);
  const rows = (await sql`
    SELECT diff, trip_count FROM mine_worlds
    WHERE player_id = ${playerId}`) as Array<{
    diff: unknown;
    trip_count: number;
  }>;
  const depth = profile?.elevator_depth ?? 0;
  const storedColumn = profile ? mineElevatorColumnFromProfile(profile) : null;
  const oldDiff = (rows[0]?.diff ?? []) as WorldDiff;
  const worldTripCount = rows[0]?.trip_count;
  if (worldTripCount === undefined) {
    return Response.json({ error: "mine world not found" }, { status: 409 });
  }
  const placementRequired = Boolean(
    profile && depth > 0 && !profile.elevator_placement_chosen_at,
  );
  if (placementRequired) {
    if (requestedColumn === undefined) {
      return Response.json(
        { error: "choose a surface column for the elevator shaft" },
        { status: 400 },
      );
    }
    const installation = installElevatorRailInDiff(
      oldDiff,
      requestedColumn,
      0,
      depth,
    );
    const refundedLadders = installation.refunded.ladder ?? 0;
    const refundedPlanks = installation.refunded.plank ?? 0;
    const updated = (await sql`
      WITH world_lock AS MATERIALIZED (
        SELECT player_id
        FROM mine_worlds
        WHERE player_id = ${playerId}
          AND trip_count = ${worldTripCount}
          AND diff = ${JSON.stringify(oldDiff)}::jsonb
        FOR UPDATE
      ), player_lock AS MATERIALIZED (
        SELECT id
        FROM players
        WHERE id = ${playerId}
          AND elevator_depth = ${depth}
          AND elevator_placement_chosen_at IS NULL
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
        SET elevator_col = ${requestedColumn},
            elevator_placement_chosen_at = now(),
            elevator_column_migrated_at = COALESCE(elevator_column_migrated_at, now()),
            elevator_rail_installed_at = now(),
            elevator_support_refund_at = COALESCE(elevator_support_refund_at, now()),
            ladder_count = ladder_count + ${refundedLadders},
            plank_count = plank_count + ${refundedPlanks}
        WHERE id = ${playerId}
          AND elevator_depth = ${depth}
          AND elevator_placement_chosen_at IS NULL
          AND EXISTS (SELECT 1 FROM world_update)
        RETURNING id, emeralds, elevator_depth, elevator_col, ladder_count, plank_count
      )
      SELECT player_update.emeralds,
             player_update.elevator_depth,
             player_update.elevator_col,
             player_update.ladder_count,
             player_update.plank_count,
             world_update.trip_count AS trip_index
      FROM player_update
      JOIN world_update ON world_update.player_id = player_update.id`) as Array<{
      emeralds: number;
      elevator_depth: number;
      elevator_col: number;
      ladder_count: number;
      plank_count: number;
      trip_index: number;
    }>;
    if (updated.length === 0) {
      return Response.json(
        { error: "elevator placement was already confirmed" },
        { status: 409 },
      );
    }
    const refundedSupports: Partial<Record<"ladder" | "plank", number>> = {
      ...(refundedLadders > 0 ? { ladder: refundedLadders } : {}),
      ...(refundedPlanks > 0 ? { plank: refundedPlanks } : {}),
    };
    queueSaveSyncPush({
      sql,
      playerId,
      excludeEndpointHash: pushEndpointHashFromRequest(request),
    });
    return Response.json({
      elevator: updated[0].elevator_depth,
      elevatorColumn: updated[0].elevator_col,
      elevatorPlacementRequired: false,
      relocated: true,
      tripIndex: updated[0].trip_index,
      balance: updated[0].emeralds,
      diff: installation.diff,
      refundedLadders,
      refundedSupports,
      ladders: updated[0].ladder_count,
      planks: updated[0].plank_count,
      newStamps: [],
    });
  }
  if (depth === 0 && requestedColumn === undefined) {
    return Response.json(
      { error: "choose a surface column for the elevator shaft" },
      { status: 400 },
    );
  }
  if (
    storedColumn !== null &&
    requestedColumn !== undefined &&
    requestedColumn !== storedColumn
  ) {
    return Response.json(
      { error: "elevator shaft is already placed", column: storedColumn },
      { status: 409 },
    );
  }
  const column = storedColumn ?? requestedColumn;
  if (column === undefined) {
    return Response.json(
      { error: "choose a surface column for the elevator shaft" },
      { status: 400 },
    );
  }
  if (depth >= MINE_BOTTOM_ROW - 1) {
    return Response.json(
      { error: "elevator rail has reached the mine bottom" },
      { status: 409 },
    );
  }

  const price = elevatorRailPrice(depth);
  const nextDepth = depth + 1;
  const purchasedRow = installElevatorRailInDiff(
    oldDiff,
    column,
    depth,
    nextDepth,
  );
  const installation = installElevatorRailInDiff(oldDiff, column, 0, nextDepth);
  const purchasedLadders = purchasedRow.refunded.ladder ?? 0;
  const purchasedPlanks = purchasedRow.refunded.plank ?? 0;
  const legacyLadders = Math.max(
    0,
    (installation.refunded.ladder ?? 0) - purchasedLadders,
  );
  const legacyPlanks = Math.max(
    0,
    (installation.refunded.plank ?? 0) - purchasedPlanks,
  );

  const updated = (await sql`
    WITH world_lock AS MATERIALIZED (
      SELECT player_id
      FROM mine_worlds
      WHERE player_id = ${playerId}
        AND trip_count = ${worldTripCount}
        AND diff = ${JSON.stringify(oldDiff)}::jsonb
      FOR UPDATE
    ), player_lock AS MATERIALIZED (
      SELECT id, elevator_support_refund_at IS NULL AS refund_legacy_supports
      FROM players
      WHERE id = ${playerId}
        AND emeralds >= ${price}
        AND elevator_depth = ${depth}
        AND (elevator_col IS NULL OR elevator_col = ${column})
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
      SET emeralds = emeralds - ${price},
          elevator_depth = ${nextDepth},
          elevator_col = ${column},
          elevator_placement_chosen_at = COALESCE(elevator_placement_chosen_at, now()),
          elevator_column_migrated_at = COALESCE(elevator_column_migrated_at, now()),
          elevator_rail_installed_at = now(),
          elevator_support_refund_at = COALESCE(elevator_support_refund_at, now()),
          ladder_count = ladder_count + ${purchasedLadders} + CASE
            WHEN (SELECT refund_legacy_supports FROM player_lock)
            THEN ${legacyLadders}
            ELSE 0
          END,
          plank_count = plank_count + ${purchasedPlanks} + CASE
            WHEN (SELECT refund_legacy_supports FROM player_lock)
            THEN ${legacyPlanks}
            ELSE 0
          END
      WHERE id = ${playerId}
        AND emeralds >= ${price}
        AND elevator_depth = ${depth}
        AND (elevator_col IS NULL OR elevator_col = ${column})
        AND EXISTS (SELECT 1 FROM world_update)
      RETURNING id, emeralds, elevator_depth, elevator_col, ladder_count, plank_count
    )
    SELECT player_update.emeralds,
           player_update.elevator_depth,
           player_update.elevator_col,
           player_update.ladder_count,
           player_update.plank_count,
           player_lock.refund_legacy_supports,
           world_update.trip_count AS trip_index
    FROM player_update
    JOIN player_lock ON player_lock.id = player_update.id
    JOIN world_update ON world_update.player_id = player_update.id`) as Array<{
    emeralds: number;
    elevator_depth: number;
    elevator_col: number;
    ladder_count: number;
    plank_count: number;
    refund_legacy_supports: boolean;
    trip_index: number;
  }>;
  if (updated.length === 0) {
    return Response.json(
      { error: "not enough vibes (or already extended)" },
      { status: 409 },
    );
  }
  const refundedLadders =
    purchasedLadders + (updated[0].refund_legacy_supports ? legacyLadders : 0);
  const refundedPlanks =
    purchasedPlanks + (updated[0].refund_legacy_supports ? legacyPlanks : 0);
  const refundedSupports: Partial<Record<"ladder" | "plank", number>> = {
    ...(refundedLadders > 0 ? { ladder: refundedLadders } : {}),
    ...(refundedPlanks > 0 ? { plank: refundedPlanks } : {}),
  };
  let newStamps: string[] = [];
  try {
    newStamps = (await refreshPlayerAchievements(sql, playerId)).newlyUnlocked;
  } catch {
    // Stamps are cosmetic and must never block a successful rail buy.
  }
  try {
    await recordBalanceEvent(sql, playerId, "elevator.upgrade", {
      fromDepth: depth,
      toDepth: updated[0].elevator_depth,
      row: updated[0].elevator_depth,
      column: updated[0].elevator_col,
      price,
      refundedLadders,
      refundedPlanks,
      balanceAfter: updated[0].emeralds,
      playerLevel: playerLevelProgress(profile?.defense_xp ?? 0).level,
      deepestDepth: profile?.deepest_depth ?? 0,
    });
  } catch {
    // Balance events support tuning, but should not fail a charged rail buy.
  }
  queueSaveSyncPush({
    sql,
    playerId,
    excludeEndpointHash: pushEndpointHashFromRequest(request),
  });
  return Response.json({
    elevator: updated[0].elevator_depth,
    elevatorColumn: updated[0].elevator_col,
    tripIndex: updated[0].trip_index,
    balance: updated[0].emeralds,
    diff: installation.diff,
    refundedLadders,
    refundedSupports,
    ladders: updated[0].ladder_count,
    planks: updated[0].plank_count,
    newStamps,
  });
}
