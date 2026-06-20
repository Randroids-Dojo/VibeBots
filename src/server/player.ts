import { signToken, verifyToken } from "@randroids-dojo/vibekit/server";
import { cookies } from "next/headers";
import {
  dynamiteTier,
  LADDER_RECOVERY_FLOOR,
  type MineConsumables,
  type MineGear,
  type MineGearTrack,
  PLANK_RECOVERY_FLOOR,
} from "@/sim/mine";
import { db } from "./db";

/**
 * Guest-first identity (resolved plan): a signed httpOnly cookie carries
 * the player id. No signup friction; Clerk upgrades later claim the row
 * via the nullable clerk_user_id column (F-003).
 */

const COOKIE_NAME = "vb_player";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
type Sql = Awaited<ReturnType<typeof db>>;
export const SAVE_SLOT_IDS = [1, 2, 3] as const;
export type SaveSlotId = (typeof SAVE_SLOT_IDS)[number];
type SaveSlotKey = `${SaveSlotId}`;

export interface SaveSlotSession {
  activeSlot: SaveSlotId;
  slots: Partial<Record<SaveSlotKey, string>>;
}

export interface SaveSlotSummary {
  slot: SaveSlotId;
  active: boolean;
  exists: boolean;
  createdAt: string | null;
  balance: number;
  deepestDepth: number;
  partsOwned: number;
  designs: number;
  stamps: number;
}

export interface NormalizedSaveSlotSession {
  session: SaveSlotSession;
  migrated: boolean;
}

interface StartingSupportKitRow {
  ladder_count: number;
  plank_count: number;
  support_kit_granted_at: string | null;
  legacy_support_snapshot_reconciled_at: string | null;
}

export interface MinePlayerProfile {
  pickaxe_level: number;
  lamp_level: number;
  cargo_level: number;
  lantern_level: number;
  warpcoil_level: number;
  elevator_depth: number;
  blast_level: number;
  elevator_speed_level: number;
  fall_level: number;
  dynamite_count: number;
  rope_count: number;
  ladder_count: number;
  plank_count: number;
  beacon_count: number;
  emeralds: number;
  track_xp: number;
  defense_xp: number;
  deepest_depth: number;
  support_kit_granted_at: string | null;
  elevator_support_refund_at: string | null;
  legacy_support_snapshot_reconciled_at: string | null;
  dynamite_tier_unlock_reset_at: string | null;
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  return value;
}

function saveSlotKey(slot: SaveSlotId): SaveSlotKey {
  return String(slot) as SaveSlotKey;
}

function validSaveSlot(value: unknown): SaveSlotId | null {
  return SAVE_SLOT_IDS.find((slot) => slot === value) ?? null;
}

export function normalizeSaveSlotSessionPayload(
  payload: unknown,
): NormalizedSaveSlotSession | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as {
    playerId?: unknown;
    activeSlot?: unknown;
    slots?: unknown;
  };
  if (typeof raw.playerId === "string") {
    return {
      migrated: true,
      session: {
        activeSlot: 1,
        slots: { "1": raw.playerId },
      },
    };
  }
  const activeSlot = validSaveSlot(raw.activeSlot);
  if (!activeSlot || !raw.slots || typeof raw.slots !== "object") {
    return null;
  }
  const slots: SaveSlotSession["slots"] = {};
  const rawSlots = raw.slots as Record<string, unknown>;
  for (const slot of SAVE_SLOT_IDS) {
    const key = saveSlotKey(slot);
    if (typeof rawSlots[key] === "string") slots[key] = rawSlots[key];
  }
  return {
    migrated: false,
    session: { activeSlot, slots },
  };
}

async function readSaveSlotSession(): Promise<NormalizedSaveSlotSession | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifyToken(token, secret());
  return normalizeSaveSlotSessionPayload(payload);
}

async function writeSaveSlotSession(session: SaveSlotSession): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, signToken(session, secret()), {
    httpOnly: true,
    secure: true,
    // The game runs embedded in a cross-site iframe (VibeCoded.games loads
    // vibe-bots.vercel.app). A SameSite=Lax cookie is excluded from every
    // request whose frame ancestry is cross-site, so the player id never
    // returns and each call mints a fresh player: cash-out then hits "no
    // mine on file". SameSite=None + Partitioned (CHIPS) keeps the cookie
    // flowing, partitioned per top-level site, which browsers that block
    // unpartitioned third-party cookies still accept. Each embedding host
    // gets its own guest slots, which is fine for device-local saves.
    sameSite: "none",
    partitioned: true,
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}

