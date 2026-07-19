import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveRaidActiveView } from "@/lib/bunker-api-types";
import {
  buyBasePart,
  claimBunker,
  excavateBunker,
  loadBunkerView,
  moveBunkerPart,
  placeBunkerPart,
  removeBunkerPart,
  repairBunker,
  resetBunker,
  setBunkerSkin,
  startFreshBunker,
  startLiveRaid,
} from "@/server/bunker";
import { db, storageConfigured } from "@/server/db";
import { getOrCreatePlayerId } from "@/server/player";
import { createBunker, proposedBunkerFootprint } from "@/sim/bunker";
import { POST as claimPost } from "./claim/route";
import { POST as excavatePost } from "./excavate/route";
import { POST as buyPartPost } from "./parts/buy/route";
import { POST as movePartPost } from "./parts/move/route";
import { POST as placePartPost } from "./parts/place/route";
import { POST as removePartPost } from "./parts/remove/route";
import { POST as startRaidPost } from "./raid/start/route";
import { POST as repairPost } from "./repair/route";
import { POST as resetPost } from "./reset/route";
import { GET } from "./route";
import { POST as skinPost } from "./skin/route";
import { POST as startFreshPost } from "./start-fresh/route";

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
  excavateBunker: vi.fn(),
  loadBunkerView: vi.fn(),
  moveBunkerPart: vi.fn(),
  placeBunkerPart: vi.fn(),
  removeBunkerPart: vi.fn(),
  repairBunker: vi.fn(),
  resetBunker: vi.fn(),
  setBunkerSkin: vi.fn(),
  startFreshBunker: vi.fn(),
  startLiveRaid: vi.fn(),
}));

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedPlayer = vi.mocked(getOrCreatePlayerId);
const mockedBuy = vi.mocked(buyBasePart);
const mockedClaim = vi.mocked(claimBunker);
const mockedLoad = vi.mocked(loadBunkerView);
const mockedMove = vi.mocked(moveBunkerPart);
const mockedPlace = vi.mocked(placeBunkerPart);
const mockedSkin = vi.mocked(setBunkerSkin);
const mockedRemove = vi.mocked(removeBunkerPart);
const mockedExcavate = vi.mocked(excavateBunker);
const mockedStart = vi.mocked(startLiveRaid);
const mockedRepair = vi.mocked(repairBunker);
const mockedReset = vi.mocked(resetBunker);
const mockedStartFresh = vi.mocked(startFreshBunker);

const view = {
  bunker: null,
  inventory: {
    "wall-panel": 2,
    "floor-panel": 3,
    "roof-panel": 3,
    "door-panel": 1,
    "basic-turret": 0,
    "floor-spikes": 0,
    "stair-panel": 0,
  },
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
  revision: 0,
};

