import { describe, expect, it } from "vitest";
import {
  type MinePlayerProfile,
  mineConsumablesFromProfile,
  mineGearFromProfile,
  mineGearLevelFromProfile,
  normalizeSaveSlotSessionPayload,
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
  dynamite_count: 1,
  rope_count: 2,
  ladder_count: 3,
  plank_count: 4,
  beacon_count: 5,
  emeralds: 99,
  support_kit_granted_at: "2026-06-17T00:00:00.000Z",
  elevator_support_refund_at: null,
  legacy_support_snapshot_reconciled_at: "2026-06-17T00:00:00.000Z",
  dynamite_tier_unlock_reset_at: "2026-06-18T00:00:00.000Z",
};

describe("mine player profile helpers", () => {
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
});
