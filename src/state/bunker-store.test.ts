import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BunkerRouteResponse,
  LiveRaidActiveView,
} from "@/lib/bunker-api-types";
import {
  BASE_PART_CATALOG,
  type BunkerRaidRewardReport,
  createBunker,
  EMPTY_BASE_PART_INVENTORY,
  proposedBunkerFootprint,
} from "@/sim/bunker";
import {
  type BunkerApiResult,
  claimRemoteBunker,
  collectRemoteBunkerLoot,
  excavateRemoteBunkerCell,
  finishRemoteBunkerRaid,
  loadRemoteBunker,
  placeRemoteBunkerPart,
  resetRemoteBunker,
  resolveRemoteLiveRaid,
  startRemoteLiveBunkerRaid,
} from "./bunker-api-client";
import { useBunkerStore } from "./bunker-store";

vi.mock("./bunker-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bunker-api-client")>();
  return {
    ...actual,
    claimRemoteBunker: vi.fn(),
    collectRemoteBunkerLoot: vi.fn(),
    excavateRemoteBunkerCell: vi.fn(),
    finishRemoteBunkerRaid: vi.fn(),
    loadRemoteBunker: vi.fn(),
    placeRemoteBunkerPart: vi.fn(),
    resetRemoteBunker: vi.fn(),
    resolveRemoteLiveRaid: vi.fn(),
    startRemoteLiveBunkerRaid: vi.fn(),
  };
});

