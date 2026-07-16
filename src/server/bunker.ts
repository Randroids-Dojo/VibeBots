import {
  BUNKER_LAYOUT_INCOMPATIBLE_CODE,
  BUNKER_REVISION_CONFLICT_CODE,
} from "@/lib/api-codes";
import type { BunkerView, LiveRaidActiveView } from "@/lib/bunker-api-types";
import {
  applyBunkerRepairs,
  applyBunkerReset,
  applyBunkerStartFresh,
  BASE_PART_CATALOG,
  BASE_PART_IDS,
  type BasePartId,
  type BasePartInventory,
  BUNKER_CLAIM_DEPTH,
  BUNKER_LAYOUT_VERSION,
  BUNKER_RAID_COOLDOWN_HOURS,
  BUNKER_RAID_DURATION_SECONDS,
  BUNKER_SKIN_CATALOG,
  type BunkerFootprint,
  type BunkerLoot,
  type BunkerRaidRewardReport,
  type BunkerSkinId,
  type BunkerState,
  basePartOwnedLimit,
  bunkerCells,
  bunkerRepairPlan,
  canBuyBasePart,
  createBunker,
  DEFAULT_BUNKER_SKIN,
  type DugBunkerCell,
  EMPTY_BASE_PART_INVENTORY,
  excavateBunkerCell,
  isBunkerLayoutIncompatible,
  isBunkerSkinId,
  maxBunkerRaidTier,
  moveBasePart,
  overallPlayerLevel,
  placeBasePart,
  playerLevelProgress,
  proposedBunkerFootprint,
  removeBasePart,
  STARTER_BASE_PART_INVENTORY,
  takeBunkerLootAt,
} from "@/sim/bunker";
import {
  bunkerCellOreYield,
  deriveBunkerBlockSeed,
  withSpawnPocket,
} from "@/sim/bunker-blocks";
import {
  BUNKER_RAID_LIVE_VERSION,
  LIVE_RAID_EXPIRY_GRACE_TICKS,
  LIVE_RAID_TICKS_PER_SECOND,
  type LiveRaidOutcomeReport,
  settleLiveRaidOutcome,
} from "@/sim/bunker-raid-live";
import {
  cellAt,
  createMine,
  DEFAULT_GEAR,
  NO_CONSUMABLES,
  type OreId,
  oreDef,
  type WorldDiff,
} from "@/sim/mine";
import { applyAchievementProgress } from "./achievements";
import type { OperationFailure } from "./api-boundary";
import { recordBalanceEvent } from "./balance-telemetry";
import type { db } from "./db";

type Sql = Awaited<ReturnType<typeof db>>;

type BunkerOperationResult<T extends object = object> =
  | ({ ok: true; view: BunkerView } & T)
  | OperationFailure;

/**
 * A banked edit lost its optimistic-concurrency race (the client's
 * expected revision no longer matches, or a concurrent write won the
 * guarded update). The 409 carries the authoritative view so the client
 * replaces its stale state instead of retrying blind.
 */
function revisionConflict(view: BunkerView): OperationFailure {
  return {
    ok: false,
    status: 409,
    error: "bunker changed elsewhere, refreshed",
    code: BUNKER_REVISION_CONFLICT_CODE,
    body: { ...view },
  };
}

/**
 * A bunker whose persisted layout predates the current placement model
 * cannot be edited (F-117). Every mutation entry point returns this so a
 * legacy bunker fails fast and the client shows Start fresh (Q-022); the
 * distinct code lets a racing client force the prompt. Returns null when
 * the bunker is compatible, so callers guard with a single `?? next` check.
 */
function layoutIncompatibleFailure(
  bunker: BunkerState,
): OperationFailure | null {
  if (!isBunkerLayoutIncompatible(bunker)) return null;
  return {
    ok: false,
    status: 409,
    error: "start fresh to rebuild under the new bunker layout",
    code: BUNKER_LAYOUT_INCOMPATIBLE_CODE,
  };
}

/**
 * The revision the guarded write must match. A client that sends its
 * expected revision gets full stale detection: if it no longer matches
 * the stored value the write is rejected before it runs. An older client
 * that omits it falls back to the loaded revision, which still serializes
 * concurrent writes through the guarded UPDATE. Returns null when the
 * caller's expected revision is already stale.
 */
function resolveExpectedRevision(
  view: BunkerView,
  expectedRevision: number | undefined,
): number | null {
  if (expectedRevision === undefined) return view.revision;
  return expectedRevision === view.revision ? expectedRevision : null;
}

function isBasePartId(value: string): value is BasePartId {
  return BASE_PART_IDS.includes(value as BasePartId);
}

function parseBasePartInventory(
  rows: Array<{ part_id: string; count: number }>,
) {
  const inventory = { ...EMPTY_BASE_PART_INVENTORY };
  for (const row of rows) {
    if (isBasePartId(row.part_id)) {
      inventory[row.part_id] = Math.max(0, Number(row.count) || 0);
    }
  }
  return inventory;
}

/** Legacy rows predate the depth axis; anything malformed lands on the
 * tunnel plane (depth 0) so old bunkers keep their exact 2D behavior. */
function normalizedBunkerDepth(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < BUNKER_CLAIM_DEPTH
    ? value
    : 0;
}

function normalizedDugCells(value: unknown): DugBunkerCell[] {
  if (!Array.isArray(value)) return [];
  return value.filter((cell): cell is DugBunkerCell => {
    if (!cell || typeof cell !== "object") return false;
    const candidate = cell as Record<string, unknown>;
    return (
      typeof candidate.col === "number" &&
      Number.isInteger(candidate.col) &&
      typeof candidate.row === "number" &&
      Number.isInteger(candidate.row) &&
      typeof candidate.depth === "number" &&
      Number.isInteger(candidate.depth) &&
      // Depth 0 (the floor plane) is diggable too, and the spawn pocket
      // ships as depth-0 dug cells (F-115), so keep them on normalize.
      candidate.depth >= 0 &&
      candidate.depth < BUNKER_CLAIM_DEPTH
    );
  });
}

/** Coerce a stored block seed (bigint arrives as string) to an unsigned
 * 32-bit integer, or undefined for legacy claims that predate F-116. */
function normalizedBlockSeed(value: unknown): number | undefined {
  const n =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "string"
        ? Number(value)
        : typeof value === "number"
          ? value
          : Number.NaN;
  if (!Number.isFinite(n)) return undefined;
  return n >>> 0;
}

/** Keep only well-formed overflow-loot entries (F-116): a 3D cell plus a
 * positive-integer ore pile. Malformed entries drop rather than throw. */
