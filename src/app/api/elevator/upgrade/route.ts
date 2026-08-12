import { randomUUID } from "node:crypto";
import type { ElevatorReasonCode } from "@/lib/api-codes";
import { refreshPlayerAchievements } from "@/server/achievements";
import { recordBalanceEvent } from "@/server/balance-telemetry";
import { db, storageConfigured } from "@/server/db";
import {
  deliverElevatorOutcome,
  drainPendingElevatorOutcomes,
  elevatorOutcomeExists,
  isValidRequestId,
} from "@/server/elevator-outbox";
import {
  type ElevatorMutation,
  type ElevatorMutationOutcomeEvent,
  logElevatorOutcomeEvent,
} from "@/server/monitoring";
import {
  getMinePlayerProfile,
  getOrCreatePlayerId,
  type MineConsumablesRow,
  type MineGearRow,
  type MinePlayerProfile,
  mineConsumablesFromProfile,
  mineElevatorColumnFromProfile,
  mineGearFromProfile,
} from "@/server/player";
import { sameOriginMutationRequired } from "@/server/request-guards";
import {
  pushEndpointHashFromRequest,
  queueSaveSyncPush,
} from "@/server/save-sync-push";
import { playerLevelProgress } from "@/sim/bunker";
import {
  ELEVATOR_STARTER_RAIL_ROWS,
  ELEVATOR_UNLOCK_DEPTH,
  elevatorRailPrice,
  installElevatorRailInDiff,
  MINE_BOTTOM_ROW,
  type MineConsumables,
  type MineGear,
  type WorldDiff,
} from "@/sim/mine";

export const runtime = "nodejs";

/**
 * Authoritative rail state the client adopts wholesale after a rejected buy
 * (F-121). Every conflict response carries this bundle so the controls
 * re-enable against the truth instead of a stale screen.
 */
type ElevatorState = {
  balance: number;
  elevator: number;
  elevatorColumn: number | null;
  ladders: number;
  planks: number;
  tripIndex: number;
  elevatorPlacementRequired: boolean;
  /**
   * The full authoritative gear and consumable inventory (F-121). The client
   * adopts these wholesale so a concurrent player-only purchase (which leaves
   * the rail depth and checkpoint untouched) cannot persist a stale non-rail
   * gear or consumable count. Accepted buys carry the exact committed row;
   * rejects carry a fresh read.
   */
  gear: MineGear;
  consumables: MineConsumables;
};

/** The inventory columns a committed CTE row or a fresh read maps to gear. */
type InventoryRow = MineGearRow & MineConsumablesRow;

/** Map an inventory row to the response's authoritative gear and consumables. */
function inventoryFromRow(row: InventoryRow): {
  gear: MineGear;
  consumables: MineConsumables;
} {
  return {
    gear: mineGearFromProfile(row),
    consumables: mineConsumablesFromProfile(row),
  };
}

function placementRequiredFrom(
  depth: number,
  placementChosenAt: string | null,
): boolean {
  return depth > 0 && !placementChosenAt;
}

/** The rail state already loaded for the request, before any write happened. */
function elevatorStateFromProfile(
  profile: MinePlayerProfile,
  tripIndex: number,
): ElevatorState {
  return {
    balance: profile.emeralds,
    elevator: profile.elevator_depth,
    elevatorColumn: mineElevatorColumnFromProfile(profile),
    ladders: profile.ladder_count,
    planks: profile.plank_count,
    tripIndex,
    elevatorPlacementRequired: placementRequiredFrom(
      profile.elevator_depth,
      profile.elevator_placement_chosen_at,
    ),
    ...inventoryFromRow(profile),
  };
}

/** A fresh read for rejects after a guarded write may have moved state. */
async function reloadElevatorState(
  sql: Awaited<ReturnType<typeof db>>,
  playerId: string,
): Promise<ElevatorState | null> {
  const rows = (await sql`
    SELECT p.emeralds, p.elevator_depth, p.elevator_col, p.ladder_count,
           p.plank_count, p.elevator_placement_chosen_at,
           p.pickaxe_level, p.lamp_level, p.cargo_level, p.lantern_level,
           p.warpcoil_level, p.blast_level, p.elevator_speed_level,
           p.fall_level, p.recall_level,
           p.dynamite_count, p.rope_count, p.beacon_count,
           w.trip_count
    FROM players p
    LEFT JOIN mine_worlds w ON w.player_id = p.id
    WHERE p.id = ${playerId}`) as Array<
    InventoryRow & {
      emeralds: number;
      elevator_placement_chosen_at: string | null;
      trip_count: number | null;
    }
  >;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    balance: row.emeralds,
    elevator: row.elevator_depth,
    elevatorColumn: mineElevatorColumnFromProfile({
      elevator_depth: row.elevator_depth,
      elevator_col: row.elevator_col,
    }),
    ladders: row.ladder_count,
    planks: row.plank_count,
    tripIndex: row.trip_count ?? 0,
    elevatorPlacementRequired: placementRequiredFrom(
      row.elevator_depth,
      row.elevator_placement_chosen_at,
    ),
    ...inventoryFromRow(row),
  };
}

