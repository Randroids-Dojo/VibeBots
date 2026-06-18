import { beforeEach, describe, expect, it, vi } from "vitest";
import { storageConfigured } from "@/server/db";
import { GET } from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => false),
}));

vi.mock("@/server/player", () => ({
  getOrCreatePlayerId: vi.fn(async () => "player-1"),
}));

vi.mock("@/server/achievements", () => ({
  refreshPlayerAchievements: vi.fn(async () => []),
}));

const mockedStorageConfigured = vi.mocked(storageConfigured);

describe("GET /api/achievements", () => {
  beforeEach(() => {
    mockedStorageConfigured.mockReturnValue(false);
  });

  it("returns the locked stamp catalog when storage is offline", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.offline).toBe(true);
    expect(body.achievements.length).toBeGreaterThan(20);
    expect(body.achievements[0]).toMatchObject({
      unlocked: false,
      progress: { current: 0 },
    });
  });
});
