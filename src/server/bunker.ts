import { BUNKER_REVISION_CONFLICT_CODE } from "@/lib/api-codes";
import type { BunkerView, LiveRaidActiveView } from "@/lib/bunker-api-types";
import {
  applyBunkerRaidWear,
  applyBunkerRepairs,
  applyBunkerReset,
  BASE_PART_CATALOG,
  BASE_PART_IDS,
  type BasePartId,
  type BasePartInventory,
  BUNKER_CLAIM_DEPTH,
  BUNKER_RAID_COOLDOWN_HOURS,
  BUNKER_RAID_DURATION_SECONDS,
  BUNKER_SKIN_CATALOG,
  type BunkerFootprint,
  type BunkerLoot,
  type BunkerRaidRewardReport,
  type BunkerRaidSnapshot,
  type BunkerSkinId,
  type BunkerState,
  basePartOwnedLimit,
  bunkerCells,
  bunkerRepairPlan,
  canBuyBasePart,
  canCollectBunkerRaidPickupFrom,
  createBunker,
  DEFAULT_BUNKER_SKIN,
  type DugBunkerCell,
  EMPTY_BASE_PART_INVENTORY,
  excavateBunkerCell,
  isBunkerSkinId,
  maxBunkerRaidTier,
  moveBasePart,
  overallPlayerLevel,
  placeBasePart,
  playerLevelProgress,
  proposedBunkerFootprint,
  removeBasePart,
  resolveBunkerRaid,
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
    core: unknown;
    parts: unknown;
    dug?: unknown;
    block_seed?: unknown;
    loot?: unknown;
    skin?: unknown;
    skins_owned?: unknown;
  } | null,
): BunkerState | null {
  if (!row) return null;
  const footprint = row.footprint as BunkerFootprint;
  const storedCore = row.core as BunkerState["core"];
  const core = {
    ...storedCore,
    depth: normalizedBunkerDepth(storedCore.depth),
  };
  const parts = Array.isArray(row.parts) ? row.parts : [];
  const skinsOwned = Array.isArray(row.skins_owned)
    ? row.skins_owned.filter(isBunkerSkinId)
    : [];
  return {
    footprint,
    core,
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

function normalizeBunkerRaidSnapshot(
  snapshot: unknown,
): BunkerRaidSnapshot | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const candidate = snapshot as Partial<BunkerRaidSnapshot>;
  if (typeof candidate.raidId !== "string") return null;
  return {
    raidId: candidate.raidId,
    tier: numberValue(candidate.tier, 1),
    durationSeconds: numberValue(candidate.durationSeconds),
    startedAtMs: numberValue(candidate.startedAtMs) || undefined,
    clankers: Array.isArray(candidate.clankers)
      ? (candidate.clankers as BunkerRaidSnapshot["clankers"]).map(
          (clanker) => ({ ...clanker, kind: clanker.kind ?? "standard" }),
        )
      : [],
    turretShots: numberValue(candidate.turretShots),
    turretDamage: numberValue(candidate.turretDamage),
    spikeTriggers: numberValue(candidate.spikeTriggers),
    spikeDamage: numberValue(candidate.spikeDamage),
    totalPartDurability: numberValue(candidate.totalPartDurability),
    incomingDamage: numberValue(candidate.incomingDamage),
    partDamage: Array.isArray(candidate.partDamage) ? candidate.partDamage : [],
    coreDamage: numberValue(candidate.coreDamage),
    xpPickups: Array.isArray(candidate.xpPickups) ? candidate.xpPickups : [],
    allClankersDead: Boolean(candidate.allClankersDead),
    breached: Boolean(candidate.breached),
    minerKilled: Boolean(candidate.minerKilled),
    survived: Boolean(candidate.survived),
    // Pre-0.1.214 snapshots carry no sealed flag: old raids cannot
    // prove an enclosure, so they never credit the Buttoned Up stamp.
    sealed: candidate.sealed === true,
    reward: {
      vibes: numberValue(candidate.reward?.vibes),
      defenseXp: numberValue(candidate.reward?.defenseXp),
    },
  };
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
}

/** Serialize a BunkerState into the bunkers-row shape used inside a frozen
 * live-raid snapshot, so it round-trips through `parseBunkerState`. */
function bunkerRowSnapshot(bunker: BunkerState) {
  return {
    footprint: bunker.footprint,
    core: bunker.core,
    parts: bunker.parts,
    dug: bunker.dug,
    block_seed: bunker.blockSeed,
    loot: bunker.loot,
    skin: bunker.skin,
    skins_owned: bunker.skinsOwned,
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
  return view.activeRaid !== null || view.activeLiveRaid != null;
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
    SELECT footprint, core, parts, dug, block_seed, loot, skin, skins_owned, revision
    FROM bunkers
    WHERE player_id = ${playerId}`) as Array<{
    footprint: unknown;
    core: unknown;
    parts: unknown;
    dug: unknown;
    block_seed: unknown;
    loot: unknown;
    skin: unknown;
    skins_owned: unknown;
    revision: unknown;
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
  let activeRaid: BunkerRaidSnapshot | null = null;
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
  } else if (raidRow) {
    activeRaid = normalizeBunkerRaidSnapshot(raidRow.snapshot);
  }
  return {
    bunker: parseBunkerState(bunkerRows[0] ?? null),
    inventory: await ensureStarterBaseParts(sql, playerId),
    activeRaid,
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
    INSERT INTO bunkers (player_id, footprint, core, parts, dug, block_seed, loot)
    VALUES (
      ${playerId},
      ${JSON.stringify(bunker.footprint)}::jsonb,
      ${JSON.stringify(bunker.core)}::jsonb,
      ${JSON.stringify(bunker.parts)}::jsonb,
      ${JSON.stringify(bunker.dug)}::jsonb,
      ${blockSeed},
      ${JSON.stringify(bunker.loot ?? [])}::jsonb
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
  // reports whether the guarded dig won so a loser returns 409.
  const guardResult = (await sql`
    WITH dug_update AS (
      UPDATE bunkers
      SET dug = ${JSON.stringify(dug.bunker.dug)}::jsonb,
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
 * refund to inventory, damaged parts are lost, excavation refills, and
 * the core restores to full. The claim, skin, and owned skins stay.
 * Blocked while a raid is active, the same guard as repairs.
 */
export async function resetBunker(
  sql: Sql,
  playerId: string,
): Promise<BunkerOperationResult> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  if (bunkerRaidActive(view))
    return { ok: false, status: 409, error: "finish the raid first" };
  const reset = applyBunkerReset(view.bunker, view.inventory);
  // Bump the revision so an in-flight banked edit loses its guard and the
  // client resyncs instead of clobbering the reset (F-122).
  await sql`
    UPDATE bunkers
    SET parts = ${JSON.stringify(reset.bunker.parts)}::jsonb,
        dug = ${JSON.stringify(reset.bunker.dug)}::jsonb,
        core = ${JSON.stringify(reset.bunker.core)}::jsonb,
        revision = revision + 1,
        updated_at = now()
    WHERE player_id = ${playerId}`;
  await saveBasePartInventory(sql, playerId, reset.inventory);
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

export async function repairBunker(
  sql: Sql,
  playerId: string,
): Promise<BunkerOperationResult> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
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
    SET core = ${JSON.stringify(repaired.core)},
        parts = ${JSON.stringify(repaired.parts)},
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

export async function startBunkerRaid(
  sql: Sql,
  playerId: string,
  tier: number,
): Promise<BunkerOperationResult<{ raid: BunkerRaidSnapshot }>> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
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
    const availableAt = new Date(lastStartedAt).getTime() + cooldownMs;
    const remainingMs = availableAt - Date.now();
    if (remainingMs > 0) {
      const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
      return {
        ok: false,
        status: 409,
        error: `raid cooldown active: ${remainingHours}h remaining`,
      };
    }
  }
  const startedAtMs = Date.now();
  const worlds = (await sql`
    SELECT seed, diff
    FROM mine_worlds
    WHERE player_id = ${playerId}`) as Array<{
    seed: string | number;
    diff: unknown;
  }>;
  const world = worlds[0];
  const diff = Array.isArray(world?.diff) ? (world.diff as WorldDiff) : [];
  const mine =
    world === undefined
      ? null
      : createMine(Number(world.seed), DEFAULT_GEAR, NO_CONSUMABLES, diff);
  const raidId = `raid-${startedAtMs.toString(36)}`;
  const raid = resolveBunkerRaid(view.bunker, tier, raidId, {
    startedAtMs,
    terrainAt:
      mine === null
        ? undefined
        : (col, row) => cellAt(mine, col, row)?.kind ?? "empty",
  });
  const wornBunker = applyBunkerRaidWear(view.bunker, raid);
  await sql`
    UPDATE bunkers
    SET parts = ${JSON.stringify(wornBunker.parts)}::jsonb,
        core = ${JSON.stringify(wornBunker.core)}::jsonb,
        revision = revision + 1,
        updated_at = now()
    WHERE player_id = ${playerId}`;
  await sql`
    INSERT INTO bunker_raids (
      player_id,
      raid_id,
      tier,
      snapshot,
      duration_seconds
    )
    VALUES (
      ${playerId},
      ${raid.raidId},
      ${raid.tier},
      ${JSON.stringify(raid)}::jsonb,
      ${raid.durationSeconds}
    )`;
  return { ok: true, view: await loadBunkerView(sql, playerId), raid };
}

/**
 * Start a live first-person raid (Q-024 option D, F-108). Unlike the interim
 * raid, nothing is resolved and no wear is applied here: the current bunker is
 * frozen into a versioned snapshot the client runs the raid against in real
 * time, then reports a bounded outcome for the resolve route to settle against
 * this same snapshot. The active-raid guard, tier ceiling, and cooldown mirror
 * the interim start.
 */
export async function startLiveRaid(
  sql: Sql,
  playerId: string,
  tier: number,
): Promise<BunkerOperationResult<{ liveRaid: LiveRaidActiveView }>> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
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
  // frozen snapshot worn by the report) back to the bunker.
  await sql`
    UPDATE bunkers
    SET parts = ${JSON.stringify(settlement.bunker.parts)}::jsonb,
        revision = revision + 1,
        updated_at = now()
    WHERE player_id = ${playerId}`;
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

export async function collectBunkerRaidPickup(
  sql: Sql,
  playerId: string,
  col: number,
  row: number,
): Promise<BunkerOperationResult<{ raid: BunkerRaidSnapshot }>> {
  const rows = (await sql`
    SELECT raid_id, snapshot
    FROM bunker_raids
    WHERE player_id = ${playerId}
      AND result IS NULL
    ORDER BY started_at DESC
    LIMIT 1`) as Array<{ raid_id: string; snapshot: unknown }>;
  const rowData = rows[0];
  if (!rowData || typeof rowData.snapshot !== "object") {
    return { ok: false, status: 409, error: "no active raid" };
  }
  const raid = normalizeBunkerRaidSnapshot(rowData.snapshot);
  if (!raid) return { ok: false, status: 409, error: "no active raid" };
  if (!raid.survived) {
    return { ok: true, view: await loadBunkerView(sql, playerId), raid };
  }
  let collected = false;
  const updatedRaid: BunkerRaidSnapshot = {
    ...raid,
    xpPickups: raid.xpPickups.map((pickup) => {
      if (!canCollectBunkerRaidPickupFrom(pickup, col, row)) {
        return pickup;
      }
      collected = true;
      return { ...pickup, collected: true };
    }),
  };
  if (collected) {
    const collectedXp = updatedRaid.xpPickups.reduce((sum, pickup) => {
      return sum + (pickup.collected ? pickup.defenseXp : 0);
    }, 0);
    updatedRaid.reward = {
      ...updatedRaid.reward,
      defenseXp: collectedXp,
    };
    await sql`
      UPDATE bunker_raids
      SET snapshot = ${JSON.stringify(updatedRaid)}::jsonb
      WHERE player_id = ${playerId}
        AND raid_id = ${rowData.raid_id}
        AND result IS NULL`;
  }
  return {
    ok: true,
    view: await loadBunkerView(sql, playerId),
    raid: updatedRaid,
  };
}

export async function finishBunkerRaid(
  sql: Sql,
  playerId: string,
): Promise<
  BunkerOperationResult<{
    raid: BunkerRaidSnapshot;
    reward: BunkerRaidRewardReport;
  }>
> {
  const rows = (await sql`
    SELECT raid_id, snapshot, started_at, duration_seconds
    FROM bunker_raids
    WHERE player_id = ${playerId}
      AND result IS NULL
    ORDER BY started_at DESC
    LIMIT 1`) as Array<{
    raid_id: string;
    snapshot: unknown;
    started_at: string;
    duration_seconds: number;
  }>;
  const row = rows[0];
  if (!row || typeof row.snapshot !== "object") {
    return { ok: false, status: 409, error: "no active raid" };
  }
  const raid = normalizeBunkerRaidSnapshot(row.snapshot);
  if (!raid) return { ok: false, status: 409, error: "no active raid" };
  const elapsed = Date.now() - new Date(row.started_at).getTime();
  if (!raid.allClankersDead && elapsed < row.duration_seconds * 1000) {
    return { ok: false, status: 409, error: "raid still in progress" };
  }
  const uncollectedXpPickups = raid.survived
    ? raid.xpPickups.filter((pickup) => !pickup.collected)
    : [];
  if (uncollectedXpPickups.length > 0) {
    return {
      ok: false,
      status: 409,
      error: "collect raid XP pickups first",
    };
  }
  const collectedDefenseXp = raid.survived
    ? raid.xpPickups.reduce((sum, pickup) => {
        return sum + (pickup.collected ? pickup.defenseXp : 0);
      }, 0)
    : 0;
  const completedRaid: BunkerRaidSnapshot = {
    ...raid,
    reward: raid.survived
      ? { ...raid.reward, defenseXp: collectedDefenseXp }
      : { vibes: 0, defenseXp: 0 },
  };
  const rewarded = (await sql`
    UPDATE bunker_raids
    SET result = ${JSON.stringify(completedRaid)}::jsonb,
        rewarded_at = now()
    WHERE player_id = ${playerId}
      AND raid_id = ${row.raid_id}
      AND result IS NULL
    RETURNING raid_id`) as Array<{ raid_id: string }>;
  if (rewarded.length === 0) {
    return { ok: false, status: 409, error: "raid already finished" };
  }
  const beforeRows = (await sql`
    SELECT track_xp, defense_xp
    FROM players
    WHERE id = ${playerId}`) as Array<{
    track_xp: number;
    defense_xp: number;
  }>;
  const before = beforeRows[0] ?? { track_xp: 0, defense_xp: 0 };
  const beforeProgress = playerLevelProgress(before.defense_xp);
  let defenseXpAfter = before.defense_xp;
  let newStamps: string[] = [];
  if (raid.survived) {
    const playerRows = (await sql`
      UPDATE players
      SET emeralds = emeralds + ${completedRaid.reward.vibes},
          defense_xp = defense_xp + ${completedRaid.reward.defenseXp}
      WHERE id = ${playerId}
      RETURNING defense_xp`) as Array<{ defense_xp: number }>;
    defenseXpAfter = playerRows[0]?.defense_xp ?? defenseXpAfter;
    try {
      newStamps = await applyAchievementProgress(sql, playerId, {
        bunkerRaidsSurvived: 1,
        raidsSurvivedSealed: raid.sealed ? 1 : 0,
      });
    } catch {
      // Stamps are cosmetic and must never block a raid reward.
    }
  }
  const afterProgress = playerLevelProgress(defenseXpAfter);
  if (raid.survived) {
    try {
      await recordBalanceEvent(sql, playerId, "bunker.raid_reward", {
        raidId: row.raid_id,
        tier: raid.tier,
        survived: raid.survived,
        vibesGained: completedRaid.reward.vibes,
        defenseXpGained: completedRaid.reward.defenseXp,
        defenseXpBefore: before.defense_xp,
        defenseXpAfter,
        levelBefore: beforeProgress.level,
        levelAfter: afterProgress.level,
        clankers: raid.clankers.length,
        incomingDamage: raid.incomingDamage,
        breached: raid.breached,
      });
    } catch {
      // Balance events support tuning, but should not fail a raid reward.
    }
  }
  return {
    ok: true,
    view: await loadBunkerView(sql, playerId),
    raid: completedRaid,
    reward: {
      survived: raid.survived,
      vibesGained: completedRaid.reward.vibes,
      xpGained: completedRaid.reward.defenseXp,
      defenseXpBefore: before.defense_xp,
      defenseXpAfter,
      levelBefore: beforeProgress.level,
      levelAfter: afterProgress.level,
      leveledUp: afterProgress.level > beforeProgress.level,
      beaconLimitBefore: beforeProgress.beaconLimit,
      beaconLimitAfter: afterProgress.beaconLimit,
      newStamps,
    },
  };
}