/** A rejected buy: a stable code, human text, and the authoritative state. */
function elevatorReject(
  code: ElevatorReasonCode,
  error: string,
  status: number,
  state: ElevatorState | null,
): Response {
  return Response.json({ code, error, ...(state ?? {}) }, { status });
}

/**
 * Emit an outcome log, best-effort (F-121). Observability must never fail or
 * roll back a committed rail buy, so any monitoring error is swallowed. This is
 * a single best-effort attempt: it does not retry, and a thrown sink drops the
 * event (the durable, deduplicated outbox variant is a separate open F-121
 * item).
 */
function safeLogElevatorOutcome(event: ElevatorMutationOutcomeEvent): void {
  try {
    logElevatorOutcomeEvent(event);
  } catch {
    // Swallow: an outcome log can never break gameplay.
  }
}

/**
 * Classify why a guarded rail write matched zero rows, given the freshly
 * re-read state and the pre-write expectations. Order is most-specific first:
 * a moved rail depth or column beats balance, which beats a moved checkpoint,
 * and an otherwise-buyable state means we simply lost a race.
 */
function classifyElevatorConflict(
  state: ElevatorState | null,
  expected: {
    depth: number;
    column: number;
    price: number;
    tripIndex: number;
  },
): ElevatorReasonCode {
  if (state === null) return "elevator-concurrent-loss";
  if (state.elevator !== expected.depth) return "elevator-stale-rail-state";
  if (state.elevatorColumn !== null && state.elevatorColumn !== expected.column)
    return "elevator-stale-rail-state";
  // A moved checkpoint means the whole world advanced under the client, so it
  // must win over a low balance: report it as stale before insufficient funds
  // so the client refreshes the world instead of showing a dead-end price note
  // over a stale rail. The authoritative balance rides back with the refresh.
  if (state.tripIndex !== expected.tripIndex)
    return "elevator-stale-checkpoint";
  if (state.balance < expected.price) return "elevator-insufficient-balance";
  return "elevator-concurrent-loss";
}

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
  let expectedDepth: number | undefined;
  let clientRequestId: string | undefined;
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
    const rawExpectedDepth = (body as { expectedDepth?: unknown })
      .expectedDepth;
    if (rawExpectedDepth !== undefined) {
      if (
        typeof rawExpectedDepth !== "number" ||
        !Number.isInteger(rawExpectedDepth) ||
        rawExpectedDepth < 0 ||
        rawExpectedDepth > MINE_BOTTOM_ROW
      ) {
        return Response.json(
          {
            error: `expectedDepth must be an integer from 0 to ${MINE_BOTTOM_ROW}`,
          },
          { status: 400 },
        );
      }
      expectedDepth = rawExpectedDepth;
    }
    // The client's idempotency key (F-121). A well-formed UUID enables durable
    // dedup and duplicate-request detection; anything malformed is ignored (a
    // server-side id is minted below) rather than rejecting the buy, so a buggy
    // or legacy client still buys safely under the expectedDepth guard.
    const rawRequestId = (body as { requestId?: unknown }).requestId;
    if (isValidRequestId(rawRequestId)) {
      clientRequestId = rawRequestId;
    }
  }

  // expectedDepth is required: it is the stale-rail guard, and every current
  // client sends it (the store passes the live gear depth, 0 for the first
  // rail). A request without it is a stale cached client that would otherwise
  // bypass the guard and could silently buy a second row, so reject fail-fast
  // before any read or charge. See F-121; kept optional until every client
  // shipped it, now enforced.
  if (expectedDepth === undefined) {
    // Bounded reason-only signal so the volume of stale no-expectedDepth
    // traffic is observable (Q-027's revisit criterion). This is a pre-auth
    // reject: no player, operation, coordinate, or raw payload is logged.
    safeLogElevatorOutcome({
      result: "rejected",
      reason: "elevator-expected-depth-required",
    });
    // A stale cached client (old JS from before the field existed) copies this
    // error text straight into a visible shop note, so return reload guidance
    // rather than the internal field name.
    return elevatorReject(
      "elevator-expected-depth-required",
      "reload the game to update, then try again",
      400,
      null,
    );
  }

  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  // Recovery drain (F-121): redeliver any outcome that committed but whose
  // delivery was lost to a crash or sink outage. Best-effort and bounded; the
  // project has no cron, so request traffic drains the outbox. It never blocks
  // or fails this buy.
  await drainPendingElevatorOutcomes(sql);
  // The effective idempotency key: the client's UUID when valid (enables dedup
  // and duplicate-request detection), otherwise a server-minted id so the
  // outcome is still recorded durably (a legacy client cannot replay an id it
  // never sent, so no dedup is lost).
  const requestId = clientRequestId ?? randomUUID();
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
  // Whether the loaded shaft still needs its one-time free placement (an
  // existing owner who has not yet confirmed a surface column). Drives the
  // placement branch below.
  const placementRequired = Boolean(
    profile && depth > 0 && !profile.elevator_placement_chosen_at,
  );
  // The mutation the REQUEST intends, derived from its own shape rather than the
  // post-write profile: the first rail sends expectedDepth 0 (place); an owner
  // confirming a column sends a positive depth with a column (relocate); a plain
  // extend sends a positive depth and no column (extend). Deriving intent from
  // the request keeps a lost-success retry legible: a retried first placement
  // still reads as "place" even though the committed buy already advanced the
  // stored depth, and a retried relocation reads as "relocate" (F-121). It is
  // also the guard the relocate-retry check below relies on.
  const operation: ElevatorMutation =
    expectedDepth === 0
      ? "place"
      : requestedColumn !== undefined
        ? "relocate"
        : "extend";
  // Mutation-level outcome telemetry (F-121): records every mutation-level
  // accept and reject with the resolved operation. Best-effort (see
  // safeLogElevatorOutcome); a rejected write emits this log and no balance
  // event.
  const emitOutcome = (
    result: "accepted" | "rejected",
    reason: ElevatorReasonCode | null,
  ): void => {
    safeLogElevatorOutcome({ playerId, operation, result, reason });
  };
  const rejectOutcome = (
    code: ElevatorReasonCode,
    error: string,
    status: number,
    state: ElevatorState | null,
  ): Response => {
    emitOutcome("rejected", code);
    return elevatorReject(code, error, status, state);
  };
  // A guarded write that matched zero rows after a client-supplied id passed the
  // pre-check can be a concurrent same-id loser: the winner committed and
  // recorded this id in the outbox (its FOR UPDATE serializes the loser, so by
  // now the winner's transaction, including the outbox row, is committed). Report
  // that precisely as a duplicate and emit NO new outcome, so the id keeps
  // exactly one outcome (the winner's durable accepted). Otherwise it is an
  // ordinary conflict and emits its reject outcome. Only checked for a
  // client-supplied id (a server-minted id cannot collide).
  const resolveGuardedConflict = async (
    code: ElevatorReasonCode,
    error: string,
    state: ElevatorState | null,
  ): Promise<Response> => {
    if (clientRequestId && (await elevatorOutcomeExists(sql, requestId))) {
      return elevatorReject(
        "elevator-duplicate-request",
        "that purchase already went through; refresh and try again",
        409,
        state,
      );
    }
    return rejectOutcome(code, error, 409, state);
  };
  if (worldTripCount === undefined) {
    return rejectOutcome(
      "elevator-mine-world-missing",
      "mine world not found",
      409,
      null,
    );
  }
  const currentState = profile
    ? elevatorStateFromProfile(profile, worldTripCount)
    : null;
  // Duplicate-request dedup (F-121): a client-supplied id that already produced
  // a committed outcome is a replay of an already-applied buy (a lost-success
  // retry that reused its id). Reject it with the precise duplicate reason and
  // the authoritative state, and emit NO new outcome, so exactly one outcome
  // exists per request. This runs before the stale-depth check because a replay
  // also fails that guard, but "duplicate" is the more honest cause. Skipped for
  // a server-minted id (a legacy client cannot replay, so it never collides).
  if (clientRequestId && (await elevatorOutcomeExists(sql, requestId))) {
    return elevatorReject(
      "elevator-duplicate-request",
      "that purchase already went through; refresh and try again",
      409,
      currentState,
    );
  }
  // A stale or replayed buy (including a retry after a lost success response)
  // still shows the client's old rail depth. Reject before any charge so it
  // cannot silently advance a second row; the client adopts currentState.
  // expectedDepth is guaranteed present (required above).
  if (expectedDepth !== depth) {
    return rejectOutcome(
      "elevator-stale-rail-state",
      "your saved rail depth is out of date; refresh and try again",
      409,
      currentState,
    );
  }
  if (placementRequired) {
    if (requestedColumn === undefined) {
      return rejectOutcome(
        "elevator-column-required",
        "choose a surface column for the elevator shaft",
        400,
        currentState,
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
      ), outcome_insert AS (
        INSERT INTO elevator_upgrade_outcomes
          (request_id, player_id, operation, result)
        SELECT ${requestId}::uuid, ${playerId}, ${operation}, 'accepted'
        WHERE EXISTS (SELECT 1 FROM player_lock)
        ON CONFLICT (request_id) DO NOTHING
        RETURNING request_id
      ), world_update AS (
        UPDATE mine_worlds
        SET diff = ${JSON.stringify(installation.diff)}::jsonb,
            trip_count = trip_count + 1,
            updated_at = now()
        WHERE player_id = ${playerId}
          AND EXISTS (SELECT 1 FROM player_lock)
          AND EXISTS (SELECT 1 FROM outcome_insert)
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
        RETURNING id, emeralds, elevator_depth, elevator_col,
                  ladder_count, plank_count,
                  pickaxe_level, lamp_level, cargo_level, lantern_level,
                  warpcoil_level, blast_level, elevator_speed_level,
                  fall_level, recall_level,
                  dynamite_count, rope_count, beacon_count
      )
      SELECT player_update.*, world_update.trip_count AS trip_index
      FROM player_update
      JOIN world_update ON world_update.player_id = player_update.id`) as Array<
      InventoryRow & { id: string; emeralds: number; trip_index: number }
    >;
    if (updated.length === 0) {
      const state = await reloadElevatorState(sql, playerId);
      const code: ElevatorReasonCode =
        state === null
          ? "elevator-concurrent-loss"
          : !state.elevatorPlacementRequired
            ? "elevator-stale-rail-state"
            : state.tripIndex !== worldTripCount
              ? "elevator-stale-checkpoint"
              : "elevator-concurrent-loss";
      const message =
        code === "elevator-stale-checkpoint"
          ? "the mine changed under your placement; refresh and retry"
          : code === "elevator-concurrent-loss"
            ? "another change landed first; refresh and retry"
            : "elevator placement was already confirmed";
      return resolveGuardedConflict(code, message, state);
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
    // The outcome row committed inside the CTE above (transactional outbox).
    // Deliver it now (emit + mark), best-effort; the drain redelivers if this
    // process dies before the mark lands.
    await deliverElevatorOutcome(sql, { requestId, playerId, operation });
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
      ...inventoryFromRow(updated[0]),
    });
  }
  // The elevator is a progression reward, not a day-one purchase: the first
  // rail stays locked until a banked trip has reached the unlock depth
  // (deepest_depth only advances through the bank route, so it is durable
  // proof, not a live-trip claim). Owned rail is never re-locked; extends and
  // the legacy placement branch above skip this gate.
  const deepestDepth = profile?.deepest_depth ?? 0;
  if (depth === 0 && deepestDepth < ELEVATOR_UNLOCK_DEPTH) {
    return rejectOutcome(
      "elevator-depth-locked",
      `reach depth ${ELEVATOR_UNLOCK_DEPTH} to unlock the elevator`,
      409,
      currentState,
    );
  }
  if (depth === 0 && requestedColumn === undefined) {
    return rejectOutcome(
      "elevator-column-required",
      "choose a surface column for the elevator shaft",
      400,
      currentState,
    );
  }
  if (
    storedColumn !== null &&
    requestedColumn !== undefined &&
    requestedColumn !== storedColumn
  ) {
    return rejectOutcome(
      "elevator-stale-rail-state",
      "elevator shaft is already placed",
      409,
      currentState,
    );
  }
  // A relocate intent (a column supplied on an existing shaft, expectedDepth > 0)
  // that reaches here has placementRequired already false, so the placement was
  // already confirmed. This is a lost-success retry of an already committed free
  // relocation: relocation sets the placement marker and column but leaves depth
  // unchanged, so the identical retry passes the stale-depth guard, and without
  // this check it would fall through to the paid extension, an unintended charge
  // and a second mutation the user never asked for. Reject with authoritative
  // state; a genuine extend omits the column and is unaffected. The
  // different-column case is handled above; this catches the same-column retry.
  if (operation === "relocate") {
    return rejectOutcome(
      "elevator-stale-rail-state",
      "elevator placement was already confirmed",
      409,
      currentState,
    );
  }
  const column = storedColumn ?? requestedColumn;
  if (column === undefined) {
    return rejectOutcome(
      "elevator-column-required",
      "choose a surface column for the elevator shaft",
      400,
      currentState,
    );
  }
  if (depth >= MINE_BOTTOM_ROW - 1) {
    return rejectOutcome(
      "elevator-rail-at-bottom",
      "elevator rail has reached the mine bottom",
      409,
      currentState,
    );
  }

  const price = elevatorRailPrice(depth);
  // The first purchase installs a working starter shaft, not a single row:
  // one row of rail is not an elevator anyone would ride. Extends stay one
  // premium row at a time.
  const nextDepth = depth === 0 ? ELEVATOR_STARTER_RAIL_ROWS : depth + 1;
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
    ), outcome_insert AS (
      INSERT INTO elevator_upgrade_outcomes
        (request_id, player_id, operation, result)
      SELECT ${requestId}::uuid, ${playerId}, ${operation}, 'accepted'
      WHERE EXISTS (SELECT 1 FROM player_lock)
      ON CONFLICT (request_id) DO NOTHING
      RETURNING request_id
    ), world_update AS (
      UPDATE mine_worlds
      SET diff = ${JSON.stringify(installation.diff)}::jsonb,
          trip_count = trip_count + 1,
          updated_at = now()
      WHERE player_id = ${playerId}
        AND EXISTS (SELECT 1 FROM player_lock)
        AND EXISTS (SELECT 1 FROM outcome_insert)
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
      RETURNING id, emeralds, elevator_depth, elevator_col,
                ladder_count, plank_count,
                pickaxe_level, lamp_level, cargo_level, lantern_level,
                warpcoil_level, blast_level, elevator_speed_level,
                fall_level, recall_level,
                dynamite_count, rope_count, beacon_count
    )
    SELECT player_update.*,
           player_lock.refund_legacy_supports,
           world_update.trip_count AS trip_index
    FROM player_update
    JOIN player_lock ON player_lock.id = player_update.id
    JOIN world_update ON world_update.player_id = player_update.id`) as Array<
    InventoryRow & {
      id: string;
      emeralds: number;
      refund_legacy_supports: boolean;
      trip_index: number;
    }
  >;
  if (updated.length === 0) {
    const state = await reloadElevatorState(sql, playerId);
    const code = classifyElevatorConflict(state, {
      depth,
      column,
      price,
      tripIndex: worldTripCount,
    });
    const message =
      code === "elevator-insufficient-balance"
        ? "not enough vibes for the next rail"
        : code === "elevator-stale-checkpoint"
          ? "the mine changed under your buy; refresh and retry"
          : code === "elevator-stale-rail-state"
            ? "your rail moved; refresh and retry"
            : "another change landed first; refresh and retry";
    return resolveGuardedConflict(code, message, state);
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
      // Bounded placement state, never the player-chosen shaft column (F-121):
      // the exact column is a location coordinate with no economy-tuning value.
      placement: depth === 0 ? "placed" : "extended",
      price,
      refundedLadders,
      refundedPlanks,
      balanceAfter: updated[0].emeralds,
      playerLevel: playerLevelProgress(profile?.defense_xp ?? 0).level,
      deepestDepth,
    });
  } catch {
    // Balance events support tuning, but should not fail a charged rail buy.
  }
  queueSaveSyncPush({
    sql,
    playerId,
    excludeEndpointHash: pushEndpointHashFromRequest(request),
  });
  // The outcome row committed inside the CTE above (transactional outbox).
  // Deliver it now (emit + mark), best-effort; the drain redelivers on a crash
  // before the mark lands.
  await deliverElevatorOutcome(sql, { requestId, playerId, operation });
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
    ...inventoryFromRow(updated[0]),
  });
}
