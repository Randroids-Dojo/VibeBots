import { z } from "zod";
import {
  MINE_VERSION_MISMATCH_CODE,
  TRIP_ALREADY_CASHED_OUT_CODE,
} from "@/lib/api-codes";
import { applyAchievementProgress } from "@/server/achievements";
import { recordBalanceEvent } from "@/server/balance-telemetry";
import { db, storageConfigured } from "@/server/db";
import {
  mineConsumablesSchema,
  mineGearSchema,
} from "@/server/mine-trip-schema";
import { logMineCashOutEvent } from "@/server/monitoring";
import {
  currentPlayerId,
  getMinePlayerProfile,
  getOrCreatePlayerId,
  type MinePlayerProfile,
  mineConsumablesFromProfile,
} from "@/server/player";
import {
  pushEndpointHashFromRequest,
  queueSaveSyncPush,
} from "@/server/save-sync-push";
import {
  BASE_PART_CATALOG,
  BASE_PART_IDS,
  type BasePartId,
  type BasePartInventory,
  type BunkerState,
  createBunker,
  EMPTY_BASE_PART_INVENTORY,
  placeBasePart,
  proposedBunkerFootprint,
  STARTER_BASE_PART_INVENTORY,
} from "@/sim/bunker";
import {
  applyAction,
  cellAt,
  createMine,
  isMineAction,
  LADDER_RECOVERY_FLOOR,
  MAX_TRIP_MOVES,
  MINE_VERSION,
  type MineAction,
  type MineConsumables,
  type MineGear,
  type MineGearTrack,
  normalizeGear,
  PLANK_RECOVERY_FLOOR,
  replayTrip,
  type TripResult,
  type WorldDiff,
} from "@/sim/mine";

export const runtime = "nodejs";
export const maxDuration = 60;

const basePartIdSchema = z.enum(BASE_PART_IDS);
const placedBasePartSchema = z.object({
  partId: basePartIdSchema,
  col: z.number().int(),
  row: z.number().int().min(1),
  durability: z.number().int().min(1).max(1000),
});
const GEAR_LOG_FIELDS = [
  "pickaxe",
  "battery",
  "lamp",
  "cargo",
  "lantern",
  "elevator",
  "warpcoil",
  "blast",
  "elevatorSpeed",
  "fall",
  "recall",
] as const;
const CONSUMABLE_LOG_FIELDS = [
  "dynamite",
  "rope",
  "ladder",
  "plank",
  "beacon",
] as const;

const bodySchema = z.object({
  seed: z.number().int().min(0).max(4294967295),
  // Replay-protection: must match the stored world's trip counter.
  tripIndex: z.number().int().min(0),
  moves: z
    .array(z.string().refine(isMineAction, { message: "invalid mine action" }))
    .min(1)
    .max(MAX_TRIP_MOVES),
  mineVersion: z.number().int(),
  // The gear snapshot the session was played with (Q-007 default B):
  // replay must match what the player saw, validated against ownership.
  // Optional gear tracks that predate a snapshot replay as 1 via normalizeGear.
  gear: mineGearSchema.transform((gear) => normalizeGear(gear)),
  // Client snapshot used as an ownership upper bound. The server derives
  // replay stock from the normalized player row before crediting payout.
  consumables: mineConsumablesSchema,
  pendingBunker: z
    .object({
      claimCol: z.number().int(),
      claimRow: z.number().int().min(1),
      claimedAtMoveCount: z.number().int().min(0).max(MAX_TRIP_MOVES),
      parts: z.array(placedBasePartSchema).max(128),
    })
    .optional(),
});

function valueKind(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function fieldSummary(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const summary: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in value)) continue;
    const fieldValue = value[field];
    summary[field] =
      typeof fieldValue === "number" && Number.isFinite(fieldValue)
        ? fieldValue
        : { type: valueKind(fieldValue) };
  }
  return summary;
}

