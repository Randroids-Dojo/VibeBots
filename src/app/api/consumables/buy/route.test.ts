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
  applyAchievementProgress: vi.fn(async () => {}),
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

function mockSql(diff: WorldDiff = []) {
  const sql = vi.fn(async () => {
    const calls = sql.mock.calls as unknown as Array<[TemplateStringsArray]>;
    const query = calls[calls.length - 1]?.[0]?.join(" ") ?? "";
    if (query.includes("SELECT diff FROM mine_worlds")) return [{ diff }];
    if (query.includes("beacon_count = beacon_count")) {
      return [{ emeralds: 40, count: 2 }];
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
      emeralds: 200,
    } as never);
  });

  it("rejects a third unplaced beacon kit", async () => {
    mockSql();
    mockedProfile.mockResolvedValue({
      beacon_count: 2,
      emeralds: 200,
    } as never);

    const res = await buy("beacon");

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "beacon limit 2 total",
    });
  });

  it("counts placed beacons toward the beacon purchase limit", async () => {
    mockSql([[0, 4, { kind: "empty", beacon: true }]]);
    mockedProfile.mockResolvedValue({
      beacon_count: 1,
      emeralds: 200,
    } as never);

    const res = await buy("beacon");

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "beacon limit 2 total",
    });
  });

  it("allows beacon purchases that stay under the total limit", async () => {
    const sql = mockSql();
    mockedProfile.mockResolvedValue({
      beacon_count: 1,
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
});