const mockedClaim = vi.mocked(claimRemoteBunker);
const mockedCollect = vi.mocked(collectRemoteBunkerLoot);
const mockedExcavate = vi.mocked(excavateRemoteBunkerCell);
const mockedFinish = vi.mocked(finishRemoteBunkerRaid);
const mockedLoad = vi.mocked(loadRemoteBunker);
const mockedPlace = vi.mocked(placeRemoteBunkerPart);
const mockedReset = vi.mocked(resetRemoteBunker);
const mockedResolveLive = vi.mocked(resolveRemoteLiveRaid);
const mockedStartLive = vi.mocked(startRemoteLiveBunkerRaid);

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
  revision: 0,
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
      activeLiveRaid: null,
      player: null,
      revision: 0,
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

  it("adopts an active live raid from a view and clears it when gone", async () => {
    const liveRaid: LiveRaidActiveView = {
      raidId: "live-abc",
      tier: 2,
      startedAtMs: 1_000,
      durationSeconds: 180,
      graceSeconds: 60,
      bunker: createBunker(proposedBunkerFootprint(10, 8)),
    };
    mockedLoad.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: { ...view, activeLiveRaid: liveRaid },
    });

    await useBunkerStore.getState().loadBunker();
    expect(useBunkerStore.getState().activeLiveRaid).toEqual(liveRaid);

    // A later view without the field resets it (the raid resolved).
    mockedLoad.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: { ...view, revision: 1 },
    });
    await useBunkerStore.getState().loadBunker();
    expect(useBunkerStore.getState().activeLiveRaid).toBeNull();
  });

  it("starts a live raid through the opt-in start path", async () => {
    const liveRaid: LiveRaidActiveView = {
      raidId: "live-xyz",
      tier: 1,
      startedAtMs: 2_000,
      durationSeconds: 180,
      graceSeconds: 60,
      bunker: createBunker(proposedBunkerFootprint(10, 8)),
    };
    mockedStartLive.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ...view, activeLiveRaid: liveRaid, liveRaid },
    });

    const body = await useBunkerStore.getState().startLiveRaid(1);

    expect(body).not.toBeNull();
    expect(mockedStartLive).toHaveBeenCalledWith(1);
    expect(useBunkerStore.getState().activeLiveRaid).toEqual(liveRaid);
  });

  it("resolves a live raid and adopts the settled view", async () => {
    useBunkerStore.setState({
      activeLiveRaid: {
        raidId: "live-xyz",
        tier: 1,
        startedAtMs: 2_000,
        durationSeconds: 180,
        graceSeconds: 60,
        bunker: createBunker(proposedBunkerFootprint(10, 8)),
      },
    });
    mockedResolveLive.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ...view, revision: 1, reward },
    });

    const body = await useBunkerStore.getState().resolveLiveRaid({
      version: 1,
      raidId: "live-xyz",
      outcome: "won",
      minerKilled: false,
      sealed: true,
      endedTick: 42,
      clankersKilled: 6,
      defenseXp: 150,
      partWear: [],
    });

    expect(body).not.toBeNull();
    expect(mockedResolveLive).toHaveBeenCalledOnce();
    expect(useBunkerStore.getState()).toMatchObject({
      status: "ready",
      activeLiveRaid: null,
      lastRaidReward: reward,
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

describe("banked edit concurrency (F-122)", () => {
  const bunker = createBunker(proposedBunkerFootprint(10, 8));

  function bankedView(
    revision: number,
    extra: Partial<BunkerRouteResponse> = {},
  ): BunkerRouteResponse {
    return { ...view, revision, ...extra };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useBunkerStore.setState({
      status: "ready",
      bunker,
      inventory: { ...EMPTY_BASE_PART_INVENTORY },
      activeRaid: null,
      player: view.player,
      revision: 2,
      lastRaidReward: null,
      note: null,
    });
  });

  it("serializes rapid edits so each echoes the incrementing revision", async () => {
    mockedExcavate
      .mockResolvedValueOnce({ ok: true, status: 200, body: bankedView(3) })
      .mockResolvedValueOnce({ ok: true, status: 200, body: bankedView(4) });

    // Fire two different-cell digs back to back without awaiting between.
    const first = useBunkerStore.getState().excavateCell(1, 1, 0);
    const second = useBunkerStore.getState().excavateCell(2, 1, 0);
    await Promise.all([first, second]);

    // The chain ran them in order: the first sent the loaded revision, and
    // the second waited and sent the revision the first advanced to.
    expect(mockedExcavate.mock.calls[0]).toEqual([1, 1, 0, 2]);
    expect(mockedExcavate.mock.calls[1]).toEqual([2, 1, 0, 3]);
    expect(useBunkerStore.getState().revision).toBe(4);
  });

  it("drops an out-of-order reply that would move the revision backwards", async () => {
    useBunkerStore.setState({ revision: 5 });
    mockedExcavate.mockResolvedValue({
      ok: true,
      status: 200,
      body: bankedView(3, { bunker: null }),
    });

    await useBunkerStore.getState().excavateCell(1, 1, 0);

    // The stale reply (revision 3 < 5) is ignored: state does not regress.
    expect(useBunkerStore.getState().revision).toBe(5);
    expect(useBunkerStore.getState().bunker).toBe(bunker);
  });

  it("resyncs to the authoritative view on a revision conflict, then a retry uses it", async () => {
    const authoritative = {
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
    mockedExcavate
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        body: bankedView(6, {
          bunker: authoritative,
          // The server tags the conflict and ships the current state.
          ...({ code: "bunker-revision-conflict" } as object),
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, body: bankedView(7) });

    const rejected = await useBunkerStore.getState().excavateCell(1, 1, 0);
    // The edit failed, but the store adopted the authoritative view.
    expect(rejected).toBeNull();
    expect(useBunkerStore.getState().revision).toBe(6);
    expect(useBunkerStore.getState().bunker).toEqual(authoritative);
    expect(useBunkerStore.getState().status).toBe("ready");
    expect(useBunkerStore.getState().note).toBeNull();

    // The retry runs against the fresh revision, not the stale one.
    await useBunkerStore.getState().excavateCell(1, 1, 0);
    expect(mockedExcavate.mock.calls[1][3]).toBe(6);
  });

  it("reports a duplicate same-cell dig as failed without regressing state", async () => {
    mockedExcavate.mockResolvedValue({
      ok: false,
      status: 409,
      body: { error: "cannot dig: open" },
    });

    const rejected = await useBunkerStore.getState().excavateCell(1, 1, 0);

    // A plain 409 with no authoritative view is a benign rejection: the
    // note surfaces, but the revision and bunker are left untouched.
    expect(rejected).toBeNull();
    expect(useBunkerStore.getState().status).toBe("error");
    expect(useBunkerStore.getState().revision).toBe(2);
    expect(useBunkerStore.getState().bunker).toBe(bunker);
  });

  it("also serializes and guards placement edits", async () => {
    mockedPlace.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: bankedView(3),
    });

    await useBunkerStore.getState().placePart("wall-panel", 7, 4, 0);

    expect(mockedPlace.mock.calls[0]).toEqual(["wall-panel", 7, 4, 0, 2]);
    expect(useBunkerStore.getState().revision).toBe(3);
  });

  it("serializes collect-loot behind an in-flight edit so its reply is not dropped", async () => {
    // collect-loot does not bump the revision, so if it ran concurrently with
    // a structural edit its reply could carry a revision the edit already
    // advanced past and be dropped by the monotonic guard. The chain runs it
    // after the dig, so it reads the advanced revision and is adopted.
    let releaseDig: (result: BunkerApiResult) => void = () => {};
    const digGate = new Promise<BunkerApiResult>((resolve) => {
      releaseDig = resolve;
    });
    mockedExcavate.mockReturnValueOnce(digGate);
    mockedCollect.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: bankedView(4),
    });

    const dig = useBunkerStore.getState().excavateCell(1, 1, 0);
    const collect = useBunkerStore.getState().collectLoot(2, 1, 0);

    // The collect waits for the dig: its network call has not fired yet.
    await Promise.resolve();
    expect(mockedCollect).not.toHaveBeenCalled();

    releaseDig({ ok: true, status: 200, body: bankedView(3) });
    const [, collected] = await Promise.all([dig, collect]);

    // The serialized collect ran after the dig advanced to 3 and its own
    // reply (revision 4) was adopted, not dropped.
    expect(mockedCollect).toHaveBeenCalledTimes(1);
    expect(collected).not.toBeNull();
    expect(useBunkerStore.getState().revision).toBe(4);
  });
});