function cashOutRequestSummary(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) {
    return { bodyType: valueKind(body) };
  }
  return {
    bodyType: "object",
    seed: finiteNumber(body.seed),
    seedType: valueKind(body.seed),
    tripIndex: finiteNumber(body.tripIndex),
    tripIndexType: valueKind(body.tripIndex),
    mineVersion: finiteNumber(body.mineVersion),
    mineVersionType: valueKind(body.mineVersion),
    moveCount: Array.isArray(body.moves) ? body.moves.length : undefined,
    movesType: valueKind(body.moves),
    gear: fieldSummary(body.gear, GEAR_LOG_FIELDS),
    consumables: fieldSummary(body.consumables, CONSUMABLE_LOG_FIELDS),
  };
}

function validationIssueSummary(error: z.ZodError): Array<{
  path: string;
  code: string;
  message: string;
}> {
  return error.issues.slice(0, 12).map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    code: issue.code,
    message: issue.message,
  }));
}

async function currentPlayerIdForLog(): Promise<string | undefined> {
  try {
    return (await currentPlayerId()) ?? undefined;
  } catch {
    return undefined;
  }
}

const PROFILE_GEAR_LEVELS = [
  ["pickaxe", "pickaxe_level", "pickaxe"],
  ["battery", "lamp_level", "battery"],
  ["cargo", "cargo_level", "cargo"],
  ["lantern", "lantern_level", "lantern"],
  ["warpcoil", "warpcoil_level", "warpcoil"],
  ["blast", "blast_level", "blast"],
  ["elevatorSpeed", "elevator_speed_level", "elevator speed"],
  ["fall", "fall_level", "fall harness"],
  ["recall", "recall_level", "recall"],
] as const satisfies ReadonlyArray<
  readonly [
    MineGearTrack,
    keyof Pick<
      MinePlayerProfile,
      | "pickaxe_level"
      | "lamp_level"
      | "cargo_level"
      | "lantern_level"
      | "warpcoil_level"
      | "blast_level"
      | "elevator_speed_level"
      | "fall_level"
      | "recall_level"
    >,
    string,
  ]
>;

export function gearOwnershipError(
  gear: MineGear,
  owned: MinePlayerProfile,
): string | null {
  for (const [track, column, label] of PROFILE_GEAR_LEVELS) {
    if ((gear[track] ?? 1) > owned[column]) {
      return `gear not owned: ${label} level ${gear[track]}`;
    }
  }
  if (gear.elevator > owned.elevator_depth) {
    return `rail not owned: depth ${gear.elevator}`;
  }
  return null;
}

export function paidConsumableSnapshotExceedsOwned(
  submitted: MineConsumables,
  owned: MineConsumables,
): boolean {
  return (
    submitted.dynamite > owned.dynamite ||
    submitted.rope > owned.rope ||
    submitted.beacon > owned.beacon
  );
}

export function replayConsumablesForCashOut(
  submitted: MineConsumables,
  ownedRow: MinePlayerProfile,
): { consumables: MineConsumables; usedLegacySupportSnapshot: boolean } {
  const owned = mineConsumablesFromProfile(ownedRow);
  if (ownedRow.legacy_support_snapshot_reconciled_at) {
    return { consumables: owned, usedLegacySupportSnapshot: false };
  }
  const ladder = Math.max(
    owned.ladder,
    Math.min(submitted.ladder, LADDER_RECOVERY_FLOOR),
  );
  const plank = Math.max(
    owned.plank,
    Math.min(submitted.plank, PLANK_RECOVERY_FLOOR),
  );
  return {
    consumables: { ...owned, ladder, plank },
    usedLegacySupportSnapshot: ladder > owned.ladder || plank > owned.plank,
  };
}

export function chargeableConsumables(trip: TripResult): MineConsumables {
  return {
    dynamite: trip.used.dynamite,
    rope: trip.used.rope,
    ladder: Math.max(0, trip.used.ladder - trip.granted.ladder),
    plank: Math.max(0, trip.used.plank - trip.granted.plank),
    beacon: trip.used.beacon,
  };
}

