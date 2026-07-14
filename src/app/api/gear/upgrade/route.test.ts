import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshPlayerAchievements } from "@/server/achievements";
import { recordBalanceEvent } from "@/server/balance-telemetry";
import { db, storageConfigured } from "@/server/db";
import {
  getMinePlayerProfile,
  getOrCreatePlayerId,
  mineGearLevelFromProfile,
} from "@/server/player";
import { POST } from "./route";

vi.mock("@/server/achievements", () => ({
  refreshPlayerAchievements: vi.fn(async () => ({
    achievements: [],
    newlyUnlocked: [],
  })),
}));

vi.mock("@/server/balance-telemetry", () => ({
  recordBalanceEvent: vi.fn(async () => undefined),
}));

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/player", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/player")>();
  return {
    ...actual,
    getMinePlayerProfile: vi.fn(),
    getOrCreatePlayerId: vi.fn(async () => "player-1"),
  };
});

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedProfile = vi.mocked(getMinePlayerProfile);
const mockedPlayer = vi.mocked(getOrCreatePlayerId);
const mockedRefresh = vi.mocked(refreshPlayerAchievements);
const mockedRecord = vi.mocked(recordBalanceEvent);
const sql = vi.fn(async (strings: TemplateStringsArray) => {
  const query = strings.join("");
  if (query.includes("RETURNING emeralds, cargo_level AS level")) {
    return [{ emeralds: 420, level: 2 }];
  }
  return [];
});

function profile(overrides: Record<string, unknown> = {}) {
  return {
    pickaxe_level: 1,
    lamp_level: 1,
    cargo_level: 1,
    lantern_level: 1,
    warpcoil_level: 1,
    elevator_depth: 0,
    elevator_col: null,
    blast_level: 1,
    elevator_speed_level: 1,
    fall_level: 1,
    dynamite_count: 0,
    rope_count: 0,
    ladder_count: 8,
    plank_count: 4,
    beacon_count: 0,
    emeralds: 500,
    track_xp: 0,
    defense_xp: 0,
    deepest_depth: 0,
    support_kit_granted_at: "now",
    elevator_support_refund_at: null,
    elevator_column_migrated_at: "now",
    elevator_rail_installed_at: "now",
    elevator_placement_chosen_at: "now",
    legacy_support_snapshot_reconciled_at: "now",
    dynamite_tier_unlock_reset_at: "now",
    ...overrides,
  };
}

function submit(track: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/gear/upgrade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track }),
    }),
  );
}

describe("gear upgrade route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.mockResolvedValue(sql as never);
    mockedStorageConfigured.mockReturnValue(true);
    mockedPlayer.mockResolvedValue("player-1");
    mockedProfile.mockResolvedValue(profile() as never);
  });

  it("rejects upgrades before the required player level", async () => {
    mockedProfile.mockResolvedValue(
      profile({ deepest_depth: 999, defense_xp: 0 }) as never,
    );

    const res = await submit("warpcoil");

    expect(res.status).toBe(423);
    await expect(res.json()).resolves.toMatchObject({
      error: "requires player level 8",
      requiredPlayerLevel: 8,
      playerLevel: 1,
    });
    expect(sql).not.toHaveBeenCalled();
  });

  it("rejects upgrades before the required max depth", async () => {
    mockedProfile.mockResolvedValue(
      profile({ deepest_depth: 10, defense_xp: 10_000 }) as never,
    );

    const res = await submit("warpcoil");

    expect(res.status).toBe(423);
    await expect(res.json()).resolves.toMatchObject({
      error: "requires depth 50",
      requiredDepth: 50,
      deepestDepth: 10,
    });
    expect(sql).not.toHaveBeenCalled();
  });

  it("records telemetry after a successful upgrade", async () => {
    const res = await submit("cargo");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      track: "cargo",
      level: 2,
      balance: 420,
      newStamps: [],
    });
    expect(mineGearLevelFromProfile(profile() as never, "cargo")).toBe(1);
    expect(mockedRefresh).toHaveBeenCalledWith(sql, "player-1");
    expect(mockedRecord).toHaveBeenCalledWith(
      sql,
      "player-1",
      "gear.upgrade",
      expect.objectContaining({
        track: "cargo",
        fromLevel: 1,
        toLevel: 2,
        price: 80,
        balanceAfter: 420,
      }),
    );
  });
});
