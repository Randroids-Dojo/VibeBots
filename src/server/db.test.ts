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
});