const liveRaid: LiveRaidActiveView = {
  raidId: "raid-1",
  tier: 1,
  startedAtMs: 0,
  durationSeconds: 180,
  graceSeconds: 60,
  bunker: createBunker(proposedBunkerFootprint(10, 8)),
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
      liveRaid,
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

  it("resets the bunker through the reset route", async () => {
    const view = { bunker: { footprint: null }, inventory: {} };
    mockedReset.mockResolvedValue({ ok: true, view } as never);

    const res = await resetPost(
      jsonRequest("http://localhost/api/bunker/reset", {}),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(view);
    expect(mockedReset).toHaveBeenCalledWith(expect.any(Function), "player-1");
  });

  it("passes reset rejections through with their status", async () => {
    mockedReset.mockResolvedValue({
      ok: false,
      status: 409,
      error: "finish the raid first",
    } as never);

    const res = await resetPost(
      jsonRequest("http://localhost/api/bunker/reset", {}),
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "finish the raid first",
    });
  });

  it("hard-resets a legacy bunker through the start-fresh route (F-117)", async () => {
    const view = { bunker: { footprint: null }, inventory: {} };
    mockedStartFresh.mockResolvedValue({ ok: true, view } as never);

    const res = await startFreshPost(
      jsonRequest("http://localhost/api/bunker/start-fresh", {}),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(view);
    expect(mockedStartFresh).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
    );
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

  it("starts the live first-person raid", async () => {
    const res = await startRaidPost(
      jsonRequest("http://localhost/api/bunker/raid/start", { tier: 1 }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      liveRaid: { raidId: "raid-1", tier: 1, durationSeconds: 180 },
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
      undefined,
      undefined,
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
      undefined,
      undefined,
    );
  });

  it("forwards a thin part's slot to the placement (F-117)", async () => {
    const res = await placePartPost(
      jsonRequest("http://localhost/api/bunker/parts/place", {
        partId: "wall-panel",
        col: 7,
        row: 4,
        depth: 2,
        slot: "wall-px",
      }),
    );

    expect(res.status).toBe(200);
    expect(mockedPlace).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      "wall-panel",
      7,
      4,
      2,
      "wall-px",
      undefined,
    );
  });

  it("threads the expected revision to the placement (F-122)", async () => {
    const res = await placePartPost(
      jsonRequest("http://localhost/api/bunker/parts/place", {
        partId: "wall-panel",
        col: 7,
        row: 4,
        expectedRevision: 9,
      }),
    );

    expect(res.status).toBe(200);
    expect(mockedPlace).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      "wall-panel",
      7,
      4,
      0,
      undefined,
      9,
    );
  });

  it("returns the conflict code and authoritative view on a revision conflict (F-122)", async () => {
    mockedPlace.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: "bunker changed elsewhere, refreshed",
      code: "bunker-revision-conflict",
      body: { ...view },
    });

    const res = await placePartPost(
      jsonRequest("http://localhost/api/bunker/parts/place", {
        partId: "wall-panel",
        col: 7,
        row: 4,
        expectedRevision: 1,
      }),
    );

    expect(res.status).toBe(409);
    const payload = await res.json();
    expect(payload).toMatchObject({
      error: "bunker changed elsewhere, refreshed",
      code: "bunker-revision-conflict",
      revision: view.revision,
      inventory: view.inventory,
    });
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
      undefined,
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
      undefined,
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
      undefined,
      undefined,
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
      undefined,
    );
  });

  it("returns the Groundbreaker stamp with the first excavation", async () => {
    mockedExcavate.mockResolvedValue({
      ok: true,
      view,
      newStamps: ["bunker-groundbreaker"],
    } as never);

    const res = await excavatePost(
      jsonRequest("http://localhost/api/bunker/excavate", {
        col: 7,
        row: 4,
        depth: 1,
      }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ...view,
      newStamps: ["bunker-groundbreaker"],
    });
  });

  it("digs the depth-0 floor plane (all cells start as rock)", async () => {
    const res = await excavatePost(
      jsonRequest("http://localhost/api/bunker/excavate", {
        col: 7,
        row: 4,
        depth: 0,
      }),
    );

    expect(res.status).toBe(200);
    expect(mockedExcavate).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      7,
      4,
      0,
      undefined,
    );
  });

  it("rejects excavation depths outside the volume", async () => {
    const res = await excavatePost(
      jsonRequest("http://localhost/api/bunker/excavate", {
        col: 7,
        row: 4,
        depth: 5,
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
      undefined,
      undefined,
    );
  });

  it("forwards a thin part's slot to the removal (F-117)", async () => {
    const res = await removePartPost(
      jsonRequest("http://localhost/api/bunker/parts/remove", {
        col: 7,
        row: 4,
        depth: 2,
        slot: "wall-px",
      }),
    );

    expect(res.status).toBe(200);
    expect(mockedRemove).toHaveBeenCalledWith(
      expect.any(Function),
      "player-1",
      7,
      4,
      2,
      "wall-px",
      undefined,
    );
  });
});
