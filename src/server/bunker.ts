import type { BunkerView } from "@/lib/bunker-api-types";
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
  BUNKER_SKIN_CATALOG,
  type BunkerFootprint,
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
} from "@/sim/bunker";
import {
  cellAt,
  createMine,
  DEFAULT_GEAR,
  NO_CONSUMABLES,
  type WorldDiff,
} from "@/sim/mine";
import { applyAchievementProgress } from "./achievements";
import { recordBalanceEvent } from "./balance-telemetry";
import type { db } from "./db";

type Sql = Awaited<ReturnType<typeof db>>;

type BunkerOperationResult<T extends object = object> =
  | ({ ok: true; view: BunkerView } & T)
  | { ok: false; status: number; error: string };

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
      candidate.depth >= 1 &&
      candidate.depth < BUNKER_CLAIM_DEPTH
    );
  });
}

function parseBunkerState(
  row: {
    footprint: unknown;
    core: unknown;
    parts: unknown;
    dug?: unknown;
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
    dug: normalizedDugCells(row.dug),
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
    SELECT footprint, core, parts, dug, skin, skins_owned
    FROM bunkers
    WHERE player_id = ${playerId}`) as Array<{
    footprint: unknown;
    core: unknown;
    parts: unknown;
    dug: unknown;
    skin: unknown;
    skins_owned: unknown;
  }>;
  const raidRows = (await sql`
    SELECT snapshot
    FROM bunker_raids
    WHERE player_id = ${playerId}
      AND result IS NULL
    ORDER BY started_at DESC
    LIMIT 1`) as Array<{ snapshot: unknown }>;
  const player = playerRows[0] ?? {
    emeralds: 0,
    track_xp: 0,
    defense_xp: 0,
  };
  const progress = playerLevelProgress(player.defense_xp);
  return {
    bunker: parseBunkerState(bunkerRows[0] ?? null),
    inventory: await ensureStarterBaseParts(sql, playerId),
    activeRaid: normalizeBunkerRaidSnapshot(raidRows[0]?.snapshot),
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
  const bunker = createBunker(footprint);
  await ensureStarterBaseParts(sql, playerId);
  await sql`
    INSERT INTO bunkers (player_id, footprint, core, parts, dug)
    VALUES (
      ${playerId},
      ${JSON.stringify(bunker.footprint)}::jsonb,
      ${JSON.stringify(bunker.core)}::jsonb,
      ${JSON.stringify(bunker.parts)}::jsonb,
      ${JSON.stringify(bunker.dug)}::jsonb
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
): Promise<BunkerOperationResult> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
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
  await saveBunkerAndInventory(sql, playerId, placed.bunker, placed.inventory);
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

export async function removeBunkerPart(
  sql: Sql,
  playerId: string,
  col: number,
  row: number,
  depth = 0,
): Promise<BunkerOperationResult> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  const removed = removeBasePart(view.bunker, view.inventory, col, row, depth);
  if (!removed.ok) {
    return {
      ok: false,
      status: 409,
      error: `cannot remove: ${removed.reason}`,
    };
  }
  await saveBunkerAndInventory(
    sql,
    playerId,
    removed.bunker,
    removed.inventory,
  );
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
): Promise<BunkerOperationResult> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
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
  await saveBunkerAndInventory(sql, playerId, moved.bunker, view.inventory);
  return { ok: true, view: await loadBunkerView(sql, playerId) };
}

export async function excavateBunker(
  sql: Sql,
  playerId: string,
  col: number,
  row: number,
  depth: number,
): Promise<BunkerOperationResult<{ newStamps?: string[] }>> {
  const view = await loadBunkerView(sql, playerId);
  if (!view.bunker)
    return { ok: false, status: 409, error: "claim a bunker first" };
  const dug = excavateBunkerCell(view.bunker, col, row, depth);
  if (!dug.ok) {
    return { ok: false, status: 409, error: `cannot dig: ${dug.reason}` };
  }
  await sql`
    UPDATE bunkers
    SET dug = ${JSON.stringify(dug.bunker.dug)}::jsonb,
        updated_at = now()
    WHERE player_id = ${playerId}`;
  // Groundbreaker is backfill-only: the empty patch increments nothing,
  // and the refresh inside applyAchievementProgress re-reads the
  // durable jsonb_array_length(bunkers.dug), which the UPDATE above
  // already includes, so the metric always equals the dug count.
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
  return { ok: true, view: latestView, newStamps };
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

async function saveBunkerAndInventory(
  sql: Sql,
  playerId: string,
  bunker: BunkerState,
  inventory: BasePartInventory,
): Promise<void> {
  await sql`
    UPDATE bunkers
    SET parts = ${JSON.stringify(bunker.parts)}::jsonb,
        updated_at = now()
    WHERE player_id = ${playerId}`;
  await saveBasePartInventory(sql, playerId, inventory);
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
  if (view.activeRaid)
    return { ok: false, status: 409, error: "finish the raid first" };
  const reset = applyBunkerReset(view.bunker, view.inventory);
  await sql`
    UPDATE bunkers
    SET parts = ${JSON.stringify(reset.bunker.parts)}::jsonb,
        dug = ${JSON.stringify(reset.bunker.dug)}::jsonb,
        core = ${JSON.stringify(reset.bunker.core)}::jsonb,
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
  if (view.activeRaid)
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
        parts = ${JSON.stringify(repaired.parts)}
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
  if (view.activeRaid)
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
