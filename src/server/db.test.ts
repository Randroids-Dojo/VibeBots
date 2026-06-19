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
});
