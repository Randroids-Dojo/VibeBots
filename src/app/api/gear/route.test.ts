import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, storageConfigured } from "@/server/db";
import { getMinePlayerProfile, getOrCreatePlayerId } from "@/server/player";
import { GET } from "./route";

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
const mockedStorage = vi.mocked(storageConfigured);
const mockedProfile = vi.mocked(getMinePlayerProfile);
const mockedPlayer = vi.mocked(getOrCreatePlayerId);

function profile(
  elevator_depth: number,
  elevator_col: number | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    pickaxe_level: 1,
    lamp_level: 1,
    cargo_level: 1,
    lantern_level: 1,
    warpcoil_level: 1,
    elevator_depth,
    elevator_col,
    blast_level: 1,
    elevator_speed_level: 1,
    fall_level: 1,
    recall_level: 1,
    dynamite_count: 0,
    rope_count: 0,
    ladder_count: 8,
    plank_count: 4,
    beacon_count: 0,
    emeralds: 100,
    track_xp: 0,
    defense_xp: 0,
    deepest_depth: 0,
    support_kit_granted_at: "now",
    elevator_support_refund_at: null,
    elevator_column_migrated_at: "now",
    elevator_rail_installed_at: "now",
    elevator_placement_chosen_at: elevator_depth > 0 ? "now" : null,
    legacy_support_snapshot_reconciled_at: "now",
    dynamite_tier_unlock_reset_at: "now",
    ...overrides,
  };
}

describe("GET /api/gear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStorage.mockReturnValue(true);
    mockedDb.mockResolvedValue(vi.fn() as never);
    mockedPlayer.mockResolvedValue("player-1");
  });

  it("returns the player's chosen elevator column", async () => {
    mockedProfile.mockResolvedValue(profile(4, 71));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      gear: { elevator: 4, elevatorColumn: 71 },
      elevatorPlacementRequired: false,
    });
  });

  it("offers existing owners one placement choice", async () => {
    mockedProfile.mockResolvedValue(
      profile(4, -5, { elevator_placement_chosen_at: null }),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      gear: { elevator: 4, elevatorColumn: -5 },
      elevatorPlacementRequired: true,
    });
  });

  it("keeps new profiles unplaced when no player row exists", async () => {
    mockedProfile.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      gear: { elevator: 0, elevatorColumn: null },
      elevatorPlacementRequired: false,
    });
  });
});