function normalizedBunkerLoot(value: unknown): BunkerLoot[] {
  if (!Array.isArray(value)) return [];
  const loot: BunkerLoot[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    if (
      !Number.isInteger(candidate.col) ||
      !Number.isInteger(candidate.row) ||
      !Number.isInteger(candidate.depth) ||
      !candidate.ores ||
      typeof candidate.ores !== "object"
    ) {
      continue;
    }
    const ores: BunkerLoot["ores"] = {};
    for (const [id, n] of Object.entries(candidate.ores as object)) {
      if (typeof n === "number" && Number.isInteger(n) && n > 0) {
        ores[id as keyof BunkerLoot["ores"]] = n;
      }
    }
    if (Object.keys(ores).length === 0) continue;
    loot.push({
      col: candidate.col as number,
      row: candidate.row as number,
      depth: candidate.depth as number,
      ores,
    });
  }
  return loot;
}

function parseBunkerState(
  row: {
    footprint: unknown;
    parts: unknown;
    dug?: unknown;
    block_seed?: unknown;
    loot?: unknown;
    skin?: unknown;
    skins_owned?: unknown;
    layout_version?: unknown;
  } | null,
): BunkerState | null {
  if (!row) return null;
  const footprint = row.footprint as BunkerFootprint;
  const parts = Array.isArray(row.parts) ? row.parts : [];
  const skinsOwned = Array.isArray(row.skins_owned)
    ? row.skins_owned.filter(isBunkerSkinId)
    : [];
  return {
    footprint,
    // Layout-model version (F-117). Absent or non-numeric means a row that
    // predates the column: legacy 0, which reads as incompatible.
    layoutVersion:
      typeof row.layout_version === "number" ? row.layout_version : 0,
    // Guarantee an open spawn pocket even for legacy claims stored under
    // the old depth-0-open model (F-115), so nobody spawns in solid rock.
    dug: withSpawnPocket(footprint, normalizedDugCells(row.dug)),
    // bigint arrives as a string from the driver; coerce, and treat a
    // missing seed as undefined (legacy claims, F-116).
    blockSeed: normalizedBlockSeed(row.block_seed),
    loot: normalizedBunkerLoot(row.loot),
    skin: isBunkerSkinId(row.skin) ? row.skin : DEFAULT_BUNKER_SKIN,
    skinsOwned,
    parts: parts
      .filter((part): part is BunkerState["parts"][number] => {
        if (!part || typeof part !== "object") return false;
        const candidate = part as Record<string, unknown>;
        return (
          typeof candidate.col === "number" &&
          typeof candidate.row === "number" &&
          typeof candidate.durability === "number" &&
          typeof candidate.partId === "string" &&
          isBasePartId(candidate.partId)
        );
      })
      .map((part) => ({ ...part, depth: normalizedBunkerDepth(part.depth) })),
  };
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Server grace beyond a live raid's authored duration before it is treated
 * as expired, in seconds (mirrors the sim's tick-based grace). */
const LIVE_RAID_GRACE_SECONDS =
  LIVE_RAID_EXPIRY_GRACE_TICKS / LIVE_RAID_TICKS_PER_SECOND;

/** The frozen bunker snapshot persisted when a live raid starts (F-108). The
 * bunker is stored in the bunkers-row shape so `parseBunkerState` reads it
 * back with the same normalization the live view and settlement rely on. */
interface LiveRaidStartSnapshot {
  version: number;
  raidId: string;
  tier: number;
  durationSeconds: number;
  bunker: BunkerState;
  // The bunker revision frozen at raid start (F-106). Raid start never bumps
  // the bunkers row and every edit path is blocked while a raid is active, so
  // this stays equal to the live revision until settlement. The settlement
  // parts-write contends on it, so a bunker edit racing in the window after
  // the raid row is claimed (which flips the raid inactive) makes exactly one
  // of the two win instead of the settlement silently overwriting the edit. A
  // snapshot written before this field existed reads back as null (no guard).
  revision: number | null;
}

/** Serialize a BunkerState into the bunkers-row shape used inside a frozen
 * live-raid snapshot, so it round-trips through `parseBunkerState`. */
function bunkerRowSnapshot(bunker: BunkerState) {
  return {
    footprint: bunker.footprint,
    parts: bunker.parts,
    dug: bunker.dug,
    block_seed: bunker.blockSeed,
    loot: bunker.loot,
    skin: bunker.skin,
    skins_owned: bunker.skinsOwned,
    // Freeze the layout generation the raid ran against (F-117), so
    // settlement can refuse to write its worn parts back if a Start fresh
    // advanced the bunker past this generation in the meantime. A snapshot
    // written before this field existed reads back as legacy 0.
    layout_version: bunker.layoutVersion ?? 0,
  };
}

function normalizeLiveRaidStartSnapshot(
  snapshot: unknown,
): LiveRaidStartSnapshot | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const candidate = snapshot as Partial<LiveRaidStartSnapshot> & {
    bunker?: unknown;
  };
  if (typeof candidate.raidId !== "string") return null;
  const bunker = parseBunkerState(
    candidate.bunker && typeof candidate.bunker === "object"
      ? (candidate.bunker as Parameters<typeof parseBunkerState>[0])
      : null,
  );
  if (!bunker) return null;
  return {
    version: numberValue(candidate.version, BUNKER_RAID_LIVE_VERSION),
    raidId: candidate.raidId,
    tier: numberValue(candidate.tier, 1),
    durationSeconds: numberValue(
      candidate.durationSeconds,
      BUNKER_RAID_DURATION_SECONDS,
    ),
    bunker,
    revision:
      typeof candidate.revision === "number" &&
      Number.isFinite(candidate.revision)
        ? candidate.revision
        : null,
  };
}

/** Build the client-facing view of a live raid from its stored row, or null
 * when the snapshot is unreadable or the raid has run past duration + grace
 * (an expired raid is reported inactive so it never wedges bunker ops). */
function liveRaidActiveViewFrom(
  snapshot: unknown,
  startedAt: string | Date,
): LiveRaidActiveView | null {
  const start = normalizeLiveRaidStartSnapshot(snapshot);
  if (!start) return null;
  const startedAtMs = new Date(startedAt).getTime();
  const expiresAtMs =
    startedAtMs + (start.durationSeconds + LIVE_RAID_GRACE_SECONDS) * 1000;
  if (Date.now() >= expiresAtMs) return null;
  return {
    raidId: start.raidId,
    tier: start.tier,
    startedAtMs,
    durationSeconds: start.durationSeconds,
    graceSeconds: LIVE_RAID_GRACE_SECONDS,
    bunker: start.bunker,
  };
}

/** True when any raid, interim or live, is currently blocking bunker
 * operations. A live raid past its grace is not active (it returns null from
 * `liveRaidActiveViewFrom`), so it never blocks. */
function bunkerRaidActive(view: BunkerView): boolean {
  return view.activeLiveRaid != null;
}

/** Settle any stale past-grace live raid row as a forfeit loss (no reward, no
 * wear), so an abandoned raid closes lazily on the next load or bunker op
 * (F-105) rather than lingering unresolved. Idempotent: the `result IS NULL`
 * guard means a row settles at most once. */
async function finalizeExpiredLiveRaids(
  sql: Sql,
  playerId: string,
): Promise<void> {
  await sql`
    UPDATE bunker_raids
    SET result = ${JSON.stringify({ outcome: "forfeit", survived: false })}::jsonb,
        rewarded_at = now()
    WHERE player_id = ${playerId}
      AND result IS NULL
      AND raid_version = ${BUNKER_RAID_LIVE_VERSION}
      AND started_at
        < now() - make_interval(secs => duration_seconds + ${LIVE_RAID_GRACE_SECONDS})`;
}

/**
 * Forfeit the active live raid on demand (F-160). Leaving the first-person
 * view mid-raid abandons the fight: the row settles as a forfeit now (no
 * reward, no wear), exactly like the expiry path but without waiting out the
 * duration and grace. This closes the raid immediately so re-entering
 * first person cannot spin up a fresh runtime against the same row and
 * re-roll the outcome. Idempotent via the `result IS NULL` guard: a natural
 * resolve (or a prior forfeit) that already claimed the row wins, and this
 * becomes a no-op that just returns the current view.
 */
export async function forfeitLiveRaid(
  sql: Sql,
  playerId: string,
): Promise<BunkerOperationResult> {
  await sql`
    UPDATE bunker_raids
    SET result = ${JSON.stringify({ outcome: "forfeit", survived: false })}::jsonb,
        rewarded_at = now()
    WHERE player_id = ${playerId}
      AND result IS NULL
      AND raid_version = ${BUNKER_RAID_LIVE_VERSION}`;
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

async function ensureStarterBaseParts(
  sql: Sql,
  playerId: string,
): Promise<BasePartInventory> {
  const rows = (await sql`
    SELECT part_id, count
    FROM player_base_parts
    WHERE player_id = ${playerId}`) as Array<{
    part_id: string;
    count: number;
  }>;
  if (rows.length > 0) {
    const inventory = parseBasePartInventory(rows);
    const ownedPartIds = new Set(rows.map((row) => row.part_id));
    for (const [partId, count] of Object.entries(STARTER_BASE_PART_INVENTORY)) {
      if (count <= 0 || ownedPartIds.has(partId)) continue;
      await sql`
        INSERT INTO player_base_parts (player_id, part_id, count)
        VALUES (${playerId}, ${partId}, ${count})`;
      inventory[partId as BasePartId] = count;
    }
    return inventory;
  }
  for (const [partId, count] of Object.entries(STARTER_BASE_PART_INVENTORY)) {
    await sql`
      INSERT INTO player_base_parts (player_id, part_id, count)
      VALUES (${playerId}, ${partId}, ${count})`;
  }
  return { ...STARTER_BASE_PART_INVENTORY };
}

/**
 * Backfill a bunker claimed before block seeds existed (F-116). A null
 * block_seed makes every undug cell render as plain dirt and pay no ore, so
 * an old bunker looks empty, and Start fresh never wrote the column, so a
 * reset does not fix it. Derive the same deterministic seed a fresh claim
 * would use from the player's mine seed and this footprint, persist it
 * once, and return the seeded bunker so its walls generate the mine's
 * dirt, rock, and ore for that depth. The write is guarded on the column
 * still being NULL, so it is idempotent and never overwrites a real seed
 * or bumps the revision (it is a data backfill, not a player edit). A
 * player with no mine world row yet cannot derive a seed, so the bunker is
 * returned unchanged. Only remaining undug cells ever pay ore, so filling
 * the seed never re-credits cells the player already dug (banked digs
 * credit at excavate time; a pending claim is always seeded at claim).
 */
async function backfillMissingBlockSeed(
  sql: Sql,
  playerId: string,
  bunker: BunkerState,
): Promise<BunkerState> {
  if (bunker.blockSeed !== undefined) return bunker;
  const worlds = (await sql`
    SELECT seed
    FROM mine_worlds
    WHERE player_id = ${playerId}`) as Array<{ seed: string | number }>;
  if (worlds[0] === undefined) return bunker;
  const blockSeed = deriveBunkerBlockSeed(
    Number(worlds[0].seed),
    bunker.footprint,
  );
  await sql`
    UPDATE bunkers
    SET block_seed = ${blockSeed}
    WHERE player_id = ${playerId} AND block_seed IS NULL`;
  return { ...bunker, blockSeed };
}

export async function loadBunkerView(
  sql: Sql,
  playerId: string,
): Promise<BunkerView> {
  const playerRows = (await sql`
    SELECT emeralds, track_xp, defense_xp
    FROM players
    WHERE id = ${playerId}`) as Array<{
    emeralds: number;
    track_xp: number;
    defense_xp: number;
  }>;
  const bunkerRows = (await sql`
    SELECT footprint, parts, dug, block_seed, loot, skin, skins_owned, revision, layout_version
    FROM bunkers
    WHERE player_id = ${playerId}`) as Array<{
    footprint: unknown;
    parts: unknown;
    dug: unknown;
    block_seed: unknown;
    loot: unknown;
    skin: unknown;
    skins_owned: unknown;
    revision: unknown;
    layout_version: unknown;
  }>;
  const raidRows = (await sql`
    SELECT snapshot, raid_version, started_at
    FROM bunker_raids
    WHERE player_id = ${playerId}
      AND result IS NULL
    ORDER BY started_at DESC
    LIMIT 1`) as Array<{
    snapshot: unknown;
    raid_version: unknown;
    started_at: string | Date;
  }>;
  const player = playerRows[0] ?? {
    emeralds: 0,
    track_xp: 0,
    defense_xp: 0,
  };
  const progress = playerLevelProgress(player.defense_xp);
  const revisionValue = Number(bunkerRows[0]?.revision);
  const raidRow = raidRows[0];
  const isLiveRaidRow =
    raidRow !== undefined &&
    Number(raidRow.raid_version) === BUNKER_RAID_LIVE_VERSION;
  let activeLiveRaid: LiveRaidActiveView | null = null;
  if (isLiveRaidRow) {
    activeLiveRaid = liveRaidActiveViewFrom(
      raidRow.snapshot,
      raidRow.started_at,
    );
    if (!activeLiveRaid && normalizeLiveRaidStartSnapshot(raidRow.snapshot)) {
      // A readable but past-grace live raid: settle it as a forfeit loss now
      // (F-105), so an abandoned raid closes on the next load, not only at the
      // next raid start.
      await finalizeExpiredLiveRaids(sql, playerId);
    }
  }
  // A legacy interim (raid_version NULL) row is ignored: the interim raid is
  // retired, so only a live raid can be active. Such rows remain opaque
  // history and cannot wedge a new live raid.
  const parsedBunker = parseBunkerState(bunkerRows[0] ?? null);
  const bunker = parsedBunker
    ? await backfillMissingBlockSeed(sql, playerId, parsedBunker)
    : null;
  return {
    bunker,
    inventory: await ensureStarterBaseParts(sql, playerId),
    activeLiveRaid,
    revision: Number.isFinite(revisionValue) ? revisionValue : 0,
    player: {
      balance: player.emeralds,
      trackXp: player.track_xp,
      defenseXp: player.defense_xp,
      overallLevel: overallPlayerLevel(player.track_xp, player.defense_xp),
      levelCap: progress.cap,
      progressXp: progress.progressXp,
      neededXp: progress.neededXp,
      nextLevelXp: progress.nextLevelXp,
      beaconLimit: progress.beaconLimit,
    },
  };
}

function footprintIsCleared(
  seed: number,
  diff: WorldDiff,
  footprint: BunkerFootprint,
): boolean {
  if (footprint.row < 1) return false;
  const mine = createMine(seed, DEFAULT_GEAR, NO_CONSUMABLES, diff);
  for (const { col, row } of bunkerCells(footprint)) {
    if (cellAt(mine, col, row)?.kind !== "empty") return false;
  }
  return true;
}

export async function claimBunker(
  sql: Sql,
  playerId: string,
  centerCol: number,
  centerRow: number,
): Promise<BunkerOperationResult> {
  const existing = (await sql`
    SELECT player_id
    FROM bunkers
    WHERE player_id = ${playerId}`) as Array<{ player_id: string }>;
  if (existing.length > 0) {
    return { ok: false, status: 409, error: "bunker already claimed" };
  }
  const worlds = (await sql`
    SELECT seed, diff
    FROM mine_worlds
    WHERE player_id = ${playerId}`) as Array<{
    seed: string | number;
    diff: unknown;
  }>;
  if (!worlds[0]) {
    return { ok: false, status: 409, error: "mine world is not ready" };
  }
  const footprint = proposedBunkerFootprint(centerCol, centerRow);
  const diff = Array.isArray(worlds[0].diff)
    ? (worlds[0].diff as WorldDiff)
    : [];
  if (!footprintIsCleared(Number(worlds[0].seed), diff, footprint)) {
    return { ok: false, status: 409, error: "clear the full 7x5 claim first" };
  }
  const blockSeed = deriveBunkerBlockSeed(Number(worlds[0].seed), footprint);
  const bunker = createBunker(footprint, blockSeed);
  await ensureStarterBaseParts(sql, playerId);
  await sql`
    INSERT INTO bunkers (player_id, footprint, parts, dug, block_seed, loot, layout_version)
    VALUES (
      ${playerId},
      ${JSON.stringify(bunker.footprint)}::jsonb,
      ${JSON.stringify(bunker.parts)}::jsonb,
      ${JSON.stringify(bunker.dug)}::jsonb,
      ${blockSeed},
      ${JSON.stringify(bunker.loot ?? [])}::jsonb,
      ${bunker.layoutVersion ?? BUNKER_LAYOUT_VERSION}
    )`;
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

export async function buyBasePart(
  sql: Sql,
  playerId: string,
  partId: BasePartId,
  quantity: number,
): Promise<BunkerOperationResult> {
  const count = Math.max(1, Math.min(99, Math.floor(quantity)));
  const view = await loadBunkerView(sql, playerId);
  const allowed = canBuyBasePart(
    partId,
    view.player.overallLevel,
    view.bunker,
    view.inventory,
    count,
  );
  if (!allowed.ok) {
    if (allowed.reason === "level") {
      return {
        ok: false,
        status: 409,
        error: `requires player level ${allowed.minLevel ?? 1}`,
      };
    }
    return {
      ok: false,
      status: 409,
      error: `stock limit ${allowed.limit ?? 0} reached`,
    };
  }
  const price = BASE_PART_CATALOG[partId].price * count;
  const limit = basePartOwnedLimit(partId, view.player.overallLevel);
  const deployedCount =
    view.bunker?.parts.filter((part) => part.partId === partId).length ?? 0;
  const inventoryAllowance = Number.isFinite(limit)
    ? Math.max(0, limit - deployedCount)
    : null;
  const rows =
    inventoryAllowance === null
      ? ((await sql`
          UPDATE players
          SET emeralds = emeralds - ${price}
          WHERE id = ${playerId}
            AND emeralds >= ${price}
          RETURNING id`) as Array<{ id: string }>)
      : ((await sql`
          UPDATE players
          SET emeralds = emeralds - ${price}
          WHERE id = ${playerId}
            AND emeralds >= ${price}
            AND (
              SELECT COALESCE(SUM(count), 0)
              FROM player_base_parts
              WHERE player_id = ${playerId}
                AND part_id = ${partId}
            ) + ${count} <= ${inventoryAllowance}
          RETURNING id`) as Array<{ id: string }>);
  if (rows.length === 0) {
    const latest = await loadBunkerView(sql, playerId);
    const latestAllowed = canBuyBasePart(
      partId,
      latest.player.overallLevel,
      latest.bunker,
      latest.inventory,
      count,
    );
    if (!latestAllowed.ok && latestAllowed.reason === "limit") {
      return {
        ok: false,
        status: 409,
        error: `stock limit ${latestAllowed.limit ?? 0} reached`,
      };
    }
    return { ok: false, status: 409, error: "not enough vibes" };
  }
  await sql`
    INSERT INTO player_base_parts (player_id, part_id, count)
    VALUES (${playerId}, ${partId}, ${count})
    ON CONFLICT (player_id, part_id)
    DO UPDATE SET count = player_base_parts.count + ${count}`;
  try {
    await recordBalanceEvent(sql, playerId, "base_part.purchase", {
      partId,
      quantity: count,
      unitPrice: BASE_PART_CATALOG[partId].price,
      price,
      playerLevel: view.player.overallLevel,
      defenseXp: view.player.defenseXp,
      deployedCount,
      inventoryAllowance,
    });
  } catch {
    // Balance events support tuning, but should not fail a charged purchase.
  }
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

export async function placeBunkerPart(
  sql: Sql,
  playerId: string,
  partId: BasePartId,
  col: number,
  row: number,
  depth = 0,
  expectedRevision?: number,
): Promise<BunkerOperationResult> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  const incompatible = layoutIncompatibleFailure(view.bunker);
  if (incompatible) return incompatible;
  if (view.activeLiveRaid)
    return { ok: false, status: 409, error: "finish the raid first" };
  const expected = resolveExpectedRevision(view, expectedRevision);
  if (expected === null) return revisionConflict(view);
  const placed = placeBasePart(
    view.bunker,
    view.inventory,
    partId,
    col,
    row,
    depth,
  );
  if (!placed.ok) {
    return { ok: false, status: 409, error: `cannot place: ${placed.reason}` };
  }
  const won = await saveBunkerAndInventory(
    sql,
    playerId,
    placed.bunker,
    placed.inventory,
    expected,
  );
  if (!won) return revisionConflict(await loadBunkerView(sql, playerId));
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

export async function removeBunkerPart(
  sql: Sql,
  playerId: string,
  col: number,
  row: number,
  depth = 0,
  expectedRevision?: number,
): Promise<BunkerOperationResult> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  const incompatible = layoutIncompatibleFailure(view.bunker);
  if (incompatible) return incompatible;
  if (view.activeLiveRaid)
    return { ok: false, status: 409, error: "finish the raid first" };
  const expected = resolveExpectedRevision(view, expectedRevision);
  if (expected === null) return revisionConflict(view);
  const removed = removeBasePart(view.bunker, view.inventory, col, row, depth);
  if (!removed.ok) {
    return {
      ok: false,
      status: 409,
      error: `cannot remove: ${removed.reason}`,
    };
  }
  const won = await saveBunkerAndInventory(
    sql,
    playerId,
    removed.bunker,
    removed.inventory,
    expected,
  );
  if (!won) return revisionConflict(await loadBunkerView(sql, playerId));
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

export async function moveBunkerPart(
  sql: Sql,
  playerId: string,
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
  fromDepth = 0,
  toDepth = 0,
  expectedRevision?: number,
): Promise<BunkerOperationResult> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  const incompatible = layoutIncompatibleFailure(view.bunker);
  if (incompatible) return incompatible;
  if (view.activeLiveRaid)
    return { ok: false, status: 409, error: "finish the raid first" };
  const expected = resolveExpectedRevision(view, expectedRevision);
  if (expected === null) return revisionConflict(view);
  const moved = moveBasePart(
    view.bunker,
    fromCol,
    fromRow,
    toCol,
    toRow,
    fromDepth,
    toDepth,
  );
  if (!moved.ok) {
    return { ok: false, status: 409, error: `cannot move: ${moved.reason}` };
  }
  const won = await saveBunkerAndInventory(
    sql,
    playerId,
    moved.bunker,
    view.inventory,
    expected,
  );
  if (!won) return revisionConflict(await loadBunkerView(sql, playerId));
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

export async function excavateBunker(
  sql: Sql,
  playerId: string,
  col: number,
  row: number,
  depth: number,
  expectedRevision?: number,
): Promise<BunkerOperationResult<{ newStamps?: string[]; oreVibes?: number }>> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  const incompatible = layoutIncompatibleFailure(view.bunker);
  if (incompatible) return incompatible;
  if (view.activeLiveRaid)
    return { ok: false, status: 409, error: "finish the raid first" };
  const expected = resolveExpectedRevision(view, expectedRevision);
  if (expected === null) return revisionConflict(view);
  const dug = excavateBunkerCell(view.bunker, col, row, depth);
  if (!dug.ok) {
    return { ok: false, status: 409, error: `cannot dig: ${dug.reason}` };
  }
  // A banked bunker has no trip bag, so its ore credits vibes to the
  // balance directly, atomically with the dug write (F-116). The server
  // recomputes the drop from the stored block seed so the client can
  // never claim ore that is not there; a cell can only be dug once
  // (excavateBunkerCell rejects an open cell), so this never double-pays.
  const drop = bunkerCellOreYield(
    view.bunker.footprint,
    view.bunker.blockSeed,
    col,
    row,
    depth,
  );
  const oreVibes = drop ? drop.units * oreDef(drop.ore).value : 0;
  // The dug write carries the same optimistic-concurrency guard as part
  // edits (F-122): it only lands when the revision still matches, bumping
  // it, and the ore payout is gated on that dig winning, so a concurrent
  // edit can never leave a paid-but-undug (or double-paid) cell. dug_rows
  // reports whether the guarded dig won so a loser returns 409. Parts are
  // written in the same guarded update as dug so a floor that the dig
  // cascades away (F-117: opening the cell below a grounded floor) cannot
  // reappear on the next load; today no slotted floor persists yet, so this
  // writes the unchanged parts back, but it keeps dig settlement durable
  // once slots persist.
  const guardResult = (await sql`
    WITH dug_update AS (
      UPDATE bunkers
      SET dug = ${JSON.stringify(dug.bunker.dug)}::jsonb,
          parts = ${JSON.stringify(dug.bunker.parts)}::jsonb,
          revision = revision + 1,
          updated_at = now()
      WHERE player_id = ${playerId}
        AND revision = ${expected}
      RETURNING player_id
    ), ore_pay AS (
      UPDATE players
      SET emeralds = emeralds + ${oreVibes}
      WHERE id = ${playerId}
        AND ${oreVibes} > 0
        AND EXISTS (SELECT 1 FROM dug_update)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM dug_update)::int AS dug_rows,
           (SELECT count(*) FROM ore_pay)::int AS ore_rows`) as Array<{
    dug_rows: number;
    ore_rows: number;
  }>;
  if ((guardResult[0]?.dug_rows ?? 0) === 0) {
    return revisionConflict(await loadBunkerView(sql, playerId));
  }
  // Groundbreaker is backfill-only: the empty patch increments nothing,
  // and the refresh inside applyAchievementProgress re-derives the
  // player-dug count from the durable bunkers.dug set (excluding the
  // authored spawn pocket, F-133), which the UPDATE above already
  // includes, so the metric always equals the real dig count.
  const [latestView, newStamps] = await Promise.all([
    loadBunkerView(sql, playerId),
    (async () => {
      try {
        return await applyAchievementProgress(sql, playerId, {});
      } catch {
        // Stamps are cosmetic and must never block an excavation.
        return [];
      }
    })(),
  ]);
  return { ok: true, view: latestView, newStamps, oreVibes };
}

/**
 * Collect the overflow loot at one bunker cell (F-116). Walking over the
 * cell in first person credits its vibes straight to the balance, then
 * clears the pile atomically so it can never pay twice. A cell with no
 * loot is a no-op that just returns the current view.
 */
export async function collectBunkerLoot(
  sql: Sql,
  playerId: string,
  col: number,
  row: number,
  depth: number,
): Promise<BunkerOperationResult<{ oreVibes?: number }>> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  const taken = takeBunkerLootAt(view.bunker, col, row, depth);
  let oreVibes = 0;
  for (const [id, n] of Object.entries(taken.ores) as Array<[OreId, number]>) {
    oreVibes += oreDef(id).value * n;
  }
  if (oreVibes <= 0) {
    return { ok: true, view, oreVibes: 0 };
  }
  await sql`
    WITH loot_update AS (
      UPDATE bunkers
      SET loot = ${JSON.stringify(taken.bunker.loot ?? [])}::jsonb,
          updated_at = now()
      WHERE player_id = ${playerId}
      RETURNING player_id
    )
    UPDATE players
    SET emeralds = emeralds + ${oreVibes}
    WHERE id = ${playerId}
      AND EXISTS (SELECT 1 FROM loot_update)`;
  return { ok: true, view: await loadBunkerView(sql, playerId), oreVibes };
}

async function saveBasePartInventory(
  sql: Sql,
  playerId: string,
  inventory: BasePartInventory,
): Promise<void> {
  for (const [partId, count] of Object.entries(inventory)) {
    await sql`
      INSERT INTO player_base_parts (player_id, part_id, count)
      VALUES (${playerId}, ${partId}, ${count})
      ON CONFLICT (player_id, part_id)
      DO UPDATE SET count = ${count}`;
  }
}

/**
 * Persist a banked part edit under the optimistic-concurrency guard
 * (F-122). The parts write only lands when the stored revision still
 * equals `expectedRevision`; it bumps the revision so exactly one edit
 * from a given expected revision can win. Returns whether the write won,
 * so the caller can 409 a loser without touching inventory.
 */
async function saveBunkerAndInventory(
  sql: Sql,
  playerId: string,
  bunker: BunkerState,
  inventory: BasePartInventory,
  expectedRevision: number,
): Promise<boolean> {
  const won = (await sql`
    UPDATE bunkers
    SET parts = ${JSON.stringify(bunker.parts)}::jsonb,
        revision = revision + 1,
        updated_at = now()
    WHERE player_id = ${playerId}
      AND revision = ${expectedRevision}
    RETURNING player_id`) as Array<{ player_id: string }>;
  if (won.length === 0) return false;
  await saveBasePartInventory(sql, playerId, inventory);
  return true;
}

/**
 * Reset the bunker to a bare claim (F-093): undamaged placed parts
 * refund to inventory, damaged parts are lost, and the excavation stays
 * dug. The claim, skin, and owned skins stay. Blocked while a raid is
 * active, the same guard as repairs.
 */
export async function resetBunker(
  sql: Sql,
  playerId: string,
): Promise<BunkerOperationResult> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  // A layout-incompatible bunker must Start fresh, which refunds nothing
  // (Q-022): route it away from the refunding reset so a retired layout
  // cannot be reset for a refund. The client already hides the reset button
  // for an incompatible bunker; this closes the direct-request path too.
  const incompatible = layoutIncompatibleFailure(view.bunker);
  if (incompatible) return incompatible;
  if (bunkerRaidActive(view))
    return { ok: false, status: 409, error: "finish the raid first" };
  const reset = applyBunkerReset(view.bunker, view.inventory);
  // Bump the revision so an in-flight banked edit loses its guard and the
  // client resyncs instead of clobbering the reset (F-122).
  await sql`
    UPDATE bunkers
    SET parts = ${JSON.stringify(reset.bunker.parts)}::jsonb,
        dug = ${JSON.stringify(reset.bunker.dug)}::jsonb,
        revision = revision + 1,
        updated_at = now()
    WHERE player_id = ${playerId}`;
  await saveBasePartInventory(sql, playerId, reset.inventory);
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

/**
 * Hard-reset a layout-incompatible bunker to a bare, current-version
 * claim (F-117, Q-022). Unlike resetBunker this refunds nothing (the old
 * layout is structurally gone) and stamps layout_version forward; the
 * excavation, skin, seed, and loot stay. Safe and idempotent on an
 * already-current bunker: it returns the view unchanged so a retry can
 * never wipe a valid layout with no refund. The destructive write is a
 * guarded compare-and-swap; a request that loses the race to a concurrent
 * reset gets the standard F-122 revision-conflict 409 with the reloaded
 * view rather than clobbering it. Blocked during an active raid.
 */
export async function startFreshBunker(
  sql: Sql,
  playerId: string,
): Promise<BunkerOperationResult> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  // Only an incompatible bunker is wiped. A current one is returned as-is
  // so a double-submit or a mistaken call never destroys a valid layout
  // (Start fresh gives no refund; resetBunker is the refunding path).
  if (!isBunkerLayoutIncompatible(view.bunker)) {
    return { ok: true, view };
  }
  if (bunkerRaidActive(view))
    return { ok: false, status: 409, error: "finish the raid first" };
  const fresh = applyBunkerStartFresh(view.bunker);
  // Guarded compare-and-swap (F-117): only wipe a bunker that is STILL the
  // incompatible one this request loaded. The load-then-check above has a
  // TOCTOU window, so guard the write on both the loaded revision and the
  // layout still being below current, and RETURNING tells us whether it
  // landed. If a concurrent Start fresh already reset the bunker (and the
  // player even rebuilt it to a current layout) in between, this write
  // matches zero rows and never wipes the rebuilt state. Bumping the
  // revision also drops any in-flight banked edit's guard.
  const won = (await sql`
    UPDATE bunkers
    SET parts = ${JSON.stringify(fresh.parts)}::jsonb,
        dug = ${JSON.stringify(fresh.dug)}::jsonb,
        layout_version = ${BUNKER_LAYOUT_VERSION},
        revision = revision + 1,
        updated_at = now()
    WHERE player_id = ${playerId}
      AND revision = ${view.revision}
      AND layout_version < ${BUNKER_LAYOUT_VERSION}
    RETURNING player_id`) as Array<{ player_id: string }>;
  // A loser follows the same F-122 conflict contract as every other bunker
  // edit: a 409 carrying the authoritative reloaded view, so the client
  // adopts the winner's already-reset (or rebuilt) bunker while its own
  // Start fresh reports as failed rather than a phantom success.
  if (won.length === 0)
    return revisionConflict(await loadBunkerView(sql, playerId));
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

export async function repairBunker(
  sql: Sql,
  playerId: string,
): Promise<BunkerOperationResult> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  // A layout-incompatible bunker cannot be repaired: its parts are about to
  // be cleared by Start fresh, so spending vibes to patch them would waste
  // them (F-117). Start fresh is the only edit an old layout accepts.
  const incompatible = layoutIncompatibleFailure(view.bunker);
  if (incompatible) return incompatible;
  if (bunkerRaidActive(view))
    return { ok: false, status: 409, error: "finish the raid first" };
  const plan = bunkerRepairPlan(view.bunker);
  if (plan.totalCost <= 0)
    return { ok: false, status: 409, error: "nothing to repair" };
  // Guarded debit: the balance check and the spend are one statement,
  // so two concurrent repairs cannot both pass the check (the second
  // returns zero rows and rejects).
  const debited = (await sql`
    UPDATE players SET emeralds = emeralds - ${plan.totalCost}
    WHERE id = ${playerId} AND emeralds >= ${plan.totalCost}
    RETURNING emeralds`) as Array<{ emeralds: number }>;
  if (debited.length === 0) {
    return {
      ok: false,
      status: 409,
      error: `repairs cost ${plan.totalCost} vibes`,
    };
  }
  const repaired = applyBunkerRepairs(view.bunker);
  await sql`
    UPDATE bunkers
    SET parts = ${JSON.stringify(repaired.parts)},
        revision = revision + 1
    WHERE player_id = ${playerId}`;
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

export async function setBunkerSkin(
  sql: Sql,
  playerId: string,
  skinId: BunkerSkinId,
): Promise<BunkerOperationResult<{ newStamps?: string[] }>> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  const def = BUNKER_SKIN_CATALOG[skinId];
  const owned =
    def.price === 0 || (view.bunker.skinsOwned ?? []).includes(skinId);
  let newStamps: string[] = [];
  if (!owned) {
    // Guarded single-statement debit: no transactions on the neon driver,
    // so the affordability check and the charge must be one atomic write.
    const debited = (await sql`
      UPDATE players SET emeralds = emeralds - ${def.price}
      WHERE id = ${playerId} AND emeralds >= ${def.price}
      RETURNING emeralds`) as Array<{ emeralds: number }>;
    if (debited.length === 0) {
      return {
        ok: false,
        status: 409,
        error: `${def.name} costs ${def.price} vibes`,
      };
    }
    try {
      newStamps = await applyAchievementProgress(sql, playerId, {
        bunkerSkinsBought: 1,
      });
    } catch {
      // Stamps are cosmetic and must never block a skin purchase.
    }
  }
  if (def.price > 0) {
    // Append ownership against the LIVE row, not the preloaded snapshot:
    // two concurrent purchases must both keep their entry.
    await sql`
      UPDATE bunkers
      SET skin = ${skinId},
          skins_owned = CASE
            WHEN skins_owned @> ${JSON.stringify([skinId])}::jsonb
              THEN skins_owned
            ELSE skins_owned || ${JSON.stringify([skinId])}::jsonb
          END
      WHERE player_id = ${playerId}`;
  } else {
    await sql`
      UPDATE bunkers
      SET skin = ${skinId}
      WHERE player_id = ${playerId}`;
  }
  return { ok: true, view: await loadBunkerView(sql, playerId), newStamps };
}

/**
 * Start a live first-person raid (Q-024 option D, F-108), the only raid path.
 * Nothing is resolved and no wear is applied here: the current bunker is frozen
 * into a versioned snapshot the client runs the raid against in real time, then
 * reports a bounded outcome for the resolve route to settle against this same
 * snapshot.
 */
export async function startLiveRaid(
  sql: Sql,
  playerId: string,
  tier: number,
): Promise<BunkerOperationResult<{ liveRaid: LiveRaidActiveView }>> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  // A layout-incompatible bunker must Start fresh before it can raid
  // (F-117). Blocking the start keeps an old layout from ever freezing a
  // raid snapshot, which closes the settlement/Start-fresh race entirely:
  // every live raid now runs on a current-version bunker.
  const incompatible = layoutIncompatibleFailure(view.bunker);
  if (incompatible) return incompatible;
  if (bunkerRaidActive(view))
    return { ok: false, status: 409, error: "raid already active" };
  const tierCeiling = maxBunkerRaidTier(view.player.overallLevel);
  if (tier > tierCeiling) {
    return {
      ok: false,
      status: 422,
      error: `tier ${tier} unlocks at player level ${tier}`,
    };
  }
  const recentRows = (await sql`
    SELECT started_at
    FROM bunker_raids
    WHERE player_id = ${playerId}
    ORDER BY started_at DESC
    LIMIT 1`) as Array<{ started_at: string | Date }>;
  const lastStartedAt = recentRows[0]?.started_at;
  if (lastStartedAt) {
    const cooldownMs = BUNKER_RAID_COOLDOWN_HOURS * 60 * 60 * 1000;
    const remainingMs =
      new Date(lastStartedAt).getTime() + cooldownMs - Date.now();
    if (remainingMs > 0) {
      const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
      return {
        ok: false,
        status: 409,
        error: `raid cooldown active: ${remainingHours}h remaining`,
      };
    }
  }
  // A stale past-grace live row was already settled as a forfeit loss by the
  // loadBunkerView call above (F-105), so no cleanup is needed here before
  // opening the new raid.
  const startedAtMs = Date.now();
  const raidId = `live-${startedAtMs.toString(36)}`;
  // Frozen snapshot: the bunker is stored in the bunkers-row shape so it reads
  // back through parseBunkerState. Its type is inferred, not LiveRaidStartSnapshot
  // (whose bunker is the parsed BunkerState, not the row shape).
  const snapshot = {
    version: BUNKER_RAID_LIVE_VERSION,
    raidId,
    tier,
    durationSeconds: BUNKER_RAID_DURATION_SECONDS,
    bunker: bunkerRowSnapshot(view.bunker),
    // Freeze the bunker revision so settlement can contend its parts-write on
    // it (F-106), refusing to overwrite a bunker a concurrent edit changed in
    // the window after the raid row is claimed.
    revision: view.revision,
  };
  await sql`
    INSERT INTO bunker_raids (
      player_id,
      raid_id,
      tier,
      snapshot,
      duration_seconds,
      raid_version
    )
    VALUES (
      ${playerId},
      ${raidId},
      ${tier},
      ${JSON.stringify(snapshot)}::jsonb,
      ${BUNKER_RAID_DURATION_SECONDS},
      ${BUNKER_RAID_LIVE_VERSION}
    )`;
  const refreshed = await loadBunkerView(sql, playerId);
  if (!refreshed.activeLiveRaid) {
    return { ok: false, status: 500, error: "failed to start live raid" };
  }
  return { ok: true, view: refreshed, liveRaid: refreshed.activeLiveRaid };
}

