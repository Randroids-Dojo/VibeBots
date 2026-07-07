import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, storageConfigured } from "@/server/db";
import { currentPlayerId } from "@/server/player";
import { GET } from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/player", () => ({
  currentPlayerId: vi.fn(async () => "player-1"),
}));

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedCurrentPlayerId = vi.mocked(currentPlayerId);

function sqlReturning(rows: unknown[]) {
  return vi.fn(async () => rows);
}

describe("GET /api/mine/world/version", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStorageConfigured.mockReturnValue(true);
    mockedCurrentPlayerId.mockResolvedValue("player-1");
  });

  it("returns 503 while storage is not configured", async () => {
    mockedStorageConfigured.mockReturnValue(false);

    const res = await GET();

    expect(res.status).toBe(503);
  });

  it("returns a null world without a player cookie", async () => {
    mockedCurrentPlayerId.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ world: null });
    expect(mockedDb).not.toHaveBeenCalled();
  });

  it("returns a null world before the first world row exists", async () => {
    mockedDb.mockResolvedValue(sqlReturning([]) as never);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ world: null });
  });

  it("returns the live seed and trip count with no-store", async () => {
    // Neon returns bigint columns as strings; the route must normalize.
    mockedDb.mockResolvedValue(
      sqlReturning([{ seed: "4243", trip_count: 7 }]) as never,
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      world: { seed: 4243, tripCount: 7 },
    });
  });
});