async function createPlayer(sql: Sql): Promise<string> {
  // One-time starting kit: a fresh player begins with the basic ladder and
  // plank bundle so the first descent works without a shop visit. It is a
  // gift at account creation only, not a per-trip grant: once spent it is
  // bought back at the depot or refilled by dying (see MineState.granted).
  const rows = (await sql`
    INSERT INTO players (
      ladder_count,
      plank_count,
      support_kit_granted_at,
      legacy_support_snapshot_reconciled_at,
      dynamite_tier_unlock_reset_at
    )
    VALUES (${LADDER_RECOVERY_FLOOR}, ${PLANK_RECOVERY_FLOOR}, now(), now(), now())
    RETURNING id`) as Array<{
    id: string;
  }>;
  return rows[0].id;
}

/** Player id from a valid cookie, else null. Never creates rows. */
export async function currentPlayerId(): Promise<string | null> {
  const normalized = await readSaveSlotSession();
  if (!normalized) return null;
  return (
    normalized.session.slots[saveSlotKey(normalized.session.activeSlot)] ?? null
  );
}

export async function currentSaveSlotSession(): Promise<SaveSlotSession | null> {
  return (await readSaveSlotSession())?.session ?? null;
}

/**
 * Player id, creating the player row and setting the cookie on first
 * contact. Call only from route handlers (cookie writes).
 */
export async function getOrCreateActiveSaveSlot(): Promise<{
  playerId: string;
  session: SaveSlotSession;
}> {
  const normalized = await readSaveSlotSession();
  const session = normalized?.session ?? { activeSlot: 1, slots: {} };
  const activeKey = saveSlotKey(session.activeSlot);
  const existing = session.slots[activeKey];
  if (existing) {
    if (normalized?.migrated) await writeSaveSlotSession(session);
    return { playerId: existing, session };
  }
  const sql = await db();
  const playerId = await createPlayer(sql);
  const nextSession = {
    activeSlot: session.activeSlot,
    slots: { ...session.slots, [activeKey]: playerId },
  };
  await writeSaveSlotSession(nextSession);
  return { playerId, session: nextSession };
}

export async function getOrCreatePlayerId(): Promise<string> {
  const { playerId } = await getOrCreateActiveSaveSlot();
  return playerId;
}

export async function switchActiveSaveSlot(
  slot: SaveSlotId,
  options: { createIfMissing?: boolean } = {},
): Promise<{
  playerId: string | null;
  session: SaveSlotSession;
  created: boolean;
}> {
  const normalized = await readSaveSlotSession();
  const session = normalized?.session ?? { activeSlot: slot, slots: {} };
  const nextSession: SaveSlotSession = {
    activeSlot: slot,
    slots: { ...session.slots },
  };
  const key = saveSlotKey(slot);
  const existing = nextSession.slots[key] ?? null;
  if (!existing && !options.createIfMissing) {
    if (normalized?.migrated) await writeSaveSlotSession(session);
    return { playerId: null, session, created: false };
  }
  if (!existing && options.createIfMissing) {
    const sql = await db();
    nextSession.slots[key] = await createPlayer(sql);
  }
  await writeSaveSlotSession(nextSession);
  return {
    playerId: nextSession.slots[key] ?? null,
    session: nextSession,
    created: !existing && Boolean(nextSession.slots[key]),
  };
}

export async function deleteSaveSlot(
  slot: SaveSlotId,
): Promise<SaveSlotSession> {
  const normalized = await readSaveSlotSession();
  const session = normalized?.session ?? { activeSlot: 1, slots: {} };
  const key = saveSlotKey(slot);
  const playerId = session.slots[key];
  const nextSlots = { ...session.slots };
  delete nextSlots[key];
  const nextSession: SaveSlotSession = {
    activeSlot: session.activeSlot,
    slots: nextSlots,
  };
  if (playerId) {
    const sql = await db();
    await sql`DELETE FROM players WHERE id = ${playerId}`;
  }
  await writeSaveSlotSession(nextSession);
  return nextSession;
}

