import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buyBasePart,
  claimBunker,
  collectBunkerRaidPickup,
  excavateBunker,
  finishBunkerRaid,
  loadBunkerView,
  moveBunkerPart,
  placeBunkerPart,
  removeBunkerPart,
  repairBunker,
  setBunkerSkin,
  startBunkerRaid,
} from "@/server/bunker";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { POST as claimPost } from "./claim/route";
import { POST as excavatePost } from "./excavate/route";
import { POST as buyPartPost } from "./parts/buy/route";
import { POST as movePartPost } from "./parts/move/route";
import { POST as placePartPost } from "./parts/place/route";
import { POST as removePartPost } from "./parts/remove/route";
import { POST as collectRaidPost } from "./raid/collect/route";
import { POST as finishRaidPost } from "./raid/finish/route";
import { POST as startRaidPost } from "./raid/start/route";
import { POST as repairPost } from "./repair/route";
import { GET } from "./route";
import { POST as skinPost } from "./skin/route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/player", () => ({
  getOrCreatePlayerId: vi.fn(async () => "player-1"),
}));

vi.mock("@/server/bunker", () => ({
  buyBasePart: vi.fn(),
  claimBunker: vi.fn(),
  collectBunkerRaidPickup: vi.fn(),
  excavateBunker: vi.fn(),
  finishBunkerRaid: vi.fn(),
  loadBunkerView: vi.fn(),
  moveBunkerPart: vi.fn(),
  placeBunkerPart: vi.fn(),
  removeBunkerPart: vi.fn(),
  repairBunker: vi.fn(),
  setBunkerSkin: vi.fn(),
  startBunkerRaid: vi.fn(),
}));

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedPlayer = vi.mocked(getOrCreatePlayerId);
const mockedBuy = vi.mocked(buyBasePart);
const mockedClaim = vi.mocked(claimBunker);
const mockedCollect = vi.mocked(collectBunkerRaidPickup);
const mockedFinish = vi.mocked(finishBunkerRaid);
const mockedLoad = vi.mocked(loadBunkerView);
const mockedMove = vi.mocked(moveBunkerPart);
const mockedPlace = vi.mocked(placeBunkerPart);
const mockedSkin = vi.mocked(setBunkerSkin);
const mockedRemove = vi.mocked(removeBunkerPart);
const mockedExcavate = vi.mocked(excavateBunker);
const mockedStart = vi.mocked(startBunkerRaid);
const mockedRepair = vi.mocked(repairBunker);

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

