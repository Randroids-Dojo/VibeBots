import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, storageConfigured } from "@/server/db";
import { getMinePlayerProfile, getOrCreatePlayerId } from "@/server/player";
import type { WorldDiff } from "@/sim/mine";
import { POST } from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/achievements", () => ({
  applyAchievementProgress: vi.fn(async () => []),
}));

vi.mock("@/server/balance-telemetry", () => ({
  recordBalanceEvent: vi.fn(async () => undefined),
}));

vi.mock("@/server/player", () => ({
  getMinePlayerProfile: vi.fn(),
  getOrCreatePlayerId: vi.fn(async () => "player-1"),
}));

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedProfile = vi.mocked(getMinePlayerProfile);
const mockedPlayerId = vi.mocked(getOrCreatePlayerId);

function buy(item: string, quantity = 1): Promise<Response> {
  return POST(
    new Request("http://localhost/api/consumables/buy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item, quantity }),
    }),
  );
}

function mockSql(diff: WorldDiff = [], boughtBeaconCount: number | null = 2) {
  const sql = vi.fn(async () => {
    const calls = sql.mock.calls as unknown as Array<[TemplateStringsArray]>;
    const query = calls[calls.length - 1]?.[0]?.join(" ") ?? "";
    if (query.includes("SELECT diff FROM mine_worlds")) return [{ diff }];
    if (query.includes("beacon_count = beacon_count")) {
      if (boughtBeaconCount === null) return [];
      return [{ emeralds: 40, count: boughtBeaconCount }];
    }
    return [{ emeralds: 40, count: 1 }];
  });
  mockedDb.mockResolvedValue(sql as never);
  return sql;
}

describe("POST /api/consumables/buy", () => {
  beforeEach(() => {
    mockedStorageConfigured.mockReturnValue(true);
    mockedDb.mockReset();
    mockedPlayerId.mockResolvedValue("player-1");
    mockedProfile.mockResolvedValue({
      beacon_count: 0,
      defense_xp: 0,
      emeralds: 200,
    } as never);
  });

  it("reports newly collected stamps so the client can pop the alert", async () => {
    const { applyAchievementProgress } = await import("@/server/achievements");
    vi.mocked(applyAchievementProgress).mockResolvedValueOnce([
      "tool-depot-regular",
    ]);
    mockSql();

    const res = await buy("ladder");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      item: "ladder",
      newStamps: ["tool-depot-regular"],
    });
  });

  it("keeps a successful purchase alive when the stamp ledger fails", async () => {
    const { applyAchievementProgress } = await import("@/server/achievements");
    vi.mocked(applyAchievementProgress).mockRejectedValueOnce(
      new Error("stamp ledger down"),
    );
    mockSql();

    const res = await buy("ladder");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      item: "ladder",
      newStamps: [],
    });
  });

  it("rejects a third unplaced beacon kit", async () => {
    mockSql();
    mockedProfile.mockResolvedValue({
      beacon_count: 2,
      defense_xp: 0,
      emeralds: 200,
    } as never);

    const res = await buy("beacon");

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "beacon limit reached: level 1 allows 2 total",
      code: "beacon_limit",
      level: 1,
      beaconLimit: 2,
      ownedTotal: 2,
    });
  });

  it("counts placed beacons toward the beacon purchase limit", async () => {
    mockSql([[0, 4, { kind: "empty", beacon: true }]]);
    mockedProfile.mockResolvedValue({
      beacon_count: 1,
      defense_xp: 0,
      emeralds: 200,
    } as never);

    const res = await buy("beacon");

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "beacon limit reached: level 1 allows 2 total",
      code: "beacon_limit",
      level: 1,
      beaconLimit: 2,
      ownedTotal: 2,
    });
  });

  it("allows beacon purchases that stay under the total limit", async () => {
    const sql = mockSql();
    mockedProfile.mockResolvedValue({
      beacon_count: 1,
      defense_xp: 0,
      emeralds: 200,
    } as never);

    const res = await buy("beacon");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      item: "beacon",
      quantity: 1,
      count: 2,
      balance: 40,
    });
    expect(sql).toHaveBeenCalled();
  });

  it("allows the third total beacon at player level two", async () => {
    const sql = mockSql([], 3);
    mockedProfile.mockResolvedValue({
      beacon_count: 2,
      defense_xp: 100,
      emeralds: 200,
    } as never);

    const res = await buy("beacon");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      item: "beacon",
      quantity: 1,
      count: 3,
      balance: 40,
    });
    expect(sql).toHaveBeenCalled();
  });

  it("returns the level-aware beacon cap error when the atomic update loses capacity", async () => {
    mockSql([], null);
    mockedProfile.mockResolvedValue({
      beacon_count: 2,
      defense_xp: 100,
      emeralds: 200,
    } as never);

    const res = await buy("beacon");

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "beacon limit reached: level 2 allows 3 total",
      code: "beacon_limit",
      level: 2,
      beaconLimit: 3,
      ownedTotal: 3,
    });
  });
});
