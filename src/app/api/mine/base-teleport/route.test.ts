import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, storageConfigured } from "@/server/db";
import { POST } from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/player", () => ({
  getOrCreatePlayerId: vi.fn(async () => "player-1"),
}));

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/mine/base-teleport", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/mine/base-teleport", () => {
  beforeEach(() => {
    mockedStorageConfigured.mockReturnValue(true);
    mockedDb.mockReset();
  });

  it("spends vibes when the player can afford the return", async () => {
    const sql = vi.fn(async () => [{ emeralds: 7 }]);
    mockedDb.mockResolvedValue(sql as never);

    const res = await post({ cost: 2 });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ balance: 7 });
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed costs", async () => {
    const res = await post({ cost: 0 });

    expect(res.status).toBe(400);
    expect(mockedDb).not.toHaveBeenCalled();
  });

  it("rejects unaffordable returns", async () => {
    const sql = vi.fn(async () => []);
    mockedDb.mockResolvedValue(sql as never);

    const res = await post({ cost: 8 });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "not enough vibes" });
  });

  it("reports offline storage without charging", async () => {
    mockedStorageConfigured.mockReturnValue(false);

    const res = await post({ cost: 1 });

    expect(res.status).toBe(503);
    expect(mockedDb).not.toHaveBeenCalled();
  });
});
