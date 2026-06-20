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

  it("creates the release push dispatch ledger", () => {
    const source = readFileSync("src/server/db.ts", "utf8");

    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS release_push_dispatches",
    );
    expect(source).toContain("notice_id text PRIMARY KEY");
    expect(source).toContain("release_version text NOT NULL");
    expect(source).toContain("status text NOT NULL DEFAULT 'sending'");
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