export async function saveSlotSummaries(
  sql: Sql,
  session: SaveSlotSession,
): Promise<SaveSlotSummary[]> {
  const summaries: SaveSlotSummary[] = [];
  for (const slot of SAVE_SLOT_IDS) {
    const playerId = session.slots[saveSlotKey(slot)];
    if (!playerId) {
      summaries.push({
        slot,
        active: session.activeSlot === slot,
        exists: false,
        createdAt: null,
        balance: 0,
        deepestDepth: 0,
        partsOwned: 0,
        designs: 0,
        stamps: 0,
      });
      continue;
    }
    const rows = (await sql`
      SELECT p.created_at,
             p.emeralds,
             p.deepest_depth,
             COALESCE((
               SELECT SUM(pp.count)::int
               FROM player_parts pp
               WHERE pp.player_id = p.id
             ), 0)::int AS parts_owned,
             (
               SELECT COUNT(*)::int
               FROM bot_designs bd
               WHERE bd.player_id = p.id
             ) AS designs,
             (
               SELECT COUNT(*)::int
               FROM player_achievements pa
               WHERE pa.player_id = p.id
             ) AS stamps
      FROM players p
      WHERE p.id = ${playerId}`) as Array<{
      created_at: string;
      emeralds: number;
      deepest_depth: number;
      parts_owned: number;
      designs: number;
      stamps: number;
    }>;
    const row = rows[0];
    summaries.push({
      slot,
      active: session.activeSlot === slot,
      exists: Boolean(row),
      createdAt: row?.created_at ?? null,
      balance: row?.emeralds ?? 0,
      deepestDepth: row?.deepest_depth ?? 0,
      partsOwned: row?.parts_owned ?? 0,
      designs: row?.designs ?? 0,
      stamps: row?.stamps ?? 0,
    });
  }
  return summaries;
}

/**
 * Existing rows can predate the one-time support kit. Mark and top them
 * up once, then future trips validate against the stored inventory.
 */
export async function ensureStartingSupportKit<T extends StartingSupportKitRow>(
  sql: Sql,
  playerId: string,
  row: T,
): Promise<T> {
  if (row.support_kit_granted_at) return row;
  const updated = (await sql`
    UPDATE players
    SET ladder_count = GREATEST(ladder_count, ${LADDER_RECOVERY_FLOOR}),
        plank_count = GREATEST(plank_count, ${PLANK_RECOVERY_FLOOR}),
        support_kit_granted_at = now(),
        legacy_support_snapshot_reconciled_at = COALESCE(
          legacy_support_snapshot_reconciled_at,
          now()
        )
    WHERE id = ${playerId}
      AND support_kit_granted_at IS NULL
    RETURNING ladder_count,
              plank_count,
              support_kit_granted_at,
              legacy_support_snapshot_reconciled_at`) as Array<StartingSupportKitRow>;
  return updated[0] ? { ...row, ...updated[0] } : row;
}

export async function getMinePlayerProfile(
  sql: Sql,
  playerId: string,
): Promise<MinePlayerProfile | null> {
  const rows = (await sql`
    SELECT pickaxe_level, lamp_level, cargo_level, lantern_level,
           warpcoil_level, elevator_depth, blast_level, elevator_speed_level,
           fall_level, dynamite_count, rope_count, ladder_count, plank_count,
           beacon_count, emeralds, track_xp, defense_xp, deepest_depth,
           support_kit_granted_at, elevator_support_refund_at,
           legacy_support_snapshot_reconciled_at,
           dynamite_tier_unlock_reset_at
    FROM players WHERE id = ${playerId}`) as Array<MinePlayerProfile>;
  return rows[0]
    ? await ensureStartingSupportKit(sql, playerId, rows[0])
    : null;
}

export function mineConsumablesFromProfile(
  row: MinePlayerProfile,
): MineConsumables {
  return {
    dynamite: row.dynamite_count,
    rope: row.rope_count,
    ladder: row.ladder_count,
    plank: row.plank_count,
    beacon: row.beacon_count,
  };
}

export function mineGearFromProfile(row: MinePlayerProfile): MineGear {
  return {
    pickaxe: row.pickaxe_level,
    battery: row.lamp_level,
    cargo: row.cargo_level,
    lantern: row.lantern_level,
    elevator: row.elevator_depth,
    warpcoil: row.warpcoil_level,
    blast: dynamiteTier({ blast: row.blast_level }),
    elevatorSpeed: row.elevator_speed_level,
    fall: row.fall_level,
  };
}

export function mineGearLevelFromProfile(
  row: MinePlayerProfile,
  track: MineGearTrack,
): number {
  switch (track) {
    case "pickaxe":
      return row.pickaxe_level;
    case "battery":
      return row.lamp_level;
    case "cargo":
      return row.cargo_level;
    case "lantern":
      return row.lantern_level;
    case "warpcoil":
      return row.warpcoil_level;
    case "blast":
      return row.blast_level;
    case "elevatorSpeed":
      return row.elevator_speed_level;
    case "fall":
      return row.fall_level;
  }
}
