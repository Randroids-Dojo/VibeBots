import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAYER_COMPATIBILITY_MARKERS } from "./db";

describe("compatibility migration markers", () => {
  it("keeps every registered player marker in lazy schema setup", () => {
    const source = readFileSync("src/server/db.ts", "utf8");
    for (const marker of PLAYER_COMPATIBILITY_MARKERS) {
      expect(source).toContain(`ADD COLUMN IF NOT EXISTS ${marker}`);
    }
  });

  it("marks a new player past the merge-level wipe at creation, so a cold start never wipes them (F-256)", () => {
    const source = readFileSync("src/server/player.ts", "utf8");
    const insert = source.slice(
      source.indexOf("INSERT INTO players ("),
      source.indexOf("RETURNING id"),
    );
    expect(insert).toContain("merge_levels_retired_at");
    // Every destructive one-time marker is set at creation; the wipe keys
    // on NULL, and a player born after the wipe must never read as NULL.
    expect(insert).toContain("dynamite_tier_unlock_reset_at");
    expect((insert.match(/now\(\)/g) ?? []).length).toBe(4);
  });

  it("wipes designs and part inventories once when merge levels retire (F-230)", () => {
    const source = readFileSync("src/server/db.ts", "utf8");
    expect(source).toContain(
      "ADD COLUMN IF NOT EXISTS merge_levels_retired_at",
    );
    expect(source).toContain("DELETE FROM bot_designs");
    expect(source).toContain("DELETE FROM player_parts");
    expect(source).toContain("SET merge_levels_retired_at = now()");
    expect(source).toContain("WHERE achievement_id = 'tools-mastercrafted'");
  });

  it("preserves legacy rail columns without placing shafts for new players", () => {
    const source = readFileSync("src/server/db.ts", "utf8");

    expect(source).toContain("ADD COLUMN IF NOT EXISTS elevator_col integer");
    expect(source).toContain("WHEN elevator_depth > 0");
    expect(source).toContain("COALESCE(elevator_col, -5)");
    expect(source).toContain("WHERE elevator_column_migrated_at IS NULL");
  });

  it("adds the bench-rule count to match records (F-252)", () => {
    const source = readFileSync("src/server/db.ts", "utf8");

    expect(source).toContain(
      "ADD COLUMN IF NOT EXISTS rule_count integer NOT NULL DEFAULT 0",
    );
  });

  it("adds the arena id to match records (arenas program)", () => {
    const source = readFileSync("src/server/db.ts", "utf8");

    expect(source).toContain(
      "ADD COLUMN IF NOT EXISTS arena_id text NOT NULL DEFAULT 'ring'",
    );
  });

  it("creates the release push dispatch ledger", () => {
    const source = readFileSync("src/server/db.ts", "utf8");

    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS release_push_dispatches",
    );
    expect(source).toContain("notice_id text PRIMARY KEY");
    expect(source).toContain("release_version text NOT NULL");
    expect(source).toContain("status text NOT NULL DEFAULT 'sending'");
  });

  it("creates the durable elevator outcome outbox", () => {
    const source = readFileSync("src/server/db.ts", "utf8");

    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS elevator_upgrade_outcomes",
    );
    // The unique request id is what makes the durable record exactly-once.
    expect(source).toContain("request_id uuid NOT NULL UNIQUE");
    expect(source).toContain("delivered_at timestamptz");
    // The partial index keeps the recovery drain cheap as the table grows.
    expect(source).toContain(
      "CREATE INDEX IF NOT EXISTS elevator_upgrade_outcomes_undelivered_idx",
    );
    expect(source).toContain("WHERE delivered_at IS NULL");
  });

  it("creates the account-linking uniqueness guard", () => {
    const source = readFileSync("src/server/db.ts", "utf8");

    expect(source).toContain("ADD COLUMN IF NOT EXISTS clerk_user_id");
    expect(source).toContain("players_clerk_user_id_unique");
    expect(source).toContain("ON players (clerk_user_id)");
    expect(source).toContain("WHERE clerk_user_id IS NOT NULL");
  });

  it("creates the account handoff table", () => {
    const source = readFileSync("src/server/db.ts", "utf8");

    expect(source).toContain("CREATE TABLE IF NOT EXISTS account_handoffs");
    expect(source).toContain("token text PRIMARY KEY");
    expect(source).toContain("consumed_at timestamptz");
    expect(source).toContain("account_handoffs_player_created_at_idx");
    expect(source).toContain("account_handoffs_expires_at_idx");
    expect(source).toContain("ON account_handoffs (expires_at)");
  });

  it("creates the mine trip checkpoint table", () => {
    const source = readFileSync("src/server/db.ts", "utf8");

    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS mine_trip_checkpoints",
    );
    expect(source).toContain("trip jsonb NOT NULL");
    expect(source).toContain("PRIMARY KEY REFERENCES players(id)");
  });

  it("creates the player performance sample table", () => {
    const source = readFileSync("src/server/db.ts", "utf8");

    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS player_performance_samples",
    );
    expect(source).toContain("p95_frame_ms real NOT NULL");
    expect(source).toContain("player_performance_samples_p95_idx");
  });

  it("creates the player balance event table", () => {
    const source = readFileSync("src/server/db.ts", "utf8");

    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS player_balance_events",
    );
    expect(source).toContain("event text NOT NULL");
    expect(source).toContain("properties jsonb NOT NULL");
    expect(source).toContain("player_balance_events_player_created_at_idx");
  });
});
