import { neon } from "@neondatabase/serverless";

/**
 * The project's single dedicated Neon Postgres (AGENTS.md Rule 11).
 * Schema is applied lazily once per server instance; tables are
 * idempotent CREATE IF NOT EXISTS so cold starts are safe and cheap.
 */

export function storageConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.AUTH_SECRET);
}

type Sql = ReturnType<typeof neon>;

let client: Sql | null = null;
let schemaReady: Promise<void> | null = null;

function sqlClient(): Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = neon(url);
  }
  return client;
}

async function applySchema(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS players (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      clerk_user_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      credits integer NOT NULL DEFAULT 0,
      track_xp integer NOT NULL DEFAULT 0,
      emeralds integer NOT NULL DEFAULT 0,
      deepest_depth integer NOT NULL DEFAULT 0
    )`;
  // Existing deployments predate the column (REQ-012 milestone record).
  await sql`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS deepest_depth integer NOT NULL DEFAULT 0`;
  // Gear tracks (REQ-013); levels start at 1.
  await sql`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS pickaxe_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS lamp_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS cargo_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS lantern_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS blast_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS elevator_speed_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS fall_level integer NOT NULL DEFAULT 1`;
  // Consumables (REQ-016); ladders joined in REQ-020, planks in REQ-022.
  await sql`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS dynamite_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rope_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ladder_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS plank_count integer NOT NULL DEFAULT 0`;
  // The elevator rail (REQ-028) and teleporter (REQ-029).
  await sql`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS elevator_depth integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS warpcoil_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS beacon_count integer NOT NULL DEFAULT 0`;
  await sql`
    CREATE TABLE IF NOT EXISTS player_parts (
      player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      part_id text NOT NULL,
      count integer NOT NULL DEFAULT 0,
      PRIMARY KEY (player_id, part_id)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS mine_runs (
      player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      seed bigint NOT NULL,
      banked_emeralds integer NOT NULL,
      banked_parts jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, seed)
    )`;
  // The persistent mine (REQ-026/Q-009): one world per player, the
  // sparse diff checkpointed at each cash-out, trip_count as replay guard.
  await sql`
    CREATE TABLE IF NOT EXISTS mine_worlds (
      player_id uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      seed bigint NOT NULL,
      diff jsonb NOT NULL DEFAULT '[]'::jsonb,
      trip_count integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS bot_designs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      name text NOT NULL,
      design jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (player_id, name)
    )`;
}

/** The shared SQL client, with the schema guaranteed applied. */
export async function db(): Promise<Sql> {
  const sql = sqlClient();
  if (!schemaReady) {
    schemaReady = applySchema(sql).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
  return sql;
}
