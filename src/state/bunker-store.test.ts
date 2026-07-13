import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BunkerRouteResponse } from "@/lib/bunker-api-types";
import {
  BASE_PART_CATALOG,
  type BunkerRaidRewardReport,
  createBunker,
  EMPTY_BASE_PART_INVENTORY,
  proposedBunkerFootprint,
} from "@/sim/bunker";
import {
  claimRemoteBunker,
  finishRemoteBunkerRaid,
  loadRemoteBunker,
  resetRemoteBunker,
} from "./bunker-api-client";
import { useBunkerStore } from "./bunker-store";

vi.mock("./bunker-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bunker-api-client")>();
  return {
    ...actual,
    claimRemoteBunker: vi.fn(),
    finishRemoteBunkerRaid: vi.fn(),
    loadRemoteBunker: vi.fn(),
    resetRemoteBunker: vi.fn(),
  };
});

const mockedClaim = vi.mocked(claimRemoteBunker);
const mockedFinish = vi.mocked(finishRemoteBunkerRaid);
const mockedLoad = vi.mocked(loadRemoteBunker);
const mockedReset = vi.mocked(resetRemoteBunker);

const view: BunkerRouteResponse = {
  bunker: null,
  inventory: { ...EMPTY_BASE_PART_INVENTORY },
  activeRaid: null,
  player: {
    balance: 12,
    trackXp: 0,
    defenseXp: 20,
    overallLevel: 1,
    levelCap: 100,
    progressXp: 20,
    neededXp: 80,
    nextLevelXp: 100,
    beaconLimit: 2,
  },
};

const reward: BunkerRaidRewardReport = {
  survived: true,
  vibesGained: 30,
  xpGained: 25,
  defenseXpBefore: 20,
  defenseXpAfter: 45,
  levelBefore: 1,
  levelAfter: 1,
  leveledUp: false,
  beaconLimitBefore: 2,
  beaconLimitAfter: 2,
  newStamps: [],
};

describe("bunker store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBunkerStore.setState({
      status: "idle",
      bunker: null,
      inventory: { ...EMPTY_BASE_PART_INVENTORY },
      activeRaid: null,
      player: null,
      lastRaidReward: null,
      note: null,
    });
  });

  it("applies a loaded bunker view", async () => {
    const bunker = {
      ...createBunker(proposedBunkerFootprint(10, 8)),
      parts: [
        {
          partId: "wall-panel" as const,
          col: 7,
          row: 4,
          depth: 0,
          durability: BASE_PART_CATALOG["wall-panel"].durability,
        },
      ],
    };
    mockedLoad.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ...view, bunker },
    });

    await useBunkerStore.getState().loadBunker();

    expect(useBunkerStore.getState()).toMatchObject({
      status: "ready",
      bunker,
      inventory: view.inventory,
      activeRaid: null,
      player: view.player,
      lastRaidReward: null,
      note: null,
    });
  });

  it("maps storage-offline loads to unavailable state", async () => {
    mockedLoad.mockResolvedValue({
      ok: false,
      status: 503,
      body: { error: "storage not configured" },
    });

    await useBunkerStore.getState().loadBunker();

    expect(useBunkerStore.getState()).toMatchObject({
      status: "unavailable",
      note: "bunker ledger offline",
    });
  });

  it("keeps mutation errors in the store note and returns null", async () => {
    mockedClaim.mockResolvedValue({
      ok: false,
      status: 409,
      body: { error: "clear the full 7x5 claim first" },
    });

    await expect(useBunkerStore.getState().claimBunker(7, 5)).resolves.toBe(
      null,
    );

    expect(useBunkerStore.getState()).toMatchObject({
      status: "error",
      note: "clear the full 7x5 claim first",
    });
  });

  it("applies a reset view through the shared mutation path", async () => {
    const bunker = createBunker(proposedBunkerFootprint(10, 8));
    const inventory = {
      ...EMPTY_BASE_PART_INVENTORY,
      "wall-panel": 7,
    };
    mockedReset.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ...view, bunker, inventory },
    });

    const body = await useBunkerStore.getState().resetBunker();

    expect(body).not.toBeNull();
    expect(useBunkerStore.getState()).toMatchObject({
      status: "ready",
      bunker,
      inventory,
      note: null,
    });
  });

  it("keeps reset rejections in the store note", async () => {
    mockedReset.mockResolvedValue({
      ok: false,
      status: 409,
      body: { error: "finish the raid first" },
    });

    await expect(useBunkerStore.getState().resetBunker()).resolves.toBe(null);

    expect(useBunkerStore.getState()).toMatchObject({
      status: "error",
      note: "finish the raid first",
    });
  });

  it("returns successful mutation bodies and stores raid rewards", async () => {
    const body: BunkerRouteResponse = { ...view, reward };
    mockedFinish.mockResolvedValue({ ok: true, status: 200, body });

    await expect(useBunkerStore.getState().finishRaid()).resolves.toBe(body);

    expect(useBunkerStore.getState()).toMatchObject({
      status: "ready",
      lastRaidReward: reward,
      note: null,
    });
  });
});
