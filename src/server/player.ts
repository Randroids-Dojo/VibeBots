import { signToken, verifyToken } from "@randroids-dojo/vibekit/server";
import { cookies } from "next/headers";
import {
  LADDER_RECOVERY_FLOOR,
  type MineConsumables,
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

interface StartingSupportKitRow {
  ladder_count: number;
  plank_count: number;
  support_kit_granted_at: string | null;
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
  support_kit_granted_at: string | null;
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set");
  return value;
}

/** Player id from a valid cookie, else null. Never creates rows. */
export async function currentPlayerId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifyToken(token, secret()) as {
    playerId?: unknown;
  } | null;
  if (!payload || typeof payload.playerId !== "string") return null;
  return payload.playerId;
}

/**
 * Player id, creating the player row and setting the cookie on first
 * contact. Call only from route handlers (cookie writes).
 */
export async function getOrCreatePlayerId(): Promise<string> {
  const existing = await currentPlayerId();
  if (existing) return existing;
  const sql = await db();
  // One-time starting kit: a fresh player begins with the basic ladder and
  // plank bundle so the first descent works without a shop visit. It is a
  // gift at account creation only, not a per-trip grant: once spent it is
  // bought back at the depot or refilled by dying (see MineState.granted).
  const rows = (await sql`
    INSERT INTO players (ladder_count, plank_count, support_kit_granted_at)
    VALUES (${LADDER_RECOVERY_FLOOR}, ${PLANK_RECOVERY_FLOOR}, now())
    RETURNING id`) as Array<{
    id: string;
  }>;
  const playerId = rows[0].id;
  const jar = await cookies();
  jar.set(COOKIE_NAME, signToken({ playerId }, secret()), {
    httpOnly: true,
    secure: true,
    // The game runs embedded in a cross-site iframe (VibeCoded.games loads
    // vibe-bots.vercel.app). A SameSite=Lax cookie is excluded from every
    // request whose frame ancestry is cross-site, so the player id never
    // returns and each call mints a fresh player: cash-out then hits "no
    // mine on file". SameSite=None + Partitioned (CHIPS) keeps the cookie
    // flowing, partitioned per top-level site, which browsers that block
    // unpartitioned third-party cookies still accept. Each embedding host
    // gets its own guest mine, which is fine for guest-first identity.
    sameSite: "none",
    partitioned: true,
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return playerId;
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
        support_kit_granted_at = now()
    WHERE id = ${playerId}
      AND support_kit_granted_at IS NULL
    RETURNING ladder_count, plank_count, support_kit_granted_at`) as Array<StartingSupportKitRow>;
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
           beacon_count, emeralds, support_kit_granted_at
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
