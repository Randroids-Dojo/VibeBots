import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadBunkerView, startBunkerRaid } from "@/server/bunker";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { POST as startRaidPost } from "./raid/start/route";
import { GET } from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/player", () => ({
  getOrCreatePlayerId: vi.fn(async () => "player-1"),
}));

vi.mock("@/server/bunker", () => ({
  loadBunkerView: vi.fn(),
  startBunkerRaid: vi.fn(),
}));

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedPlayer = vi.mocked(getOrCreatePlayerId);
const mockedLoad = vi.mocked(loadBunkerView);
const mockedStart = vi.mocked(startBunkerRaid);

const view = {
  bunker: null,
  inventory: { "wall-panel": 4, "door-panel": 1 },
  activeRaid: null,
  player: {
    balance: 12,
    trackXp: 80,
    defenseXp: 20,
    overallLevel: 2,
  },
};

describe("bunker API routes", () => {
  beforeEach(() => {
    mockedStorageConfigured.mockReturnValue(true);
    mockedDb.mockResolvedValue(vi.fn() as never);
    mockedPlayer.mockResolvedValue("player-1");
    mockedLoad.mockResolvedValue(view);
    mockedStart.mockResolvedValue({
      ok: true,
      view,
      raid: {
        raidId: "raid-1",
        tier: 1,
        durationSeconds: 180,
        clankers: [],
        totalPartDurability: 0,
        incomingDamage: 0,
        breached: false,
        survived: true,
        reward: { vibes: 30, defenseXp: 60 },
      },
    });
  });

  it("returns unavailable when storage is not configured", async () => {
    mockedStorageConfigured.mockReturnValue(false);

    const res = await GET();

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "storage not configured",
    });
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it("loads the current bunker view", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(view);
    expect(mockedLoad).toHaveBeenCalledWith(expect.any(Function), "player-1");
  });

  it("starts the tier-one Clanker raid", async () => {
    const res = await startRaidPost(
      new Request("http://localhost/api/bunker/raid/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: 1 }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      raid: { raidId: "raid-1", durationSeconds: 180 },
    });
    expect(mockedStart).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      1,
    );
  });
});