type PendingBunkerInput = NonNullable<
  z.infer<typeof bodySchema>["pendingBunker"]
>;

type PendingBunkerValidation =
  | { ok: true; bunker: BunkerState; inventory: BasePartInventory }
  | { ok: false; error: string };

function isBasePartId(value: string): value is BasePartId {
  return BASE_PART_IDS.includes(value as BasePartId);
}

function pendingBunkerInventoryFromRows(
  rows: Array<{ part_id: string; count: number }>,
): BasePartInventory {
  if (rows.length === 0) return { ...STARTER_BASE_PART_INVENTORY };
  const inventory = { ...EMPTY_BASE_PART_INVENTORY };
  const ownedPartIds = new Set<string>();
  for (const row of rows) {
    if (!isBasePartId(row.part_id)) continue;
    ownedPartIds.add(row.part_id);
    inventory[row.part_id] = Math.max(0, Number(row.count) || 0);
  }
  for (const [partId, count] of Object.entries(STARTER_BASE_PART_INVENTORY)) {
    if (count <= 0 || ownedPartIds.has(partId)) continue;
    inventory[partId as BasePartId] = count;
  }
  return inventory;
}

function samePlacedParts(
  left: BunkerState["parts"],
  right: BunkerState["parts"],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validatePendingBunkerClaim(
  pending: PendingBunkerInput,
  seed: number,
  gear: MineGear,
  consumables: MineConsumables,
  baseDiff: WorldDiff,
  moves: MineAction[],
  inventory: BasePartInventory,
): PendingBunkerValidation {
  if (pending.claimedAtMoveCount > moves.length) {
    return { ok: false, error: "invalid bunker claim checkpoint" };
  }
  const footprint = proposedBunkerFootprint(pending.claimCol, pending.claimRow);
  if (footprint.row < 1) {
    return { ok: false, error: "bunker claim is too close to the surface" };
  }
  const claimState = createMine(seed, gear, consumables, baseDiff);
  for (const action of moves.slice(0, pending.claimedAtMoveCount)) {
    applyAction(claimState, action);
  }
  if (
    claimState.miner.col !== pending.claimCol ||
    claimState.miner.row !== pending.claimRow
  ) {
    return { ok: false, error: "bunker claim position changed" };
  }
  for (let row = footprint.row; row < footprint.row + footprint.height; row++) {
    for (
      let col = footprint.col;
      col < footprint.col + footprint.width;
      col++
    ) {
      if (cellAt(claimState, col, row)?.kind !== "empty") {
        return { ok: false, error: "clear the full 7x5 claim first" };
      }
    }
  }
  let bunker = createBunker(footprint);
  let remaining = { ...inventory };
  for (const part of pending.parts) {
    if (part.durability !== BASE_PART_CATALOG[part.partId].durability) {
      return { ok: false, error: "invalid bunker part durability" };
    }
    const placed = placeBasePart(
      bunker,
      remaining,
      part.partId,
      part.col,
      part.row,
    );
    if (!placed.ok) {
      return { ok: false, error: `cannot place bunker part: ${placed.reason}` };
    }
    bunker = placed.bunker;
    remaining = placed.inventory;
  }
  if (!samePlacedParts(bunker.parts, pending.parts)) {
    return { ok: false, error: "invalid bunker part layout" };
  }
  return { ok: true, bunker, inventory: remaining };
}

export function achievementProgressForTrip(
  trip: TripResult,
  actions: readonly MineAction[],
) {
  const soldLoot = trip.bankedCredits > 0 || trip.bankedParts.length > 0;
  return {
    sales: soldLoot ? 1 : 0,
    maxTripVibes: trip.bankedCredits,
    partsBanked: trip.bankedParts.length,
    bagDrops: trip.bagDrops,
    laddersPlaced: trip.used.ladder,
    planksPlaced: trip.used.plank,
    recallsWithLoot: actions.includes("recall") && soldLoot ? 1 : 0,
    recoveries: trip.granted.ladder > 0 || trip.granted.plank > 0 ? 1 : 0,
    beaconsPlanted: trip.used.beacon,
    elevatorRides: actions.filter(
      (action) => action === "ride-down" || action === "ride-up",
    ).length,
  };
}

/**
 * Cash out a mining session. The mine is a pure function of (seed,
 * moves), so the server replays the submitted log and credits exactly
 * what an honest client banked. The deepest-depth record still advances
 * for stamp progress, but it no longer pays bonus vibes.
 */
export async function POST(request: Request): Promise<Response> {
  if (!storageConfigured()) {
    logMineCashOutEvent({
      code: "storage_not_configured",
      severity: "error",
      detail: "persistent storage is not configured",
    });
    return Response.json({ error: "storage not configured" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logMineCashOutEvent({
      code: "invalid_json_body",
      severity: "warn",
      playerId: await currentPlayerIdForLog(),
      detail: "request body could not be parsed as JSON",
    });
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    logMineCashOutEvent({
      code: "request_validation_failed",
      severity: "warn",
      playerId: await currentPlayerIdForLog(),
      request: cashOutRequestSummary(body),
      issues: validationIssueSummary(parsed.error),
    });
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  const existingPlayerId = await currentPlayerIdForLog();
  const requestLogContext = {
    tripIndex: parsed.data.tripIndex,
    moveCount: parsed.data.moves.length,
    seed: parsed.data.seed,
  };
  const requestPlayerLogContext = {
    playerId: existingPlayerId,
    ...requestLogContext,
  };
  if (parsed.data.mineVersion !== MINE_VERSION) {
    // Generation rules changed under a live session; re-pricing the old
    // log would not match what the player saw.
    logMineCashOutEvent({
      code: MINE_VERSION_MISMATCH_CODE,
      severity: "warn",
      ...requestPlayerLogContext,
      mineVersion: parsed.data.mineVersion,
      expectedMineVersion: MINE_VERSION,
    });
    return Response.json(
      {
        error: "the mine has shifted since this trip started; start fresh",
        code: MINE_VERSION_MISMATCH_CODE,
        expectedMineVersion: MINE_VERSION,
      },
      { status: 409 },
    );
  }

  const playerId = existingPlayerId ?? (await getOrCreatePlayerId());
  const playerLogContext = { playerId, ...requestLogContext };
  const sql = await db();

  // The persistent world checkpoint (REQ-026): the trip replays on top
  // of the stored diff; seed and trip counter must match.
  const worlds = (await sql`
    SELECT seed, diff, trip_count FROM mine_worlds
    WHERE player_id = ${playerId}`) as Array<{
    seed: string | number;
    diff: unknown;
    trip_count: number;
  }>;
  if (worlds.length === 0) {
    logMineCashOutEvent({
      code: "no_mine_on_file",
      severity: "warn",
      ...playerLogContext,
    });
    return Response.json({ error: "no mine on file" }, { status: 409 });
  }
  if (Number(worlds[0].seed) !== parsed.data.seed) {
    logMineCashOutEvent({
      code: "wrong_mine_seed",
      severity: "error",
      ...playerLogContext,
      detail: `stored seed ${Number(worlds[0].seed)}`,
    });
    return Response.json({ error: "wrong mine seed" }, { status: 422 });
  }
  if (worlds[0].trip_count !== parsed.data.tripIndex) {
    logMineCashOutEvent({
      code: TRIP_ALREADY_CASHED_OUT_CODE,
      severity: "warn",
      ...playerLogContext,
      worldTripIndex: worlds[0].trip_count,
    });
    return Response.json(
      { error: "this trip was already cashed out; reload the mine" },
      { status: 409 },
    );
  }

  // Gear ownership check: claiming better gear than you own is the only
  // way the snapshot could inflate a payout.
  const ownedRow = await getMinePlayerProfile(sql, playerId);
  if (!ownedRow) {
    logMineCashOutEvent({
      code: "player_not_found",
      severity: "error",
      ...playerLogContext,
    });
    return Response.json({ error: "player not found" }, { status: 409 });
  }
  const gear = parsed.data.gear;
  const gearError = gearOwnershipError(gear, ownedRow);
  if (gearError) {
    logMineCashOutEvent({
      code: "gear_not_owned",
      severity: "error",
      ...playerLogContext,
      detail: gearError,
      submitted: gear,
    });
    return Response.json({ error: gearError }, { status: 422 });
  }
  const submittedConsumables = parsed.data.consumables;
  const ownedConsumables = mineConsumablesFromProfile(ownedRow);
  if (
    paidConsumableSnapshotExceedsOwned(submittedConsumables, ownedConsumables)
  ) {
    logMineCashOutEvent({
      code: "consumables_not_owned",
      severity: "error",
      ...playerLogContext,
      detail: "paid consumable overclaim",
      submitted: submittedConsumables,
      owned: ownedConsumables,
    });
    return Response.json({ error: "consumables not owned" }, { status: 422 });
  }
  const replayStock = replayConsumablesForCashOut(
    submittedConsumables,
    ownedRow,
  );
  const replayConsumables = replayStock.consumables;
  const baseDiff = (worlds[0].diff ?? []) as WorldDiff;
  const actions = parsed.data.moves as MineAction[];
  if (parsed.data.pendingBunker !== undefined) {
    const existingBunker = (await sql`
      SELECT player_id
      FROM bunkers
      WHERE player_id = ${playerId}
      LIMIT 1`) as Array<{ player_id: string }>;
    if (existingBunker.length > 0) {
      logMineCashOutEvent({
        code: "cash_out_failed",
        severity: "warn",
        ...playerLogContext,
        detail: "bunker already claimed",
      });
      return Response.json(
        { error: "bunker already claimed" },
        { status: 409 },
      );
    }
  }
  let pendingBunker: PendingBunkerValidation | null = null;
  if (parsed.data.pendingBunker !== undefined) {
    const rows = (await sql`
      SELECT part_id, count
      FROM player_base_parts
      WHERE player_id = ${playerId}`) as Array<{
      part_id: string;
      count: number;
    }>;
    pendingBunker = validatePendingBunkerClaim(
      parsed.data.pendingBunker,
      parsed.data.seed,
      gear,
      replayConsumables,
      baseDiff,
      actions,
      pendingBunkerInventoryFromRows(rows),
    );
  }
  if (pendingBunker && !pendingBunker.ok) {
    logMineCashOutEvent({
      code: "cash_out_failed",
      severity: "warn",
      ...playerLogContext,
      detail: pendingBunker.error,
    });
    return Response.json({ error: pendingBunker.error }, { status: 409 });
  }
  const trip = replayTrip(
    parsed.data.seed,
    actions,
    gear,
    replayConsumables,
    baseDiff,
  );
  const chargedConsumables = chargeableConsumables(trip);
  const claimedBunker = pendingBunker?.ok ? pendingBunker.bunker : null;
  const bunkerInventory = pendingBunker?.ok ? pendingBunker.inventory : null;
  const hasPendingBunker = claimedBunker !== null;
  if (replayStock.usedLegacySupportSnapshot) {
    logMineCashOutEvent({
      code: "legacy_support_reconciled",
      severity: "warn",
      ...playerLogContext,
      submitted: submittedConsumables,
      owned: ownedConsumables,
      replay: replayConsumables,
      charged: chargedConsumables,
      credited: {
        credits: trip.bankedCredits,
        parts: trip.bankedParts.length,
        soldHaul: trip.soldHaul,
      },
    });
  }
  // Zero-bank trips are legitimate now: carving and laddering are
  // world investments worth checkpointing even with an empty hold.
  // One statement = atomic on the neon HTTP driver (no cross-statement
  // transactions): consume the seed, credit the wallet, advance the
  // depth record, and grant the parts together, or not at all.
  const rows = (await sql`
    WITH world AS (
      UPDATE mine_worlds
      SET diff = ${JSON.stringify(trip.diff)}::jsonb,
          trip_count = trip_count + 1,
          updated_at = now()
      WHERE player_id = ${playerId}
        AND trip_count = ${parsed.data.tripIndex}
        AND (
          ${!hasPendingBunker}
          OR NOT EXISTS (
            SELECT 1 FROM bunkers WHERE player_id = ${playerId}
          )
        )
      RETURNING trip_count
    ), upd AS (
      UPDATE players
      SET emeralds = emeralds + ${trip.bankedCredits},
          deepest_depth = GREATEST(deepest_depth, ${trip.maxDepth}),
          dynamite_count = GREATEST(0, dynamite_count - ${chargedConsumables.dynamite}),
          rope_count = GREATEST(0, rope_count - ${chargedConsumables.rope}),
          ladder_count = GREATEST(0, ladder_count - ${chargedConsumables.ladder}),
          plank_count = GREATEST(0, plank_count - ${chargedConsumables.plank}),
          beacon_count = GREATEST(0, beacon_count - ${chargedConsumables.beacon}),
          legacy_support_snapshot_reconciled_at = COALESCE(
            legacy_support_snapshot_reconciled_at,
            now()
          )
      WHERE id = ${playerId} AND EXISTS (SELECT 1 FROM world)
      RETURNING emeralds, deepest_depth, dynamite_count, rope_count,
        ladder_count, plank_count, beacon_count
    ), granted AS (
      INSERT INTO player_parts (player_id, part_id, count)
      SELECT ${playerId}, value, count(*)::int
      FROM jsonb_array_elements_text(${JSON.stringify(trip.bankedParts)}::jsonb)
      WHERE EXISTS (SELECT 1 FROM world)
      GROUP BY value
      ON CONFLICT (player_id, part_id)
      DO UPDATE SET count = player_parts.count + EXCLUDED.count
    ), claimed_bunker AS (
      INSERT INTO bunkers (player_id, footprint, core, parts)
      SELECT
        ${playerId},
        ${JSON.stringify(claimedBunker?.footprint ?? {})}::jsonb,
        ${JSON.stringify(claimedBunker?.core ?? {})}::jsonb,
        ${JSON.stringify(claimedBunker?.parts ?? [])}::jsonb
      WHERE ${hasPendingBunker} AND EXISTS (SELECT 1 FROM world)
      ON CONFLICT (player_id) DO NOTHING
      RETURNING player_id
    ), base_part_updates AS (
      INSERT INTO player_base_parts (player_id, part_id, count)
      SELECT ${playerId}, key, value::int
      FROM jsonb_each_text(${JSON.stringify(bunkerInventory ?? {})}::jsonb)
      WHERE
        ${hasPendingBunker}
        AND EXISTS (SELECT 1 FROM claimed_bunker)
      ON CONFLICT (player_id, part_id)
      DO UPDATE SET count = EXCLUDED.count
      RETURNING part_id
    )
    SELECT
      (SELECT emeralds FROM upd) AS emeralds,
      (SELECT deepest_depth FROM upd) AS deepest_depth,
      (SELECT dynamite_count FROM upd) AS dynamite_count,
      (SELECT rope_count FROM upd) AS rope_count,
      (SELECT ladder_count FROM upd) AS ladder_count,
      (SELECT plank_count FROM upd) AS plank_count,
      (SELECT beacon_count FROM upd) AS beacon_count,
      (SELECT trip_count FROM world) AS trip_count,
      EXISTS (SELECT 1 FROM claimed_bunker) AS bunker_claimed`) as Array<{
    emeralds: number | null;
    deepest_depth: number | null;
    dynamite_count: number | null;
    rope_count: number | null;
    ladder_count: number | null;
    plank_count: number | null;
    beacon_count: number | null;
    trip_count: number | null;
    bunker_claimed: boolean | null;
  }>;
  if (rows[0]?.emeralds === null || rows[0]?.emeralds === undefined) {
    logMineCashOutEvent({
      code: "cash_out_failed",
      severity: "error",
      ...playerLogContext,
      worldTripIndex: worlds[0].trip_count,
      detail: "atomic update returned no row",
    });
    return Response.json(
      { error: "this trip was already cashed out" },
      { status: 409 },
    );
  }
  let newStamps: string[] = [];
  try {
    newStamps = await applyAchievementProgress(
      sql,
      playerId,
      achievementProgressForTrip(trip, parsed.data.moves as MineAction[]),
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        source: "vibebots",
        component: "achievements",
        event: "achievements.progress_failed",
        code: "achievement_progress_failed",
        severity: "warn",
        detail: error instanceof Error ? error.message : "unknown error",
      }),
    );
  }
  const remainingConsumables = {
    dynamite: rows[0].dynamite_count ?? 0,
    rope: rows[0].rope_count ?? 0,
    ladder: rows[0].ladder_count ?? 0,
    plank: rows[0].plank_count ?? 0,
    beacon: rows[0].beacon_count ?? 0,
  };
  logMineCashOutEvent({
    code: "cash_out_succeeded",
    severity: "info",
    ...playerLogContext,
    mineVersion: parsed.data.mineVersion,
    submitted: submittedConsumables,
    owned: ownedConsumables,
    replay: replayConsumables,
    charged: chargedConsumables,
    credited: {
      credits: trip.bankedCredits,
      parts: trip.bankedParts.length,
      soldHaul: trip.soldHaul,
      bunkerClaimed: rows[0].bunker_claimed === true,
    },
    remaining: remainingConsumables,
    worldTripIndex: rows[0].trip_count ?? parsed.data.tripIndex + 1,
  });
  try {
    await recordBalanceEvent(sql, playerId, "mine.cash_out", {
      seed: parsed.data.seed,
      tripIndex: rows[0].trip_count ?? parsed.data.tripIndex + 1,
      moves: trip.moves,
      maxDepth: trip.maxDepth,
      bankedVibes: trip.bankedCredits,
      partsBanked: trip.bankedParts.length,
      salvageVibes: trip.soldHaul?.salvageCredits ?? 0,
      soldVibes: trip.soldHaul?.totalVibes ?? trip.bankedCredits,
      balanceAfter: rows[0].emeralds ?? 0,
      deepestDepthAfter: rows[0].deepest_depth ?? trip.maxDepth,
      dynamiteUsed: trip.used.dynamite,
      ropeUsed: trip.used.rope,
      ladderUsed: trip.used.ladder,
      plankUsed: trip.used.plank,
      beaconUsed: trip.used.beacon,
      pickaxeLevel: parsed.data.gear.pickaxe,
      batteryLevel: parsed.data.gear.battery,
      cargoLevel: parsed.data.gear.cargo,
      lanternLevel: parsed.data.gear.lantern,
      warpcoilLevel: parsed.data.gear.warpcoil,
      blastLevel: parsed.data.gear.blast ?? 1,
      elevatorSpeedLevel: parsed.data.gear.elevatorSpeed ?? 1,
      fallLevel: parsed.data.gear.fall ?? 1,
      elevatorDepth: parsed.data.gear.elevator,
    });
  } catch {
    // Balance events support tuning, but should not fail a completed cash-out.
  }
  // Wake the account's other devices so they resync before mining a doomed
  // trip; the response never waits on push delivery.
  queueSaveSyncPush({
    sql,
    playerId,
    excludeEndpointHash: pushEndpointHashFromRequest(request),
  });
  return Response.json({
    credited: {
      credits: trip.bankedCredits,
      parts: trip.bankedParts,
      milestoneBonus: 0,
      soldHaul: trip.soldHaul,
    },
    balance: rows[0].emeralds,
    deepestDepth: rows[0].deepest_depth,
    tripIndex: rows[0].trip_count ?? parsed.data.tripIndex + 1,
    consumables: remainingConsumables,
    bunkerClaimed: rows[0].bunker_claimed === true,
    newStamps,
  });
}
