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

/**
 * Durable marker columns for one-time compatibility paths. Any future
 * existing-player cleanup should add its player marker here and in schema.
 */
export const PLAYER_COMPATIBILITY_MARKERS = [
  "support_kit_granted_at",
  "elevator_support_refund_at",
  "legacy_support_snapshot_reconciled_at",
  "dynamite_tier_unlock_reset_at",
] as const;

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
  await sql`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS defense_xp integer NOT NULL DEFAULT 0`;
  // Gear tracks (REQ-013); levels start at 1.
  await sql`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS pickaxe_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS lamp_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS cargo_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS lantern_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS blast_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS elevator_speed_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS fall_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS recall_level integer NOT NULL DEFAULT 1`;
  // Consumables (REQ-016); ladders joined in REQ-020, planks in REQ-022.
  await sql`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS dynamite_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rope_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ladder_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS plank_count integer NOT NULL DEFAULT 0`;
  await sql`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS support_kit_granted_at timestamptz`;
  await sql`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS legacy_support_snapshot_reconciled_at timestamptz`;
  await sql`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS dynamite_tier_unlock_reset_at timestamptz`;
  await sql`
    UPDATE players
    SET blast_level = 1,
        dynamite_tier_unlock_reset_at = now()
    WHERE dynamite_tier_unlock_reset_at IS NULL`;
  // The elevator rail (REQ-028) and teleporter (REQ-029).
  await sql`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS elevator_depth integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS warpcoil_level integer NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS beacon_count integer NOT NULL DEFAULT 0`;
  await sql`
    ALTER TABLE players
    ADD COLUMN IF NOT EXISTS elevator_support_refund_at timestamptz`;
  await sql`
    CREATE TABLE IF NOT EXISTS player_parts (
      player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      part_id text NOT NULL,
      count integer NOT NULL DEFAULT 0,
      PRIMARY KEY (player_id, part_id)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS player_base_parts (
      player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      part_id text NOT NULL,
      count integer NOT NULL DEFAULT 0,
      PRIMARY KEY (player_id, part_id)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS bunkers (
      player_id uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      footprint jsonb NOT NULL,
      core jsonb NOT NULL,
      parts jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS bunker_raids (
      player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      raid_id text NOT NULL,
      tier integer NOT NULL,
      snapshot jsonb NOT NULL,
      started_at timestamptz NOT NULL DEFAULT now(),
      duration_seconds integer NOT NULL,
      result jsonb,
      rewarded_at timestamptz,
      PRIMARY KEY (player_id, raid_id)
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
  await sql`
    CREATE TABLE IF NOT EXISTS player_achievements (
      player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      achievement_id text NOT NULL,
      unlocked_at timestamptz NOT NULL DEFAULT now(),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (player_id, achievement_id)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS player_achievement_stats (
      player_id uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      stats jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS web_push_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      endpoint text NOT NULL UNIQUE,
      p256dh text NOT NULL,
      auth text NOT NULL,
      platform text NOT NULL DEFAULT 'unknown',
      user_agent text NOT NULL DEFAULT '',
      enabled boolean NOT NULL DEFAULT true,
      last_release_notice_id text,
      last_sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS release_push_dispatches (
      notice_id text PRIMARY KEY,
      release_version text NOT NULL,
      status text NOT NULL DEFAULT 'sending',
      attempted integer NOT NULL DEFAULT 0,
      sent integer NOT NULL DEFAULT 0,
      expired integer NOT NULL DEFAULT 0,
      failed integer NOT NULL DEFAULT 0,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS player_feedback (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      category text NOT NULL,
      comment text NOT NULL DEFAULT '',
      contact_email text,
      context jsonb NOT NULL DEFAULT '{}'::jsonb,
      user_agent text NOT NULL DEFAULT '',
      reviewed boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE INDEX IF NOT EXISTS player_feedback_reviewed_created_at_idx
    ON player_feedback (reviewed, created_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS player_performance_samples (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      source text NOT NULL,
      app_version text NOT NULL,
      app_build integer,
      mine_version integer NOT NULL,
      duration_ms integer NOT NULL,
      frame_count integer NOT NULL,
      avg_frame_ms real NOT NULL,
      p50_frame_ms real NOT NULL,
      p95_frame_ms real NOT NULL,
      max_frame_ms real NOT NULL,
      long_frame_count integer NOT NULL,
      draw_calls_avg real,
      draw_calls_max integer,
      viewport_width integer NOT NULL,
      viewport_height integer NOT NULL,
      device_pixel_ratio real NOT NULL,
      hardware_concurrency integer,
      device_memory_gb real,
      renderer text,
      visibility_state text,
      user_agent text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE INDEX IF NOT EXISTS player_performance_samples_created_at_idx
    ON player_performance_samples (created_at DESC)`;
  await sql`
    CREATE INDEX IF NOT EXISTS player_performance_samples_p95_idx
    ON player_performance_samples (p95_frame_ms DESC, created_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS player_balance_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      event text NOT NULL,
      app_version text NOT NULL,
      mine_version integer,
      properties jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE INDEX IF NOT EXISTS player_balance_events_player_created_at_idx
    ON player_balance_events (player_id, created_at DESC)`;
  await sql`
    CREATE INDEX IF NOT EXISTS player_balance_events_event_created_at_idx
    ON player_balance_events (event, created_at DESC)`;
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
