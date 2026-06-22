import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buyBasePart,
  loadBunkerView,
  moveBunkerPart,
  startBunkerRaid,
} from "@/server/bunker";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { POST as buyPartPost } from "./parts/buy/route";
import { POST as movePartPost } from "./parts/move/route";
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
  buyBasePart: vi.fn(),
  loadBunkerView: vi.fn(),
  moveBunkerPart: vi.fn(),
  startBunkerRaid: vi.fn(),
}));

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedPlayer = vi.mocked(getOrCreatePlayerId);
const mockedBuy = vi.mocked(buyBasePart);
const mockedLoad = vi.mocked(loadBunkerView);
const mockedMove = vi.mocked(moveBunkerPart);
const mockedStart = vi.mocked(startBunkerRaid);

const view = {
  bunker: null,
  inventory: {
    "wall-panel": 2,
    "floor-panel": 3,
    "roof-panel": 3,
    "door-panel": 1,
    "basic-turret": 0,
    "floor-spikes": 0,
  },
  activeRaid: null,
  player: {
    balance: 12,
    trackXp: 80,
    defenseXp: 20,
    overallLevel: 1,
    levelCap: 100,
    progressXp: 20,
    neededXp: 80,
    nextLevelXp: 100,
    beaconLimit: 2,
  },
};

describe("bunker API routes", () => {
  beforeEach(() => {
    mockedStorageConfigured.mockReturnValue(true);
    mockedDb.mockResolvedValue(vi.fn() as never);
    mockedPlayer.mockResolvedValue("player-1");
    mockedBuy.mockResolvedValue({ ok: true, view });
    mockedLoad.mockResolvedValue(view);
    mockedMove.mockResolvedValue({ ok: true, view });
    mockedStart.mockResolvedValue({
      ok: true,
      view,
      raid: {
        raidId: "raid-1",
        tier: 1,
        durationSeconds: 180,
        clankers: [],
        turretShots: 0,
        turretDamage: 0,
        spikeTriggers: 0,
        spikeDamage: 0,
        totalPartDurability: 0,
        incomingDamage: 0,
        partDamage: [],
        coreDamage: 0,
        xpPickups: [],
        allClankersDead: true,
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

  it("accepts Basic Turret base part purchases", async () => {
    const res = await buyPartPost(
      new Request("http://localhost/api/bunker/parts/buy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ partId: "basic-turret", quantity: 2 }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(view);
    expect(mockedBuy).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      "basic-turret",
      2,
    );
  });

  it("accepts Floor Spikes base part purchases", async () => {
    const res = await buyPartPost(
      new Request("http://localhost/api/bunker/parts/buy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ partId: "floor-spikes", quantity: 1 }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(view);
    expect(mockedBuy).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      "floor-spikes",
      1,
    );
  });

  it("moves placed base parts", async () => {
    const res = await movePartPost(
      new Request("http://localhost/api/bunker/parts/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromCol: 7,
          fromRow: 4,
          toCol: 8,
          toRow: 4,
        }),
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(view);
    expect(mockedMove).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      7,
      4,
      8,
      4,
    );
  });
});
