import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieValue: null as string | null,
  cookieSet: vi.fn(),
  createdPlayerIndex: 0,
  db: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() =>
      mocks.cookieValue ? { value: mocks.cookieValue } : undefined,
    ),
    set: mocks.cookieSet,
  })),
}));

vi.mock("@randroids-dojo/vibekit/server", () => ({
  signToken: vi.fn((payload: unknown) => JSON.stringify(payload)),
  verifyToken: vi.fn((token: string) => JSON.parse(token)),
}));

vi.mock("./db", () => ({
  db: mocks.db,
}));

import {
  type MinePlayerProfile,
  mineConsumablesFromProfile,
  mineGearFromProfile,
  mineGearLevelFromProfile,
  normalizeSaveSlotSessionPayload,
  switchActiveSaveSlot,
} from "./player";

const profile: MinePlayerProfile = {
  pickaxe_level: 2,
  lamp_level: 3,
  cargo_level: 4,
  lantern_level: 5,
  warpcoil_level: 6,
  elevator_depth: 120,
  blast_level: 7,
  elevator_speed_level: 8,
  fall_level: 9,
  recall_level: 10,
  dynamite_count: 1,
  rope_count: 2,
  ladder_count: 3,
  plank_count: 4,
  beacon_count: 5,
  emeralds: 99,
  track_xp: 20,
  defense_xp: 30,
  deepest_depth: 40,
  support_kit_granted_at: "2026-06-17T00:00:00.000Z",
  elevator_support_refund_at: null,
  legacy_support_snapshot_reconciled_at: "2026-06-17T00:00:00.000Z",
  dynamite_tier_unlock_reset_at: "2026-06-18T00:00:00.000Z",
};

describe("mine player profile helpers", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret";
    mocks.cookieValue = null;
    mocks.createdPlayerIndex = 0;
    mocks.cookieSet.mockClear();
    mocks.sql = vi.fn(async () => {
      mocks.createdPlayerIndex += 1;
      return [{ id: `created-player-${mocks.createdPlayerIndex}` }];
    });
    mocks.db.mockReset();
    mocks.db.mockResolvedValue(mocks.sql);
  });

  it("maps stored player columns to replay gear", () => {
    expect(mineGearFromProfile(profile)).toEqual({
      pickaxe: 2,
      battery: 3,
      cargo: 4,
      lantern: 5,
      elevator: 120,
      warpcoil: 6,
      blast: 4,
      elevatorSpeed: 8,
      fall: 9,
      recall: 10,
    });
  });

  it("maps stored player columns to consumable stock", () => {
    expect(mineConsumablesFromProfile(profile)).toEqual({
      dynamite: 1,
      rope: 2,
      ladder: 3,
      plank: 4,
      beacon: 5,
    });
  });

  it("reads individual gear track levels from storage columns", () => {
    expect(mineGearLevelFromProfile(profile, "battery")).toBe(3);
    expect(mineGearLevelFromProfile(profile, "elevatorSpeed")).toBe(8);
    expect(mineGearLevelFromProfile(profile, "fall")).toBe(9);
    expect(mineGearLevelFromProfile(profile, "recall")).toBe(10);
  });

  it("normalizes a legacy player cookie into slot 1", () => {
    expect(normalizeSaveSlotSessionPayload({ playerId: "player-1" })).toEqual({
      migrated: true,
      session: {
        activeSlot: 1,
        slots: { "1": "player-1" },
      },
    });
  });

  it("keeps a three-slot cookie shape", () => {
    expect(
      normalizeSaveSlotSessionPayload({
        activeSlot: 2,
        slots: { "1": "player-1", "2": "player-2", extra: "ignored" },
      }),
    ).toEqual({
      migrated: false,
      session: {
        activeSlot: 2,
        slots: { "1": "player-1", "2": "player-2" },
      },
    });
  });

  it("rejects invalid slot cookie payloads", () => {
    expect(normalizeSaveSlotSessionPayload({ activeSlot: 4, slots: {} })).toBe(
      null,
    );
    expect(normalizeSaveSlotSessionPayload({ activeSlot: 1 })).toBe(null);
  });

  it("does not create an empty save slot when create is not explicit", async () => {
    mocks.cookieValue = JSON.stringify({
      activeSlot: 1,
      slots: { "1": "initial-player" },
    });

    const result = await switchActiveSaveSlot(2);

    expect(result).toEqual({
      playerId: null,
      session: {
        activeSlot: 1,
        slots: { "1": "initial-player" },
      },
      created: false,
    });
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("starts an empty save slot only when create is explicit", async () => {
    mocks.cookieValue = JSON.stringify({
      activeSlot: 1,
      slots: { "1": "initial-player" },
    });

    const result = await switchActiveSaveSlot(2, { createIfMissing: true });

    expect(result).toEqual({
      playerId: "created-player-1",
      session: {
        activeSlot: 2,
        slots: { "1": "initial-player", "2": "created-player-1" },
      },
      created: true,
    });
    expect(mocks.db).toHaveBeenCalledTimes(1);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "vb_player",
      JSON.stringify(result.session),
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
  });

  it("switches existing save slots without creating a player", async () => {
    mocks.cookieValue = JSON.stringify({
      activeSlot: 1,
      slots: { "1": "initial-player", "2": "second-player" },
    });

    const result = await switchActiveSaveSlot(2);

    expect(result).toEqual({
      playerId: "second-player",
      session: {
        activeSlot: 2,
        slots: { "1": "initial-player", "2": "second-player" },
      },
      created: false,
    });
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "vb_player",
      JSON.stringify(result.session),
      expect.objectContaining({ httpOnly: true, path: "/" }),
    );
  });
});