/**
 * Resolve a live raid from a client-reported outcome (Q-024 option D,
 * F-105/F-106). The report is settled against the frozen start snapshot (never
 * the live bunker), and the row is claimed with a `result IS NULL` compare-and-set
 * so exactly one resolve wins. Defense wear stands on a win or a loss; only a
 * survive credits vibes and defense XP, mirroring the interim finish. Edits are
 * frozen during a live raid, so overwriting the bunker with the settled snapshot
 * cannot clobber a concurrent change.
 */
export async function resolveLiveRaid(
  sql: Sql,
  playerId: string,
  report: LiveRaidOutcomeReport,
): Promise<
  BunkerOperationResult<{ reward: BunkerRaidRewardReport; sealed: boolean }>
> {
  const rows = (await sql`
    SELECT raid_id, tier, snapshot
    FROM bunker_raids
    WHERE player_id = ${playerId}
      AND result IS NULL
      AND raid_version = ${BUNKER_RAID_LIVE_VERSION}
    ORDER BY started_at DESC
    LIMIT 1`) as Array<{ raid_id: string; tier: number; snapshot: unknown }>;
  const row = rows[0];
  if (!row) return { ok: false, status: 409, error: "no active live raid" };
  const start = normalizeLiveRaidStartSnapshot(row.snapshot);
  if (!start) return { ok: false, status: 409, error: "no active live raid" };
  const settled = settleLiveRaidOutcome(start.bunker, start.tier, report);
  if (!settled.ok) {
    return {
      ok: false,
      status: 422,
      error: `invalid raid outcome: ${settled.reason}`,
    };
  }
  const { settlement } = settled;
  // Exactly-once settle: only the first resolve for this row claims it.
  const claimed = (await sql`
    UPDATE bunker_raids
    SET result = ${JSON.stringify({
      outcome: report.outcome,
      survived: settlement.survived,
      sealed: settlement.sealed,
      reward: settlement.reward,
    })}::jsonb,
        rewarded_at = now()
    WHERE player_id = ${playerId}
      AND raid_id = ${row.raid_id}
      AND result IS NULL
    RETURNING raid_id`) as Array<{ raid_id: string }>;
  if (claimed.length === 0) {
    return { ok: false, status: 409, error: "raid already finished" };
  }
  // Defense damage stands on a win or a loss: write the settled parts (the
  // frozen snapshot worn by the report) back to the bunker. Two guards, both
  // so this write loses cleanly to a concurrent change instead of silently
  // overwriting it. (1) Layout generation (F-117): if a Start fresh advanced
  // the bunker past the frozen generation, drop the worn old parts rather than
  // restore them onto the freshly reset bunker. (2) Frozen revision (F-106):
  // claiming the raid row above flips the raid inactive, so an ordinary bunker
  // edit can now succeed at the same generation; contending on the revision
  // frozen at raid start means exactly one of {this settlement, that edit}
  // wins (the edit already bumped the revision, so this write misses and its
  // newer parts stand). A pre-revision snapshot (revision null) keeps the
  // layout-only guard. The reward below is unaffected either way: surviving
  // the raid still pays out.
  await sql`
    UPDATE bunkers
    SET parts = ${JSON.stringify(settlement.bunker.parts)}::jsonb,
        revision = revision + 1,
        updated_at = now()
    WHERE player_id = ${playerId}
      AND layout_version = ${start.bunker.layoutVersion ?? 0}
      AND (${start.revision}::int IS NULL OR revision = ${start.revision}::int)`;
  const beforeRows = (await sql`
    SELECT track_xp, defense_xp
    FROM players
    WHERE id = ${playerId}`) as Array<{ track_xp: number; defense_xp: number }>;
  const before = beforeRows[0] ?? { track_xp: 0, defense_xp: 0 };
  const beforeProgress = playerLevelProgress(before.defense_xp);
  let defenseXpAfter = before.defense_xp;
  let newStamps: string[] = [];
  if (settlement.survived) {
    const playerRows = (await sql`
      UPDATE players
      SET emeralds = emeralds + ${settlement.reward.vibes},
          defense_xp = defense_xp + ${settlement.reward.defenseXp}
      WHERE id = ${playerId}
      RETURNING defense_xp`) as Array<{ defense_xp: number }>;
    defenseXpAfter = playerRows[0]?.defense_xp ?? defenseXpAfter;
    try {
      newStamps = await applyAchievementProgress(sql, playerId, {
        bunkerRaidsSurvived: 1,
        raidsSurvivedSealed: settlement.sealed ? 1 : 0,
      });
    } catch {
      // Stamps are cosmetic and must never block a raid reward.
    }
  }
  const afterProgress = playerLevelProgress(defenseXpAfter);
  if (settlement.survived) {
    try {
      await recordBalanceEvent(sql, playerId, "bunker.live_raid_reward", {
        raidId: row.raid_id,
        tier: start.tier,
        survived: settlement.survived,
        sealed: settlement.sealed,
        vibesGained: settlement.reward.vibes,
        defenseXpGained: settlement.reward.defenseXp,
        defenseXpBefore: before.defense_xp,
        defenseXpAfter,
        levelBefore: beforeProgress.level,
        levelAfter: afterProgress.level,
        clankersKilled: report.clankersKilled,
      });
    } catch {
      // Balance events support tuning, but must not fail a raid reward.
    }
  }
  return {
    ok: true,
    view: await loadBunkerView(sql, playerId),
    reward: {
      survived: settlement.survived,
      vibesGained: settlement.reward.vibes,
      xpGained: settlement.reward.defenseXp,
      defenseXpBefore: before.defense_xp,
      defenseXpAfter,
      levelBefore: beforeProgress.level,
      levelAfter: afterProgress.level,
      leveledUp: afterProgress.level > beforeProgress.level,
      beaconLimitBefore: beforeProgress.beaconLimit,
      beaconLimitAfter: afterProgress.beaconLimit,
      newStamps,
    },
    sealed: settlement.sealed,
  };
}