const raid = {
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
  minerKilled: false,
  survived: true,
  sealed: false,
  reward: { vibes: 30, defenseXp: 60 },
};

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("bunker API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStorageConfigured.mockReturnValue(true);
    mockedDb.mockResolvedValue(vi.fn() as never);
    mockedPlayer.mockResolvedValue("player-1");
    mockedBuy.mockResolvedValue({ ok: true, view });
    mockedClaim.mockResolvedValue({ ok: true, view });
    mockedLoad.mockResolvedValue(view);
    mockedMove.mockResolvedValue({ ok: true, view });
    mockedPlace.mockResolvedValue({ ok: true, view });
    mockedRemove.mockResolvedValue({ ok: true, view });
    mockedExcavate.mockResolvedValue({ ok: true, view });
    mockedStart.mockResolvedValue({
      ok: true,
      view,
      raid,
    });
    mockedCollect.mockResolvedValue({
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
        xpPickups: [
          {
            id: "raid-1-clanker-1-xp",
            col: 7,
            row: 4,
            defenseXp: 25,
            collected: true,
          },
        ],
        allClankersDead: true,
        breached: false,
        minerKilled: false,
        survived: true,
        sealed: false,
        reward: { vibes: 30, defenseXp: 25 },
      },
    });
    mockedFinish.mockResolvedValue({
      ok: true,
      view,
      raid,
      reward: {
        survived: true,
        vibesGained: 30,
        xpGained: 60,
        defenseXpBefore: 20,
        defenseXpAfter: 80,
        levelBefore: 1,
        levelAfter: 1,
        leveledUp: false,
        beaconLimitBefore: 2,
        beaconLimitAfter: 2,
        newStamps: ["survival-first-defense"],
      },
    });
  });

  it("returns unavailable when storage is not configured", async () => {
    mockedStorageConfigured.mockReturnValue(false);

    const res = await GET();

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "storage not configured",
      code: "storage_not_configured",
    });
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it("returns unavailable for storage-gated body routes before parsing", async () => {
    mockedStorageConfigured.mockReturnValue(false);

    const res = await buyPartPost(
      jsonRequest("http://localhost/api/bunker/parts/buy", "{"),
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "storage not configured",
      code: "storage_not_configured",
    });
    expect(mockedPlayer).not.toHaveBeenCalled();
    expect(mockedBuy).not.toHaveBeenCalled();
  });

  it("loads the current bunker view", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(view);
    expect(mockedLoad).toHaveBeenCalledWith(expect.any(Function), "player-1");
  });

  it("claims the current bunker footprint", async () => {
    const res = await claimPost(
      jsonRequest("http://localhost/api/bunker/claim", { col: 7, row: 5 }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(view);
    expect(mockedClaim).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      7,
      5,
    );
  });

  it("repairs the bunker through the repair route", async () => {
    const view = { bunker: { footprint: null }, inventory: {} };
    mockedRepair.mockResolvedValue({ ok: true, view } as never);

    const res = await repairPost(
      jsonRequest("http://localhost/api/bunker/repair", {}),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(view);
    expect(mockedRepair).toHaveBeenCalledWith(expect.any(Function), "player-1");
  });

  it("passes repair rejections through with their status", async () => {
    mockedRepair.mockResolvedValue({
      ok: false,
      status: 409,
      error: "nothing to repair",
    } as never);

    const res = await repairPost(
      jsonRequest("http://localhost/api/bunker/repair", {}),
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "nothing to repair" });
  });

  it("applies a bunker skin through the skin route", async () => {
    const view = { bunker: { footprint: null }, inventory: {} };
    mockedSkin.mockResolvedValue({
      ok: true,
      view,
      newStamps: ["tools-fresh-coat"],
    } as never);

    const res = await skinPost(
      jsonRequest("http://localhost/api/bunker/skin", { skinId: "gilded" }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ...view,
      newStamps: ["tools-fresh-coat"],
    });
    expect(mockedSkin).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      "gilded",
    );
  });

  it("rejects an unknown skin id before reaching the server helper", async () => {
    const res = await skinPost(
      jsonRequest("http://localhost/api/bunker/skin", { skinId: "chrome" }),
    );

    expect(res.status).toBe(400);
    expect(mockedSkin).not.toHaveBeenCalled();
  });

  it("passes skin purchase rejections through with their status", async () => {
    mockedSkin.mockResolvedValue({
      ok: false,
      status: 409,
      error: "Gilded costs 120 vibes",
    } as never);

    const res = await skinPost(
      jsonRequest("http://localhost/api/bunker/skin", { skinId: "gilded" }),
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Gilded costs 120 vibes",
    });
  });

  it("starts the tier-one Clanker raid", async () => {
    const res = await startRaidPost(
      jsonRequest("http://localhost/api/bunker/raid/start", { tier: 1 }),
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

  it("maps bunker operation failures to status and error body", async () => {
    mockedStart.mockResolvedValue({
      ok: false,
      status: 409,
      error: "raid already active",
    });

    const res = await startRaidPost(
      jsonRequest("http://localhost/api/bunker/raid/start", { tier: 1 }),
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "raid already active" });
  });

  it("collects raid XP from the miner cell", async () => {
    const res = await collectRaidPost(
      jsonRequest("http://localhost/api/bunker/raid/collect", {
        col: 7,
        row: 4,
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      raid: {
        raidId: "raid-1",
        xpPickups: [{ collected: true, defenseXp: 25 }],
      },
    });
    expect(mockedCollect).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      7,
      4,
    );
  });

  it("keeps the custom invalid pickup response for malformed collect bodies", async () => {
    const res = await collectRaidPost(
      jsonRequest("http://localhost/api/bunker/raid/collect", "{"),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid pickup cell" });
    expect(mockedCollect).not.toHaveBeenCalled();
  });

  it("keeps the custom invalid pickup response for invalid cells", async () => {
    const res = await collectRaidPost(
      jsonRequest("http://localhost/api/bunker/raid/collect", {
        col: "left",
        row: 4,
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid pickup cell" });
    expect(mockedCollect).not.toHaveBeenCalled();
  });

  it("finishes the active raid and returns its reward", async () => {
    const res = await finishRaidPost();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      raid: { raidId: "raid-1" },
      reward: { vibesGained: 30, xpGained: 60 },
      // Stamps ride the app-wide top-level channel (see applyResponse).
      newStamps: ["survival-first-defense"],
    });
    expect(mockedFinish).toHaveBeenCalledWith(expect.any(Function), "player-1");
  });

  it("accepts Basic Turret base part purchases", async () => {
    const res = await buyPartPost(
      jsonRequest("http://localhost/api/bunker/parts/buy", {
        partId: "basic-turret",
        quantity: 2,
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
      jsonRequest("http://localhost/api/bunker/parts/buy", {
        partId: "floor-spikes",
        quantity: 1,
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

  it("returns invalid JSON body for normal body routes", async () => {
    const res = await buyPartPost(
      jsonRequest("http://localhost/api/bunker/parts/buy", "{"),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid JSON body" });
    expect(mockedPlayer).not.toHaveBeenCalled();
    expect(mockedBuy).not.toHaveBeenCalled();
  });

  it("returns Zod issues for normal validation failures", async () => {
    const res = await buyPartPost(
      jsonRequest("http://localhost/api/bunker/parts/buy", {
        partId: "missing-part",
        quantity: 1,
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: [expect.objectContaining({ path: ["partId"] })],
    });
    expect(mockedPlayer).not.toHaveBeenCalled();
    expect(mockedBuy).not.toHaveBeenCalled();
  });

  it("places base parts", async () => {
    const res = await placePartPost(
      jsonRequest("http://localhost/api/bunker/parts/place", {
        partId: "wall-panel",
        col: 7,
        row: 4,
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(view);
    expect(mockedPlace).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      "wall-panel",
      7,
      4,
      0,
    );
  });

  it("places base parts at explicit depths", async () => {
    const res = await placePartPost(
      jsonRequest("http://localhost/api/bunker/parts/place", {
        partId: "wall-panel",
        col: 7,
        row: 4,
        depth: 3,
      }),
    );

    expect(res.status).toBe(200);
    expect(mockedPlace).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      "wall-panel",
      7,
      4,
      3,
    );
  });

  it("rejects out-of-range part depths", async () => {
    const res = await placePartPost(
      jsonRequest("http://localhost/api/bunker/parts/place", {
        partId: "wall-panel",
        col: 7,
        row: 4,
        depth: 5,
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: [expect.objectContaining({ path: ["depth"] })],
    });
    expect(mockedPlace).not.toHaveBeenCalled();
  });

  it("moves placed base parts", async () => {
    const res = await movePartPost(
      jsonRequest("http://localhost/api/bunker/parts/move", {
        fromCol: 7,
        fromRow: 4,
        toCol: 8,
        toRow: 4,
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
      0,
      0,
    );
  });

  it("moves placed base parts across depths", async () => {
    const res = await movePartPost(
      jsonRequest("http://localhost/api/bunker/parts/move", {
        fromCol: 7,
        fromRow: 4,
        toCol: 7,
        toRow: 4,
        fromDepth: 0,
        toDepth: 2,
      }),
    );

    expect(res.status).toBe(200);
    expect(mockedMove).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      7,
      4,
      7,
      4,
      0,
      2,
    );
  });

  it("removes base parts", async () => {
    const res = await removePartPost(
      jsonRequest("http://localhost/api/bunker/parts/remove", {
        col: 7,
        row: 4,
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(view);
    expect(mockedRemove).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      7,
      4,
      0,
    );
  });

  it("excavates reachable interior rock", async () => {
    const res = await excavatePost(
      jsonRequest("http://localhost/api/bunker/excavate", {
        col: 7,
        row: 4,
        depth: 1,
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(view);
    expect(mockedExcavate).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      7,
      4,
      1,
    );
  });

  it("rejects digging the open claim plane", async () => {
    const res = await excavatePost(
      jsonRequest("http://localhost/api/bunker/excavate", {
        col: 7,
        row: 4,
        depth: 0,
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: [expect.objectContaining({ path: ["depth"] })],
    });
    expect(mockedExcavate).not.toHaveBeenCalled();
  });

  it("removes base parts at explicit depths", async () => {
    const res = await removePartPost(
      jsonRequest("http://localhost/api/bunker/parts/remove", {
        col: 7,
        row: 4,
        depth: 2,
      }),
    );

    expect(res.status).toBe(200);
    expect(mockedRemove).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      7,
      4,
      2,
    );
  });
});
