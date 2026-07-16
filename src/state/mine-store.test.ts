import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBunker, STARTER_BASE_PART_INVENTORY } from "@/sim/bunker";
import {
  applyAction,
  cellAt,
  createMine,
  DEFAULT_GEAR,
  exportDiff,
  MINE_VERSION,
  type MineAction,
  type MineConsumables,
  NO_CONSUMABLES,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
  type WorldDiff,
} from "@/sim/mine";
import { type AccountSaveSummary, useMineStore } from "./mine-store";

const store = () => useMineStore.getState();

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const stock = (overrides: Partial<MineConsumables> = {}): MineConsumables => ({
  ...NO_CONSUMABLES,
  ...overrides,
});

function markAccountProviderReady(): void {
  useMineStore.setState((state) => ({
    accountSync: {
      ...state.accountSync,
      providerStatus: {
        provider: "clerk",
        ready: true,
        reason: null,
        issues: [],
      },
    },
  }));
}

const savedDeviceSummary = (
  overrides: Partial<AccountSaveSummary> = {},
): AccountSaveSummary => ({
  exists: true,
  createdAt: "2026-07-04T00:00:00.000Z",
  balance: 10,
  deepestDepth: 3,
  partsOwned: 1,
  designs: 1,
  stamps: 2,
  ...overrides,
});

function clearedBunkerMine() {
  const mine = createMine(123, DEFAULT_GEAR, STARTING_CONSUMABLES);
  for (let row = 1; row <= 5; row++) {
    for (let col = START_COL - 3; col <= START_COL + 3; col++) {
      setCell(mine, col, row, { kind: "empty" });
    }
  }
  mine.miner.col = START_COL;
  mine.miner.row = 5;
  return mine;
}

async function restoreElevatorTrip(moves: MineAction[]): Promise<void> {
  const seed = 9295;
  const gear = {
    ...DEFAULT_GEAR,
    elevator: 20,
    elevatorColumn: START_COL,
  };
  const mine = createMine(seed, gear, STARTING_CONSUMABLES);
  for (let row = 1; row <= gear.elevator; row++) {
    setCell(mine, START_COL, row, { kind: "empty" });
  }
  const baseDiff = exportDiff(mine);
  localStorage.setItem(
    "vibebots-mine-trip-v2-slot-1",
    JSON.stringify({
      mineVersion: MINE_VERSION,
      seed,
      tripIndex: 4,
      gear,
      consumables: STARTING_CONSUMABLES,
      baseDiff,
      moves,
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          activeSlot: 1,
          seed,
          tripIndex: 4,
          diff: baseDiff,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          gear,
          consumables: STARTING_CONSUMABLES,
          balance: 0,
          elevatorPlacementRequired: true,
        }),
      ),
  );

  await store().loadWorld();
}

describe("mine store upgrade flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const local = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => local.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => local.set(key, value)),
      removeItem: vi.fn((key: string) => local.delete(key)),
    });

    const mine = createMine(123, DEFAULT_GEAR, NO_CONSUMABLES);
    mine.miner.bankedCredits = 45;
    useMineStore.setState({
      mine,
      seed: 123,
      gear: DEFAULT_GEAR,
      consumables: NO_CONSUMABLES,
      bought: NO_CONSUMABLES,
      balance: 10,
      elevatorPlacementRequired: false,
      shopNote: null,
      tripIndex: 2,
      tripBaseDiff: [],
      moves: ["down"] as MineAction[],
      tick: 0,
      lastResult: null,
      lastAction: null,
      resumeElevatorDirection: null,
      cashOut: { state: "idle" },
      pendingBunker: null,
      activeSlot: 1,
      saveSlots: { state: "unknown", activeSlot: 1, slots: [] },
      accountSync: {
        state: "unknown",
        providerStatus: {
          provider: "clerk",
          ready: false,
          reason: "sdk_not_wired",
          issues: [
            "sdk_not_wired",
            "publishable_key_missing",
            "secret_key_missing",
            "public_sign_in_url_missing",
            "public_sign_in_fallback_url_missing",
            "public_sign_up_fallback_url_missing",
          ],
        },
        mode: "guest",
        accountEmail: null,
        currentSave: null,
        accountSave: null,
      },
      worldLoaded: true,
      fallVisualImpactKey: null,
    });
  });

  it("records the latest fall playback impact key", () => {
    expect(useMineStore.getState().fallVisualImpactKey).toBeNull();
    useMineStore.getState().markFallVisualImpact(7);
    expect(useMineStore.getState().fallVisualImpactKey).toBe(7);
    // Re-marking the same key is a no-op; a later playback replaces it.
    useMineStore.getState().markFallVisualImpact(7);
    useMineStore.getState().markFallVisualImpact(9);
    expect(useMineStore.getState().fallVisualImpactKey).toBe(9);
    // Ticks reset across trips, so the playback bridge clears the mark
    // when a new playback begins; a stale key must never gate a new trip.
    useMineStore.getState().clearFallVisualImpact();
    expect(useMineStore.getState().fallVisualImpactKey).toBeNull();
  });

  it("returns no action result while cash-out blocks movement", () => {
    const accepted = store().move("right");
    expect(accepted).toEqual(store().lastResult);
    expect(accepted?.ok).toBe(true);

    const priorResult = store().lastResult;
    const priorMoves = [...store().moves];
    useMineStore.setState({ cashOut: { state: "pending" } });

    expect(store().move("left")).toBeNull();
    expect(store().lastResult).toBe(priorResult);
    expect(store().moves).toEqual(priorMoves);
  });

  it("banks a surfaced trip before buying an upgrade", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          credited: { credits: 45, parts: [], milestoneBonus: 0 },
          balance: 55,
          tripIndex: 3,
          consumables: stock({ ladder: 2, plank: 1 }),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ track: "lantern", level: 2, balance: 5 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await store().buyGearUpgrade("lantern");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/mine/bank");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).gear.lantern).toBe(1);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/gear/upgrade");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).track).toBe("lantern");

    expect(store().gear.lantern).toBe(2);
    expect(store().mine.gear.lantern).toBe(2);
    expect(store().balance).toBe(5);
    expect(store().tripIndex).toBe(3);
    expect(store().consumables).toEqual(stock({ ladder: 2, plank: 1 }));
    expect(store().shopNote).toBe("lantern is now level 2");

    const lastSaved = vi.mocked(localStorage.setItem).mock.calls.at(-1);
    expect(lastSaved).toBeTruthy();
    expect(JSON.parse(lastSaved?.[1] ?? "{}").gear.lantern).toBe(2);
    expect(JSON.parse(lastSaved?.[1] ?? "{}").consumables).toEqual(
      stock({ ladder: 2, plank: 1 }),
    );
  });

  it("places the first elevator rail at the chosen surface column", async () => {
    const mine = createMine(123, DEFAULT_GEAR, NO_CONSUMABLES);
    useMineStore.setState({
      mine,
      moves: ["left"] as MineAction[],
      balance: 30,
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        elevator: 1,
        elevatorColumn: 17,
        tripIndex: 3,
        balance: 5,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(store().buyElevator(17)).resolves.toBe(true);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      column: 17,
      expectedDepth: 0,
    });
    expect(store().gear).toMatchObject({
      elevator: 1,
      elevatorColumn: 17,
    });
    expect(store().mine.gear).toMatchObject({
      elevator: 1,
      elevatorColumn: 17,
    });
    expect(cellAt(store().mine, 17, 1)?.kind).toBe("empty");
    expect(store().balance).toBe(5);
    expect(store().tripIndex).toBe(3);
    expect(store().shopNote).toBe("rail extended to 1 deep");
    const savedTrip = JSON.parse(
      vi.mocked(localStorage.setItem).mock.calls.at(-1)?.[1] ?? "{}",
    );
    expect(savedTrip.tripIndex).toBe(3);
  });

  it("banks a completed dig before placing the first elevator rail", async () => {
    const mine = createMine(123, DEFAULT_GEAR, NO_CONSUMABLES);
    mine.miner.col = 17;
    mine.miner.bankedCredits = 45;
    useMineStore.setState({
      mine,
      moves: ["down", "up"] as MineAction[],
      balance: 10,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          credited: { credits: 45, parts: [], milestoneBonus: 0 },
          balance: 55,
          tripIndex: 3,
          consumables: NO_CONSUMABLES,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          elevator: 1,
          elevatorColumn: 17,
          tripIndex: 4,
          balance: 30,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(store().buyElevator(17)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/mine/bank");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/elevator/upgrade");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      column: 17,
      expectedDepth: 0,
    });
    expect(store().gear).toMatchObject({
      elevator: 1,
      elevatorColumn: 17,
    });
    expect(store().mine.gear).toMatchObject({
      elevator: 1,
      elevatorColumn: 17,
    });
    expect(store().mine.miner).toMatchObject({ col: 17, row: 0 });
    expect(store().tripIndex).toBe(4);
  });

  it("moves an existing shaft for free without losing rail depth", async () => {
    const gear = {
      ...DEFAULT_GEAR,
      elevator: 4,
      elevatorColumn: -5,
    };
    const baseDiff: WorldDiff = [
      [-5, 1, { kind: "empty" }],
      [17, 2, { kind: "empty", ladder: true }],
    ];
    const nextDiff: WorldDiff = [
      [-5, 1, { kind: "empty" }],
      [17, 1, { kind: "empty" }],
      [17, 2, { kind: "empty" }],
      [17, 3, { kind: "empty" }],
      [17, 4, { kind: "empty" }],
    ];
    const mine = createMine(123, gear, NO_CONSUMABLES, baseDiff);
    useMineStore.setState({
      mine,
      gear,
      moves: ["left"] as MineAction[],
      balance: 10,
      elevatorPlacementRequired: true,
      tripBaseDiff: baseDiff,
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        elevator: 4,
        elevatorColumn: 17,
        elevatorPlacementRequired: false,
        relocated: true,
        tripIndex: 3,
        balance: 10,
        diff: nextDiff,
        refundedLadders: 1,
        refundedSupports: { ladder: 1 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(store().buyElevator(17)).resolves.toBe(true);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      column: 17,
      expectedDepth: 4,
    });
    expect(store().gear).toMatchObject({
      elevator: 4,
      elevatorColumn: 17,
    });
    expect(store().mine.gear).toMatchObject({
      elevator: 4,
      elevatorColumn: 17,
    });
    expect(store().balance).toBe(10);
    expect(store().elevatorPlacementRequired).toBe(false);
    expect(store().consumables.ladder).toBe(1);
    expect(cellAt(store().mine, -5, 1)?.kind).toBe("empty");
    expect(cellAt(store().mine, 17, 4)?.kind).toBe("empty");
    expect(store().shopNote).toBe(
      "shaft moved to column 17; recovered 1 ladders and 0 planks",
    );
    expect(store().tripIndex).toBe(3);
  });

  it("keeps the trip intact on a non-stale reject and shows only balance plus reason", async () => {
    const gear = { ...DEFAULT_GEAR, elevator: 3, elevatorColumn: 17 };
    const mine = createMine(123, gear, NO_CONSUMABLES);
    useMineStore.setState({
      mine,
      gear,
      consumables: stock({ ladder: 1, plank: 1 }),
      moves: ["left"] as MineAction[],
      balance: 40,
      tripIndex: 2,
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          code: "elevator-insufficient-balance",
          error: "not enough vibes",
          balance: 12,
          elevator: 3,
          elevatorColumn: 17,
          ladders: 1,
          planks: 1,
          tripIndex: 2,
          elevatorPlacementRequired: false,
        },
        409,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(store().buyElevator()).resolves.toBe(false);

    // The client sends its expected rail depth so a stale buy cannot advance.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      expectedDepth: 3,
    });
    // Insufficient balance changed nothing server-side, so no world refetch
    // fires and only the display-safe balance and the coded reason update. The
    // rail depth, trip index, and supports stay put (rewriting them without a
    // world rebuild would corrupt the persisted trip).
    expect(fetchMock.mock.calls.map((c) => c[0])).not.toContain(
      "/api/mine/world",
    );
    expect(store().balance).toBe(12);
    expect(store().shopNote).toBe("not enough vibes for the next rail");
    expect(store().gear).toMatchObject({ elevator: 3, elevatorColumn: 17 });
    expect(store().consumables).toMatchObject({ ladder: 1, plank: 1 });
    expect(store().tripIndex).toBe(2);
    // Any persisted trip stays self-consistent: the original index against the
    // original rail, never the server's index against a stale world.
    const savedTrip = JSON.parse(
      vi.mocked(localStorage.setItem).mock.calls.at(-1)?.[1] ?? "{}",
    );
    expect(savedTrip.tripIndex).toBe(2);
    expect(savedTrip.gear.elevator).toBe(3);
  });

  it("does one bounded world and gear refetch on a stale rail reject", async () => {
    const gear = { ...DEFAULT_GEAR, elevator: 3, elevatorColumn: 17 };
    const mine = createMine(123, gear, NO_CONSUMABLES);
    useMineStore.setState({
      mine,
      gear,
      consumables: stock({ ladder: 1 }),
      moves: ["left"] as MineAction[],
      balance: 40,
      tripIndex: 2,
      worldLoaded: true,
      activeSlot: 1,
    });
    const reloadedGear = { ...DEFAULT_GEAR, elevator: 5, elevatorColumn: 17 };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/elevator/upgrade") {
        return jsonResponse(
          {
            code: "elevator-stale-rail-state",
            error: "your rail moved",
            balance: 88,
            elevator: 5,
            tripIndex: 12,
          },
          409,
        );
      }
      if (url === "/api/mine/world") {
        return jsonResponse({
          seed: 999,
          tripIndex: 12,
          diff: [],
          activeSlot: 1,
        });
      }
      if (url === "/api/gear") {
        return jsonResponse({
          gear: reloadedGear,
          consumables: NO_CONSUMABLES,
          balance: 88,
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(store().buyElevator()).resolves.toBe(false);

    // A stale reject routes through the bounded refetch: the world and gear are
    // rebuilt from the server as one checkpoint, not a scalar merge that leaves
    // the rail depth and trip index disagreeing with the world.
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain("/api/mine/world");
    expect(urls).toContain("/api/gear");
    // The elevator resync deliberately skips the seed+tripIndex account-trip
    // checkpoint: restoring it could replay stale rail gear at the same index.
    expect(urls).not.toContain("/api/account/trip");
    expect(store().tripIndex).toBe(12);
    expect(store().gear).toMatchObject({ elevator: 5 });
    // The sim itself is rebuilt over the authoritative gear (no mixed state
    // where top-level gear and mine.gear disagree), and the trip starts fresh.
    expect(store().mine.gear.elevator).toBe(5);
    expect(store().moves).toEqual([]);
    expect(store().balance).toBe(88);
    expect(store().shopNote).toBe(
      "your rail moved on another device; refreshed to the latest",
    );
  });

  it("ignores a stale account-trip checkpoint at the same index during an elevator resync", async () => {
    // The regression the fix targets: another device won the rail (depth 3 -> 5)
    // WITHOUT advancing the trip count, so the account-trip endpoint still holds
    // a checkpoint at the same seed and tripIndex carrying the OLD rail gear and
    // moves. A naive refresh that restores that checkpoint would replay it and
    // leave mine.gear stale. The elevator resync must skip it entirely.
    const gear = { ...DEFAULT_GEAR, elevator: 3, elevatorColumn: 17 };
    const mine = createMine(123, gear, NO_CONSUMABLES);
    useMineStore.setState({
      mine,
      gear,
      consumables: stock({ ladder: 1 }),
      moves: ["left"] as MineAction[],
      balance: 40,
      tripIndex: 7,
      worldLoaded: true,
      activeSlot: 1,
    });
    const staleGear = { ...DEFAULT_GEAR, elevator: 3, elevatorColumn: 17 };
    const freshGear = { ...DEFAULT_GEAR, elevator: 5, elevatorColumn: 17 };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/elevator/upgrade") {
        return jsonResponse(
          { code: "elevator-stale-rail-state", elevator: 5, tripIndex: 7 },
          409,
        );
      }
      // The account-trip payload still describes the pre-buy rail at the same
      // index. If the resync fetched and restored it, mine.gear would go stale.
      if (url === "/api/account/trip") {
        return jsonResponse({
          trip: {
            mineVersion: MINE_VERSION,
            seed: 555,
            tripIndex: 7,
            gear: staleGear,
            consumables: NO_CONSUMABLES,
            baseDiff: [],
            moves: ["right"],
            pendingBunker: null,
          },
        });
      }
      if (url === "/api/mine/world") {
        return jsonResponse({
          seed: 555,
          tripIndex: 7,
          diff: [],
          activeSlot: 1,
        });
      }
      if (url === "/api/gear") {
        return jsonResponse({
          gear: freshGear,
          consumables: NO_CONSUMABLES,
          balance: 60,
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(store().buyElevator()).resolves.toBe(false);

    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).not.toContain("/api/account/trip");
    // Top-level gear, the sim gear, and the trip all reflect the authoritative
    // rail. Nothing is replayed from the same-index stale checkpoint.
    expect(store().gear).toMatchObject({ elevator: 5 });
    expect(store().mine.gear.elevator).toBe(5);
    expect(store().moves).toEqual([]);
    expect(store().balance).toBe(60);
  });

  it("refetches on a concurrent-loss reject too", async () => {
    const gear = { ...DEFAULT_GEAR, elevator: 3, elevatorColumn: 17 };
    const mine = createMine(123, gear, NO_CONSUMABLES);
    useMineStore.setState({
      mine,
      gear,
      consumables: stock({ ladder: 1 }),
      moves: ["left"] as MineAction[],
      balance: 40,
      tripIndex: 2,
      worldLoaded: true,
      activeSlot: 1,
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/elevator/upgrade") {
        return jsonResponse(
          { code: "elevator-concurrent-loss", elevator: 4, tripIndex: 8 },
          409,
        );
      }
      if (url === "/api/mine/world") {
        return jsonResponse({
          seed: 999,
          tripIndex: 8,
          diff: [],
          activeSlot: 1,
        });
      }
      if (url === "/api/gear") {
        return jsonResponse({
          gear: { ...DEFAULT_GEAR, elevator: 4, elevatorColumn: 17 },
          consumables: NO_CONSUMABLES,
          balance: 70,
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(store().buyElevator()).resolves.toBe(false);

    // A bare lost guarded race is an unknown-winner case, so it refreshes too.
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toContain("/api/mine/world");
    expect(urls).toContain("/api/gear");
    expect(store().tripIndex).toBe(8);
    expect(store().mine.gear.elevator).toBe(4);
    expect(store().shopNote).toBe(
      "another change landed first; refreshed to the latest",
    );
  });

  it("fails fast into a reopen prompt when the conflict refetch cannot load", async () => {
    const gear = { ...DEFAULT_GEAR, elevator: 3, elevatorColumn: 17 };
    const mine = createMine(123, gear, NO_CONSUMABLES);
    useMineStore.setState({
      mine,
      gear,
      consumables: stock({ ladder: 1 }),
      moves: ["left"] as MineAction[],
      balance: 40,
      tripIndex: 2,
      worldLoaded: true,
      activeSlot: 1,
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/elevator/upgrade") {
        return jsonResponse(
          { code: "elevator-stale-checkpoint", elevator: 3, tripIndex: 9 },
          409,
        );
      }
      // The authoritative world read fails: no "refreshed" claim may be shown.
      if (url === "/api/mine/world") return jsonResponse({}, 500);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(store().buyElevator()).resolves.toBe(false);

    expect(store().shopNote).toBe("couldn't refresh the rail; reopen the shop");
  });

  it("drops the local trip and reopens when only the gear refetch fails", async () => {
    const gear = { ...DEFAULT_GEAR, elevator: 3, elevatorColumn: 17 };
    const mine = createMine(123, gear, NO_CONSUMABLES);
    useMineStore.setState({
      mine,
      gear,
      consumables: stock({ ladder: 1 }),
      moves: ["left"] as MineAction[],
      balance: 40,
      tripIndex: 2,
      worldLoaded: true,
      activeSlot: 1,
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/elevator/upgrade") {
        return jsonResponse(
          { code: "elevator-stale-rail-state", elevator: 5, tripIndex: 9 },
          409,
        );
      }
      if (url === "/api/mine/world") {
        return jsonResponse({
          seed: 999,
          tripIndex: 9,
          diff: [],
          activeSlot: 1,
        });
      }
      // The gear read fails after the world rebuilt: the resync must drop the
      // persisted trip so no new-world/old-gear checkpoint lingers, and it must
      // not claim a refresh.
      if (url === "/api/gear") return jsonResponse({}, 500);
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(store().buyElevator()).resolves.toBe(false);

    expect(store().shopNote).toBe("couldn't refresh the rail; reopen the shop");
    expect(localStorage.removeItem).toHaveBeenCalled();
  });

  it("clears the remote account-trip checkpoint after a signed-in resync", async () => {
    const gear = { ...DEFAULT_GEAR, elevator: 3, elevatorColumn: 17 };
    const mine = createMine(123, gear, NO_CONSUMABLES);
    useMineStore.setState({
      mine,
      gear,
      consumables: stock({ ladder: 1 }),
      moves: ["left"] as MineAction[],
      balance: 40,
      tripIndex: 2,
      worldLoaded: true,
      activeSlot: 1,
      accountSync: {
        state: "ready",
        providerStatus: {
          provider: "clerk",
          ready: true,
          reason: null,
          issues: [],
        },
        mode: "signed_in",
        accountEmail: "player@example.com",
        currentSave: null,
        accountSave: null,
      },
    });
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      void opts;
      if (url === "/api/elevator/upgrade") {
        return jsonResponse(
          { code: "elevator-stale-rail-state", elevator: 5, tripIndex: 9 },
          409,
        );
      }
      if (url === "/api/mine/world") {
        return jsonResponse({
          seed: 999,
          tripIndex: 9,
          diff: [],
          activeSlot: 1,
        });
      }
      if (url === "/api/gear") {
        return jsonResponse({
          gear: { ...DEFAULT_GEAR, elevator: 5, elevatorColumn: 17 },
          consumables: NO_CONSUMABLES,
          balance: 88,
        });
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(store().buyElevator()).resolves.toBe(false);

    // The stale same-index remote checkpoint is dropped so a later refresh
    // cannot download and resurrect the pre-conflict rail gear.
    const cleared = fetchMock.mock.calls.some(
      ([u, opts]) => u === "/api/account/trip" && opts?.method === "DELETE",
    );
    expect(cleared).toBe(true);
  });

  it("fails fast when the remote checkpoint clear fails during a resync", async () => {
    const gear = { ...DEFAULT_GEAR, elevator: 3, elevatorColumn: 17 };
    const mine = createMine(123, gear, NO_CONSUMABLES);
    useMineStore.setState({
      mine,
      gear,
      consumables: stock({ ladder: 1 }),
      moves: ["left"] as MineAction[],
      balance: 40,
      tripIndex: 2,
      worldLoaded: true,
      activeSlot: 1,
      accountSync: {
        state: "ready",
        providerStatus: {
          provider: "clerk",
          ready: true,
          reason: null,
          issues: [],
        },
        mode: "signed_in",
        accountEmail: "player@example.com",
        currentSave: null,
        accountSave: null,
      },
    });
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (url === "/api/elevator/upgrade") {
        return jsonResponse(
          { code: "elevator-stale-rail-state", elevator: 5, tripIndex: 9 },
          409,
        );
      }
      if (url === "/api/mine/world") {
        return jsonResponse({
          seed: 999,
          tripIndex: 9,
          diff: [],
          activeSlot: 1,
        });
      }
      if (url === "/api/gear") {
        return jsonResponse({
          gear: { ...DEFAULT_GEAR, elevator: 5, elevatorColumn: 17 },
          consumables: NO_CONSUMABLES,
          balance: 88,
        });
      }
      // The remote checkpoint clear (DELETE) fails: a resurrectable checkpoint
      // survives, so the resync must not report success.
      if (url === "/api/account/trip" && opts?.method === "DELETE") {
        return jsonResponse({}, 500);
      }
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(store().buyElevator()).resolves.toBe(false);

    expect(store().shopNote).toBe("couldn't refresh the rail; reopen the shop");
  });

  it("replaces support stock from the accepted rail response", async () => {
    const gear = { ...DEFAULT_GEAR, elevator: 4, elevatorColumn: 17 };
    const mine = createMine(123, gear, NO_CONSUMABLES);
    useMineStore.setState({
      mine,
      gear,
      consumables: stock({ ladder: 5, plank: 2 }),
      moves: ["left"] as MineAction[],
      balance: 80,
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        elevator: 5,
        elevatorColumn: 17,
        tripIndex: 6,
        balance: 55,
        refundedLadders: 1,
        refundedSupports: { ladder: 1 },
        ladders: 9,
        planks: 3,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(store().buyElevator()).resolves.toBe(true);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      expectedDepth: 4,
    });
    // Authoritative counts replace local stock; the +1 refund is not re-added.
    expect(store().consumables).toMatchObject({ ladder: 9, plank: 3 });
    expect(store().balance).toBe(55);
    expect(store().gear).toMatchObject({ elevator: 5 });
  });

  it("claims and edits a locally clear bunker before banking", () => {
    const mine = clearedBunkerMine();
    useMineStore.setState({
      mine,
      consumables: STARTING_CONSUMABLES,
      moves: ["down", "down", "down", "down", "down"] as MineAction[],
      tick: 5,
    });

    expect(store().claimPendingBunker(START_COL, 5)).toBe(true);
    expect(store().pendingBunker?.bunker.footprint).toMatchObject({
      col: START_COL - 3,
      row: 1,
      width: 7,
      height: 5,
    });

    // The spawn pocket opens the bottom-center floor cells; build there.
    expect(store().placePendingBunkerPart("wall-panel", START_COL - 1, 5)).toBe(
      true,
    );
    expect(store().pendingBunker?.inventory["wall-panel"]).toBe(5);
    expect(
      store().movePendingBunkerPart(START_COL - 1, 5, START_COL + 1, 5),
    ).toBe(true);
    expect(store().pendingBunker?.bunker.parts[0]).toMatchObject({
      partId: "wall-panel",
      col: START_COL + 1,
      row: 5,
    });
    expect(store().removePendingBunkerPart(START_COL + 1, 5)).toBe(true);
    expect(store().pendingBunker?.inventory["wall-panel"]).toBe(6);
  });

  it("edits pending bunker parts on deeper layers independently", () => {
    const mine = clearedBunkerMine();
    useMineStore.setState({
      mine,
      consumables: STARTING_CONSUMABLES,
      moves: ["down", "down", "down", "down", "down"] as MineAction[],
      tick: 5,
    });

    expect(store().claimPendingBunker(START_COL, 5)).toBe(true);
    // A pocket floor cell (open at depths 0, 1, and 2); dig deeper from it.
    const col = START_COL - 1;
    const row = 5;
    expect(store().placePendingBunkerPart("wall-panel", col, row, 0)).toBe(
      true,
    );
    // The pocket is 3 deep: depth 3 is the first claim rock and must be
    // dug before the same col/row one layer deeper is its own buildable
    // cell.
    expect(store().placePendingBunkerPart("wall-panel", col, row, 3)).toBe(
      false,
    );
    expect(store().excavatePendingBunkerCell(col, row, 3)).toBe(true);
    expect(store().pendingBunker?.bunker.dug).toContainEqual({
      col,
      row,
      depth: 3,
    });
    expect(store().placePendingBunkerPart("wall-panel", col, row, 3)).toBe(
      true,
    );
    expect(
      store().pendingBunker?.bunker.parts.map((part) => part.depth),
    ).toEqual([0, 3]);
    // Removing at the wrong depth misses; the right depth refunds.
    expect(store().removePendingBunkerPart(col, row, 4)).toBe(false);
    expect(store().removePendingBunkerPart(col, row, 3)).toBe(true);
    expect(store().excavatePendingBunkerCell(col, row, 4)).toBe(true);
    // Chains must connect: a cell with no open face stays unreachable.
    expect(store().excavatePendingBunkerCell(START_COL - 2, 1, 4)).toBe(false);
    expect(store().movePendingBunkerPart(col, row, col, row, 0, 4)).toBe(true);
    expect(store().pendingBunker?.bunker.parts[0]).toMatchObject({
      col,
      row,
      depth: 4,
    });
  });

  it("resets a pending bunker locally through the sim reset (F-093)", () => {
    const mine = clearedBunkerMine();
    useMineStore.setState({
      mine,
      consumables: STARTING_CONSUMABLES,
      moves: ["down", "down", "down", "down", "down"] as MineAction[],
      tick: 5,
    });

    expect(store().resetPendingBunker()).toBe(false);
    expect(store().claimPendingBunker(START_COL, 5)).toBe(true);
    expect(store().placePendingBunkerPart("wall-panel", START_COL - 1, 5)).toBe(
      true,
    );
    // Dig one cell deeper than the pocket to prove the excavation survives.
    expect(store().excavatePendingBunkerCell(START_COL - 1, 5, 3)).toBe(true);
    expect(store().pendingBunker?.inventory["wall-panel"]).toBe(5);
    const dugBeforeReset = store().pendingBunker?.bunker.dug;

    expect(store().resetPendingBunker()).toBe(true);

    // The undamaged wall refunds and the claim stays pending for the
    // bank, but the excavation is preserved (F-120: dug rock stays dug).
    expect(store().pendingBunker?.inventory["wall-panel"]).toBe(6);
    expect(store().pendingBunker?.bunker.parts).toEqual([]);
    expect(store().pendingBunker?.bunker.dug).toEqual(dugBeforeReset);
    expect(store().pendingBunker?.bunker.footprint).toMatchObject({
      col: START_COL - 3,
      row: 1,
    });
    // The reset persists into the trip checkpoint.
    const lastSaved = vi.mocked(localStorage.setItem).mock.calls.at(-1);
    expect(
      JSON.parse(lastSaved?.[1] ?? "{}").pendingBunker?.bunker.parts,
    ).toEqual([]);
  });

  it("refuses a pending bunker when the live footprint is blocked", () => {
    const mine = clearedBunkerMine();
    setCell(mine, START_COL - 3, 5, { kind: "dirt" });
    useMineStore.setState({
      mine,
      consumables: STARTING_CONSUMABLES,
      moves: ["down", "down", "down", "down", "down"] as MineAction[],
      tick: 5,
    });

    expect(store().claimPendingBunker(START_COL, 5)).toBe(false);
    expect(store().pendingBunker).toBeNull();
  });

  it("sends and clears a pending bunker on successful cash-out", async () => {
    const mine = clearedBunkerMine();
    useMineStore.setState({
      mine,
      consumables: STARTING_CONSUMABLES,
      moves: ["down", "down", "down", "down", "down"] as MineAction[],
      tick: 5,
      tripBaseDiff: exportDiff(mine),
    });
    expect(store().claimPendingBunker(START_COL, 5)).toBe(true);
    expect(store().placePendingBunkerPart("wall-panel", START_COL - 1, 5)).toBe(
      true,
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        credited: { credits: 0, parts: [], milestoneBonus: 0 },
        balance: 10,
        tripIndex: 3,
        consumables: STARTING_CONSUMABLES,
        bunkerClaimed: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await store().submitCashOut();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.pendingBunker).toMatchObject({
      claimCol: START_COL,
      claimRow: 5,
      claimedAtMoveCount: 5,
      parts: [{ partId: "wall-panel", col: START_COL - 1, row: 5 }],
    });
    expect(store().pendingBunker).toBeNull();
    expect(store().cashOut).toMatchObject({
      state: "done",
      bunkerClaimed: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const lastSaved = vi.mocked(localStorage.setItem).mock.calls.at(-1);
    expect(JSON.parse(lastSaved?.[1] ?? "{}").pendingBunker).toBeNull();
  });

  it("keeps a pending bunker when cash-out fails", async () => {
    const mine = clearedBunkerMine();
    useMineStore.setState({
      mine,
      consumables: STARTING_CONSUMABLES,
      moves: ["down", "down", "down", "down", "down"] as MineAction[],
      tick: 5,
      tripBaseDiff: exportDiff(mine),
    });
    expect(store().claimPendingBunker(START_COL, 5)).toBe(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse({ error: "retry" }, 409)),
    );

    await store().submitCashOut();

    expect(store().pendingBunker).not.toBeNull();
    expect(store().cashOut).toEqual({ state: "error", message: "retry" });
  });

  it("clears stale local trips after mine-version cash-out rejects", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: "the mine has shifted since this trip started; start fresh",
            code: "mine_version_mismatch",
            expectedMineVersion: MINE_VERSION,
          },
          409,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          seed: 321,
          tripIndex: 7,
          diff: [],
          activeSlot: 1,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          gear: DEFAULT_GEAR,
          consumables: stock({ ladder: 4 }),
          balance: 12,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await store().submitCashOut();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(localStorage.removeItem).toHaveBeenCalledWith(
      "vibebots-mine-trip-v2-slot-1",
    );
    expect(store().seed).toBe(321);
    expect(store().tripIndex).toBe(7);
    expect(store().moves).toEqual([]);
    expect(store().cashOut).toEqual({
      state: "error",
      message: "Mine updated. Your save is restored; start a fresh trip.",
    });
  });

  it("keeps the sold resource breakdown on successful cash-out", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          credited: {
            credits: 45,
            parts: [],
            milestoneBonus: 0,
            soldHaul: {
              ores: { coal: 3, silver: 2 },
              salvageCredits: 0,
              totalVibes: 45,
            },
          },
          balance: 55,
          tripIndex: 3,
          consumables: stock(),
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ cleared: true }));
    vi.stubGlobal("fetch", fetchMock);

    await store().submitCashOut();

    expect(store().cashOut).toEqual({
      state: "done",
      credits: 45,
      parts: [],
      milestoneBonus: 0,
      balance: 55,
      soldHaul: {
        ores: { coal: 3, silver: 2 },
        salvageCredits: 0,
        totalVibes: 45,
      },
    });
  });

  it("starts the next trip from the authoritative cash-out diff", async () => {
    const authoritativeDiff = [[17, 1, { kind: "empty" }]] as ReturnType<
      typeof exportDiff
    >;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse({
          credited: { credits: 45, parts: [], milestoneBonus: 0 },
          balance: 55,
          tripIndex: 3,
          diff: authoritativeDiff,
          consumables: stock(),
        }),
      ),
    );

    await expect(store().submitCashOut()).resolves.toBe(true);

    expect(store().tripBaseDiff).toEqual(authoritativeDiff);
    expect(cellAt(store().mine, 17, 1)).toEqual({ kind: "empty" });
    const savedTrip = JSON.parse(
      vi.mocked(localStorage.setItem).mock.calls.at(-1)?.[1] ?? "{}",
    );
    expect(savedTrip.baseDiff).toEqual(authoritativeDiff);
  });

  it("spends and returns a surface-only trip to the base", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ balance: 8 }));
    vi.stubGlobal("fetch", fetchMock);
    const mine = store().mine;
    mine.miner.col = 36;
    useMineStore.setState({
      mine,
      moves: ["right", "right"] as MineAction[],
      tick: 2,
    });

    const ok = await store().teleportToBase(2);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/mine/base-teleport",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ cost: 2 }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store().mine.miner.col).toBe(0);
    expect(store().moves).toEqual([]);
    expect(store().balance).toBe(8);

    const lastSaved = vi.mocked(localStorage.setItem).mock.calls.at(-1);
    expect(lastSaved).toBeTruthy();
    expect(JSON.parse(lastSaved?.[1] ?? "{}").moves).toEqual([]);
  });

  it("returns a surfaced mining trip to the base without checkpointing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ balance: 7 }));
    vi.stubGlobal("fetch", fetchMock);
    const mine = store().mine;
    mine.miner.col = 36;
    mine.miner.row = 0;
    useMineStore.setState({
      mine,
      moves: ["down", "up", "right"] as MineAction[],
      tick: 3,
    });

    const ok = await store().teleportToBase(3);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/mine/base-teleport");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ cost: 3 });
    expect(store().tripIndex).toBe(2);
    expect(store().mine.miner.col).toBe(0);
    expect(store().moves).toEqual([]);
    expect(store().balance).toBe(7);
    expect(store().shopNote).toBe("teleported to base for 3 vibes");
  });

  it("migrates the legacy local trip into slot 1", async () => {
    const saved = {
      mineVersion: MINE_VERSION,
      seed: 555,
      tripIndex: 4,
      gear: DEFAULT_GEAR,
      consumables: stock({ ladder: 1 }),
      baseDiff: [],
      moves: ["down"] as MineAction[],
    };
    localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(saved));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          seed: 555,
          tripIndex: 4,
          diff: [],
          activeSlot: 1,
        }),
      ),
    );

    await store().loadWorld();

    expect(store().activeSlot).toBe(1);
    expect(store().moves).toEqual(["down"]);
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "vibebots-mine-trip-v2-slot-1",
      JSON.stringify(saved),
    );
    expect(localStorage.removeItem).toHaveBeenCalledWith(
      "vibebots-mine-trip-v2",
    );
  });

  it("preserves a restored boarded elevator chooser through gear refresh", async () => {
    await restoreElevatorTrip(["down"]);

    expect(store().mine.miner.row).toBe(0);
    expect(store().mine.elevatorPhase).toBe("boarded");
    expect(store().resumeElevatorDirection).toBeNull();

    await store().loadGear();

    expect(store().mine.miner.row).toBe(0);
    expect(store().mine.elevatorPhase).toBe("boarded");
    expect(store().resumeElevatorDirection).toBeNull();
    expect(store().elevatorPlacementRequired).toBe(true);
  });

  it("preserves restored elevator descent through gear refresh", async () => {
    await restoreElevatorTrip(["down", "ride-down"]);

    expect(store().mine.miner.row).toBe(6);
    expect(store().mine.elevatorPhase).toBe("riding-down");
    expect(store().resumeElevatorDirection).toBe("ride-down");

    await store().loadGear();

    expect(store().mine.miner.row).toBe(6);
    expect(store().resumeElevatorDirection).toBe("ride-down");
    expect(store().elevatorPlacementRequired).toBe(true);
  });

  it("keeps a restored ride armed when an early action is refused", async () => {
    await restoreElevatorTrip(["down", "ride-down"]);

    expect(store().resumeElevatorDirection).toBe("ride-down");
    store().move("left");

    expect(store().lastResult).toEqual({ ok: false, reason: "blocked" });
    expect(store().mine.elevatorPhase).toBe("riding-down");
    expect(store().resumeElevatorDirection).toBe("ride-down");
  });

  it("preserves restored elevator ascent through gear refresh", async () => {
    await restoreElevatorTrip([
      "down",
      "ride-down",
      "ride-down",
      "ride-down",
      "ride-down",
      "ride-up",
    ]);

    expect(store().mine.miner.row).toBe(14);
    expect(store().mine.elevatorPhase).toBe("riding-up");
    expect(store().resumeElevatorDirection).toBe("ride-up");

    await store().loadGear();

    expect(store().mine.miner.row).toBe(14);
    expect(store().resumeElevatorDirection).toBe("ride-up");
    expect(store().elevatorPlacementRequired).toBe(true);
  });

  it("clears a terminal saved trip replay and leaves movement usable", async () => {
    const seed = 6161;
    const mine = createMine(seed, DEFAULT_GEAR, STARTING_CONSUMABLES);
    for (let row = 1; row <= 6; row++) {
      setCell(mine, START_COL, row, { kind: "empty" });
    }
    setCell(mine, START_COL, 7, { kind: "dirt" });
    const saved = {
      mineVersion: MINE_VERSION,
      seed,
      tripIndex: 4,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: exportDiff(mine),
      moves: ["down"] as MineAction[],
      pendingBunker: {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 0,
        bunker: {
          footprint: { col: START_COL - 3, row: 1, width: 7, height: 5 },
          parts: [],
        },
        inventory: {},
      },
    };
    localStorage.setItem("vibebots-mine-trip-v2-slot-1", JSON.stringify(saved));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          activeSlot: 1,
          seed,
          tripIndex: 4,
          diff: saved.baseDiff,
        }),
      ),
    );

    await store().loadWorld();

    expect(store().mine.miner.row).toBe(0);
    expect(store().lastResult).toBeNull();
    expect(store().pendingBunker).toBeNull();
    expect(store().mine.elevatorPhase).toBe("idle");
    expect(store().resumeElevatorDirection).toBeNull();
    const consumed = JSON.parse(
      localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
    );
    expect(consumed.terminalReplayConsumed).toBe(true);
    expect(consumed.pendingBunker).toBeNull();

    store().move("right");

    expect(store().lastResult?.ok).toBe(true);
    expect(store().mine.miner.col).toBe(START_COL + 1);
    expect(store().pendingBunker).toBeNull();

    await store().loadWorld();

    expect(store().mine.miner.row).toBe(0);
    expect(store().lastResult).toBeNull();
    expect(store().pendingBunker).toBeNull();
    expect(store().resumeElevatorDirection).toBeNull();
  });

  it("surfaces a fresh-start notice when a stored trip cannot be restored (F-112)", async () => {
    const bunker = createBunker({
      col: START_COL - 3,
      row: 1,
      width: 7,
      height: 5,
    });
    const malformed = {
      mineVersion: MINE_VERSION,
      seed: 4242,
      tripIndex: 1,
      gear: DEFAULT_GEAR,
      consumables: NO_CONSUMABLES,
      baseDiff: [],
      moves: ["down"] as MineAction[],
      // A null part would have thrown in the old normalizer; now the trip is
      // dropped and the player is told a fresh one started.
      pendingBunker: {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 0,
        bunker: { ...bunker, parts: [null] },
        inventory: { ...STARTER_BASE_PART_INVENTORY },
      },
    };
    localStorage.setItem(
      "vibebots-mine-trip-v2-slot-1",
      JSON.stringify(malformed),
    );
    // The world load fails (guest/offline), so the local resume path runs.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));

    await store().loadWorld();

    expect(store().shopNote).toBe(
      "Your saved trip couldn't be restored, so a fresh one started.",
    );
    expect(store().pendingBunker).toBeNull();
    // The unusable blob was dropped so it cannot nag on the next load.
    expect(localStorage.getItem("vibebots-mine-trip-v2-slot-1")).toBeNull();
  });

  it("clears pending bunker state when a live move collapses", () => {
    const seed = 6162;
    const mine = createMine(seed, DEFAULT_GEAR, STARTING_CONSUMABLES);
    for (let row = 1; row <= 6; row++) {
      setCell(mine, START_COL, row, { kind: "empty" });
    }
    setCell(mine, START_COL, 7, { kind: "dirt" });
    useMineStore.setState({
      mine,
      seed,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      tripIndex: 4,
      tripBaseDiff: exportDiff(mine),
      moves: [],
      pendingBunker: {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 0,
        bunker: createBunker({
          col: START_COL - 3,
          row: 1,
          width: 7,
          height: 5,
        }),
        inventory: { ...STARTER_BASE_PART_INVENTORY },
      },
      worldLoaded: true,
    });

    store().move("down");

    const terminalResult = store().lastResult;
    expect(
      terminalResult?.ok &&
        terminalResult.collapsed &&
        terminalResult.fallFatal,
    ).toBe(true);
    expect(store().pendingBunker).toBeNull();
    const saved = JSON.parse(
      localStorage.getItem("vibebots-mine-trip-v2-slot-1") ?? "{}",
    );
    expect(saved.pendingBunker).toBeNull();
  });

  it("clears a terminal death result without discarding the trip log", () => {
    const seed = 6164;
    const mine = createMine(seed, DEFAULT_GEAR, STARTING_CONSUMABLES);
    for (let row = 1; row <= 6; row++) {
      setCell(mine, START_COL, row, { kind: "empty" });
    }
    setCell(mine, START_COL, 7, { kind: "dirt" });
    useMineStore.setState({
      mine,
      seed,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      tripIndex: 4,
      tripBaseDiff: exportDiff(mine),
      moves: [],
      worldLoaded: true,
    });

    store().move("down");
    const terminalResult = store().lastResult;
    expect(terminalResult?.ok && terminalResult.collapsed).toBe(true);

    store().clearTerminalResult();

    expect(store().lastResult).toBeNull();
    expect(store().lastAction).toBeNull();
    expect(store().moves).toEqual(["down"]);
  });

  it("does not overwrite a legacy local trip before the slot world loads", () => {
    const saved = {
      mineVersion: MINE_VERSION,
      seed: 555,
      tripIndex: 4,
      gear: DEFAULT_GEAR,
      consumables: stock({ ladder: 1 }),
      baseDiff: [],
      moves: ["down"] as MineAction[],
    };
    localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(saved));
    vi.mocked(localStorage.setItem).mockClear();
    useMineStore.setState({ worldLoaded: false });

    store().saveCurrentTrip();

    expect(localStorage.setItem).not.toHaveBeenCalledWith(
      "vibebots-mine-trip-v2-slot-1",
      expect.any(String),
    );
    expect(localStorage.getItem("vibebots-mine-trip-v2")).toBe(
      JSON.stringify(saved),
    );
  });

  it("loads the active slot's local trip only", async () => {
    const slotOne = {
      mineVersion: MINE_VERSION,
      seed: 111,
      tripIndex: 1,
      gear: DEFAULT_GEAR,
      consumables: NO_CONSUMABLES,
      baseDiff: [],
      moves: ["left"] as MineAction[],
    };
    const slotTwo = {
      mineVersion: MINE_VERSION,
      seed: 222,
      tripIndex: 2,
      gear: DEFAULT_GEAR,
      consumables: stock({ plank: 2 }),
      baseDiff: [],
      moves: ["down", "right"] as MineAction[],
    };
    localStorage.setItem(
      "vibebots-mine-trip-v2-slot-1",
      JSON.stringify(slotOne),
    );
    localStorage.setItem(
      "vibebots-mine-trip-v2-slot-2",
      JSON.stringify(slotTwo),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          seed: 222,
          tripIndex: 2,
          diff: [],
          activeSlot: 2,
        }),
      ),
    );

    await store().loadWorld();

    expect(store().activeSlot).toBe(2);
    expect(store().seed).toBe(222);
    expect(store().moves).toEqual(["down", "right"]);
    expect(store().consumables).toEqual(stock({ plank: 2 }));
  });

  it("resumes a non-terminal active slot trip at the replayed state", async () => {
    const seed = 333;
    const gear = { ...DEFAULT_GEAR, pickaxe: 2 };
    const consumables = stock({ ladder: 6, plank: 1 });
    const baseMine = createMine(seed, gear, consumables);
    setCell(baseMine, START_COL, 1, { kind: "empty", ladder: true });
    setCell(baseMine, START_COL, 2, { kind: "ore", ore: "coal" });
    const baseDiff = exportDiff(baseMine);
    const moves = [
      "down",
      "down",
      "down",
      "down",
      "down",
      "down",
    ] as MineAction[];
    const expected = createMine(seed, gear, consumables, baseDiff);
    for (const move of moves) {
      const result = applyAction(expected, move);
      if (!result.ok) throw new Error(`expected saved move to replay: ${move}`);
      expect(result.collapsed).toBe(false);
    }
    localStorage.setItem(
      "vibebots-mine-trip-v2-slot-1",
      JSON.stringify({
        mineVersion: MINE_VERSION,
        seed,
        tripIndex: 9,
        gear,
        consumables,
        baseDiff,
        moves,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          seed,
          tripIndex: 9,
          diff: baseDiff,
          activeSlot: 1,
        }),
      ),
    );

    await store().loadWorld();

    expect(store().activeSlot).toBe(1);
    expect(store().tripIndex).toBe(9);
    expect(store().moves).toEqual(moves);
    expect(store().mine.miner.row).toBe(expected.miner.row);
    expect(store().mine.miner.col).toBe(expected.miner.col);
    expect(store().mine.miner.energy).toBe(expected.miner.energy);
    expect(store().mine.miner.carried).toEqual(expected.miner.carried);
    expect(store().mine.miner.carriedParts).toEqual(
      expected.miner.carriedParts,
    );
    expect(store().mine.miner.carriedSalvageCredits).toBe(
      expected.miner.carriedSalvageCredits,
    );
    expect(store().consumables).toEqual(consumables);
    expect(store().lastResult).toBeNull();
  });

  it("flushes the current slot before switching save slots", async () => {
    const slotTwoGear = { ...DEFAULT_GEAR, lantern: 2 };
    const slotTwoConsumables = stock({ ladder: 4, plank: 2 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          activeSlot: 2,
          slots: [
            {
              slot: 1,
              active: false,
              exists: true,
              createdAt: "2026-06-18T00:00:00.000Z",
              balance: 10,
              deepestDepth: 3,
              partsOwned: 1,
              designs: 1,
              stamps: 2,
            },
            {
              slot: 2,
              active: true,
              exists: true,
              createdAt: "2026-06-18T00:00:00.000Z",
              balance: 0,
              deepestDepth: 0,
              partsOwned: 0,
              designs: 0,
              stamps: 0,
            },
            {
              slot: 3,
              active: false,
              exists: false,
              createdAt: null,
              balance: 0,
              deepestDepth: 0,
              partsOwned: 0,
              designs: 0,
              stamps: 0,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          seed: 456,
          tripIndex: 8,
          diff: [],
          activeSlot: 2,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          gear: slotTwoGear,
          consumables: slotTwoConsumables,
          balance: 33,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().switchSaveSlot(2);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/save-slots",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ slot: 2, create: false }),
      }),
    );
    expect(fetchMock.mock.calls[1][0]).toBe("/api/mine/world");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/gear");
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "vibebots-mine-trip-v2-slot-1",
      expect.any(String),
    );
    expect(store().activeSlot).toBe(2);
    expect(store().seed).toBe(456);
    expect(store().tripIndex).toBe(8);
    expect(store().gear).toEqual(slotTwoGear);
    expect(store().consumables).toEqual(slotTwoConsumables);
    expect(store().balance).toBe(33);
    expect(store().moves).toEqual([]);
    expect(store().saveSlots.state).toBe("ready");
  });

  it("can explicitly start an empty save slot", async () => {
    const slotThreeGear = { ...DEFAULT_GEAR, cargo: 2 };
    const slotThreeConsumables = stock({ ladder: 2, plank: 2 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          activeSlot: 3,
          slots: [
            {
              slot: 1,
              active: false,
              exists: true,
              createdAt: "2026-06-18T00:00:00.000Z",
              balance: 10,
              deepestDepth: 3,
              partsOwned: 1,
              designs: 1,
              stamps: 2,
            },
            {
              slot: 2,
              active: false,
              exists: false,
              createdAt: null,
              balance: 0,
              deepestDepth: 0,
              partsOwned: 0,
              designs: 0,
              stamps: 0,
            },
            {
              slot: 3,
              active: true,
              exists: true,
              createdAt: "2026-06-20T00:00:00.000Z",
              balance: 0,
              deepestDepth: 0,
              partsOwned: 0,
              designs: 0,
              stamps: 0,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          seed: 789,
          tripIndex: 0,
          diff: [],
          activeSlot: 3,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          gear: slotThreeGear,
          consumables: slotThreeConsumables,
          balance: 0,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().switchSaveSlot(3, { create: true });

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/save-slots",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ slot: 3, create: true }),
      }),
    );
    expect(store().activeSlot).toBe(3);
    expect(store().seed).toBe(789);
    expect(store().gear).toEqual(slotThreeGear);
    expect(store().consumables).toEqual(slotThreeConsumables);
  });

  it("keeps the current slot when loading an empty slot is rejected", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          error: "save slot is empty",
          code: "empty_save_slot",
          activeSlot: 1,
          slots: [
            {
              slot: 1,
              active: true,
              exists: true,
              createdAt: "2026-06-18T00:00:00.000Z",
              balance: 10,
              deepestDepth: 3,
              partsOwned: 1,
              designs: 1,
              stamps: 2,
            },
            {
              slot: 2,
              active: false,
              exists: false,
              createdAt: null,
              balance: 0,
              deepestDepth: 0,
              partsOwned: 0,
              designs: 0,
              stamps: 0,
            },
            {
              slot: 3,
              active: false,
              exists: false,
              createdAt: null,
              balance: 0,
              deepestDepth: 0,
              partsOwned: 0,
              designs: 0,
              stamps: 0,
            },
          ],
        },
        409,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().switchSaveSlot(2);

    expect(ok).toBe(false);
    expect(store().activeSlot).toBe(1);
    expect(store().seed).toBe(123);
    expect(store().saveSlots).toMatchObject({
      state: "error",
      activeSlot: 1,
      message: "load failed",
    });
  });

  it("loads save slot summaries without persisting the trip (F-070)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        activeSlot: 1,
        slots: [
          {
            slot: 1,
            active: true,
            exists: true,
            createdAt: "2026-06-18T00:00:00.000Z",
            balance: 10,
            deepestDepth: 3,
            partsOwned: 1,
            designs: 1,
            stamps: 2,
          },
          {
            slot: 2,
            active: false,
            exists: false,
            createdAt: null,
            balance: 0,
            deepestDepth: 0,
            partsOwned: 0,
            designs: 0,
            stamps: 0,
          },
          {
            slot: 3,
            active: false,
            exists: false,
            createdAt: null,
            balance: 0,
            deepestDepth: 0,
            partsOwned: 0,
            designs: 0,
            stamps: 0,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await store().loadSaveSlots();

    expect(fetchMock).toHaveBeenCalledWith("/api/save-slots");
    // Read-only refresh: mutating flows persist the trip themselves.
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(store().saveSlots.state).toBe("ready");
  });

  it("loads account status without persisting the trip (F-070)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        mode: "signed_in",
        activeSlot: 1,
        account: { provider: "clerk", email: "pilot@example.com" },
        currentSave: null,
        accountSave: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await store().loadAccountStatus();

    expect(fetchMock).toHaveBeenCalledWith("/api/account/status");
    // Read-only refresh: mutating flows persist the trip themselves.
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(store().accountSync).toMatchObject({
      state: "ready",
      mode: "signed_in",
      accountEmail: "pilot@example.com",
      currentSave: null,
      accountSave: null,
    });
  });

  it("does not auto-claim a signed-in device save after loading status", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        mode: "signed_in",
        activeSlot: 1,
        account: { provider: "clerk", email: "pilot@example.com" },
        currentSave: savedDeviceSummary(),
        accountSave: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await store().loadAccountStatus();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/status",
    ]);
    expect(store().accountSync).toMatchObject({
      state: "ready",
      mode: "signed_in",
      accountEmail: "pilot@example.com",
      currentSave: { balance: 10 },
      accountSave: null,
    });
  });

  it("flushes the current trip before starting account sign-in", async () => {
    markAccountProviderReady();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ stored: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          handoffId: "handoff-1",
          expiresAt: "2026-07-04T00:10:00.000Z",
          returnTo: "/mine",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const handoff = await store().startAccountSignIn("/mine");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/trip",
      "/api/account/handoff/start",
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PUT" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).trip).toMatchObject({
      mineVersion: MINE_VERSION,
      seed: 123,
      moves: ["down"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/handoff/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ returnTo: "/mine" }),
      }),
    );
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "vibebots-mine-trip-v2-slot-1",
      expect.any(String),
    );
    expect(handoff).toEqual({
      handoffId: "handoff-1",
      expiresAt: "2026-07-04T00:10:00.000Z",
      returnTo: "/mine",
    });
    expect(store().accountSync.state).toBe("ready");
  });

  it("does not checkpoint or start sign-in while the provider is pending", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const handoff = await store().startAccountSignIn("/mine");

    expect(handoff).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(store().accountSync).toMatchObject({
      state: "error",
      message: "Google sign-in pending",
    });
  });

  it("does not start account sign-in when current trip checkpointing fails", async () => {
    markAccountProviderReady();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "storage offline" }, 503));
    vi.stubGlobal("fetch", fetchMock);

    const handoff = await store().startAccountSignIn("/mine");

    expect(handoff).toBeNull();
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/trip",
    ]);
    expect(store().accountSync).toMatchObject({
      state: "error",
      message: "could not save current trip",
    });
  });

  it("starts account sign-in when checkpointing fails after a device save exists", async () => {
    markAccountProviderReady();
    useMineStore.setState((state) => ({
      accountSync: {
        ...state.accountSync,
        currentSave: savedDeviceSummary(),
      },
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "storage offline" }, 503))
      .mockResolvedValueOnce(
        jsonResponse({
          handoffId: "handoff-1",
          expiresAt: "2026-07-04T00:10:00.000Z",
          returnTo: "/mine",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const handoff = await store().startAccountSignIn("/mine");

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/trip",
      "/api/account/handoff/start",
    ]);
    expect(handoff).toEqual({
      handoffId: "handoff-1",
      expiresAt: "2026-07-04T00:10:00.000Z",
      returnTo: "/mine",
    });
    expect(store().accountSync.state).toBe("ready");
  });

  it("starts account sign-in without checkpointing when no trip is loaded", async () => {
    markAccountProviderReady();
    useMineStore.setState({ worldLoaded: false });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        handoffId: "handoff-1",
        expiresAt: "2026-07-04T00:10:00.000Z",
        returnTo: "/mine",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const handoff = await store().startAccountSignIn("/mine");

    // No loaded world means no trip to persist, so the checkpoint PUT is
    // skipped and sign-in proceeds instead of aborting.
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/handoff/start",
    ]);
    expect(handoff).toMatchObject({ handoffId: "handoff-1" });
    expect(store().accountSync.state).toBe("ready");
  });

  it("rejects malformed account sign-in handoff responses before redirect", async () => {
    markAccountProviderReady();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ stored: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          handoffId: "handoff/1",
          expiresAt: "2026-07-04T00:10:00.000Z",
          returnTo: "/mine",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const handoff = await store().startAccountSignIn("/mine");

    expect(handoff).toBeNull();
    expect(store().accountSync).toMatchObject({
      state: "error",
      message: "could not read sign-in handoff",
    });
  });

  it("refreshes account status and save slots after sign-in finishes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          mode: "cloud_loaded",
          result: "claimed",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          mode: "cloud_loaded",
          activeSlot: 1,
          account: { provider: "clerk", email: "pilot@example.com" },
          currentSave: {
            exists: true,
            createdAt: "2026-07-04T00:00:00.000Z",
            balance: 10,
            deepestDepth: 3,
            partsOwned: 1,
            designs: 1,
            stamps: 2,
          },
          accountSave: {
            exists: true,
            createdAt: "2026-07-04T00:00:00.000Z",
            balance: 10,
            deepestDepth: 3,
            partsOwned: 1,
            designs: 1,
            stamps: 2,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          activeSlot: 1,
          slots: [
            {
              slot: 1,
              active: true,
              exists: true,
              createdAt: "2026-07-04T00:00:00.000Z",
              balance: 10,
              deepestDepth: 3,
              partsOwned: 1,
              designs: 1,
              stamps: 2,
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().finishAccountSignIn("handoff-1");

    expect(ok).toBe(true);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/handoff/finish",
      "/api/account/status",
      "/api/save-slots",
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ handoffId: "handoff-1" }),
    });
    expect(localStorage.removeItem).not.toHaveBeenCalled();
    expect(store().accountSync).toMatchObject({
      state: "ready",
      mode: "cloud_loaded",
      accountEmail: "pilot@example.com",
    });
    expect(store().saveSlots.state).toBe("ready");
  });

  it("shows an expired handoff error when sign-in return is stale", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "expired handoff" }, 410));
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().finishAccountSignIn("handoff-1");

    expect(ok).toBe(false);
    expect(store().accountSync).toMatchObject({
      state: "error",
      message: "sign-in handoff expired",
    });
  });

  it("rejects malformed account sign-in callback tokens before network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().finishAccountSignIn("handoff/1");

    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store().accountSync).toMatchObject({
      state: "error",
      message: "sign-in finish failed",
    });
  });

  it("claims the current save for a signed-in account", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ stored: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          mode: "cloud_loaded",
          result: "claimed",
          accountSave: {
            exists: true,
            createdAt: "2026-07-04T00:00:00.000Z",
            balance: 10,
            deepestDepth: 3,
            partsOwned: 1,
            designs: 1,
            stamps: 2,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          mode: "cloud_loaded",
          activeSlot: 1,
          account: { provider: "clerk", email: "pilot@example.com" },
          currentSave: {
            exists: true,
            createdAt: "2026-07-04T00:00:00.000Z",
            balance: 10,
            deepestDepth: 3,
            partsOwned: 1,
            designs: 1,
            stamps: 2,
          },
          accountSave: {
            exists: true,
            createdAt: "2026-07-04T00:00:00.000Z",
            balance: 10,
            deepestDepth: 3,
            partsOwned: 1,
            designs: 1,
            stamps: 2,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          activeSlot: 1,
          slots: [
            {
              slot: 1,
              active: true,
              exists: true,
              createdAt: "2026-07-04T00:00:00.000Z",
              balance: 10,
              deepestDepth: 3,
              partsOwned: 1,
              designs: 1,
              stamps: 2,
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().claimAccountSave();

    expect(ok).toBe(true);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/trip",
      "/api/account/claim",
      "/api/account/status",
      "/api/save-slots",
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PUT" });
    expect(store().accountSync).toMatchObject({
      state: "ready",
      mode: "cloud_loaded",
      accountEmail: "pilot@example.com",
    });
    expect(store().saveSlots.state).toBe("ready");
  });

  it("does not claim an account save when current trip checkpointing fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "storage offline" }, 503));
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().claimAccountSave();

    expect(ok).toBe(false);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/trip",
    ]);
    expect(store().accountSync).toMatchObject({
      state: "error",
      message: "could not save current trip",
    });
  });

  it("claims without checkpointing when no trip is loaded", async () => {
    useMineStore.setState((state) => ({
      worldLoaded: false,
      accountSync: {
        ...state.accountSync,
        providerStatus: {
          provider: "clerk",
          ready: true,
          reason: null,
          issues: [],
        },
        mode: "signed_in",
        accountEmail: "pilot@example.com",
      },
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "guest save not found", code: "guest_save_not_found" },
          404,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().claimAccountSave();

    expect(ok).toBe(false);
    // No loaded world means no trip to persist, so the checkpoint PUT is
    // skipped and the claim proceeds to the claim route.
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/claim",
    ]);
    expect(store().accountSync).toMatchObject({
      state: "error",
      message: "guest save not found",
    });
  });

  it("shows the account claim route error when claim is rejected", async () => {
    useMineStore.setState((state) => ({
      accountSync: {
        ...state.accountSync,
        providerStatus: {
          provider: "clerk",
          ready: true,
          reason: null,
          issues: [],
        },
        mode: "signed_in",
        accountEmail: "pilot@example.com",
        currentSave: savedDeviceSummary(),
      },
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ stored: true }))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: "guest save not found", code: "guest_save_not_found" },
          404,
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().claimAccountSave();

    expect(ok).toBe(false);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/trip",
      "/api/account/claim",
    ]);
    expect(store().accountSync).toMatchObject({
      state: "error",
      message: "guest save not found",
    });
  });

  it("claims an account save when checkpointing fails after a device save exists", async () => {
    useMineStore.setState((state) => ({
      accountSync: {
        ...state.accountSync,
        providerStatus: {
          provider: "clerk",
          ready: true,
          reason: null,
          issues: [],
        },
        mode: "signed_in",
        accountEmail: "pilot@example.com",
        currentSave: savedDeviceSummary(),
      },
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "storage offline" }, 503))
      .mockResolvedValueOnce(
        jsonResponse({
          mode: "cloud_loaded",
          result: "claimed",
          accountSave: savedDeviceSummary(),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          mode: "cloud_loaded",
          activeSlot: 1,
          account: { provider: "clerk", email: "pilot@example.com" },
          currentSave: savedDeviceSummary(),
          accountSave: savedDeviceSummary(),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          activeSlot: 1,
          slots: [
            {
              slot: 1,
              active: true,
              ...savedDeviceSummary(),
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().claimAccountSave();

    expect(ok).toBe(true);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/trip",
      "/api/account/claim",
      "/api/account/status",
      "/api/save-slots",
    ]);
    expect(store().accountSync).toMatchObject({
      state: "ready",
      mode: "cloud_loaded",
      accountEmail: "pilot@example.com",
      currentSave: { balance: 10 },
      accountSave: { balance: 10 },
    });
  });

  it("keeps both saves when claim finds an account conflict", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ stored: true }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: "account already has a cloud save",
            mode: "conflict",
            accountSave: {
              exists: true,
              createdAt: "2026-07-03T00:00:00.000Z",
              balance: 30,
              deepestDepth: 8,
              partsOwned: 4,
              designs: 3,
              stamps: 2,
            },
          },
          409,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          mode: "conflict",
          activeSlot: 1,
          account: { provider: "clerk", email: "pilot@example.com" },
          currentSave: {
            exists: true,
            createdAt: "2026-07-04T00:00:00.000Z",
            balance: 10,
            deepestDepth: 3,
            partsOwned: 1,
            designs: 1,
            stamps: 2,
          },
          accountSave: {
            exists: true,
            createdAt: "2026-07-03T00:00:00.000Z",
            balance: 30,
            deepestDepth: 8,
            partsOwned: 4,
            designs: 3,
            stamps: 2,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().claimAccountSave();

    expect(ok).toBe(false);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/trip",
      "/api/account/claim",
      "/api/account/status",
    ]);
    expect(store().accountSync).toMatchObject({
      state: "ready",
      mode: "conflict",
      accountEmail: "pilot@example.com",
      currentSave: { balance: 10 },
      accountSave: { balance: 30 },
    });
  });

  it("loads a cloud save only after the account route succeeds", async () => {
    localStorage.setItem(
      "vibebots-mine-trip-v2-slot-1",
      JSON.stringify({
        mineVersion: MINE_VERSION,
        seed: 123,
        tripIndex: 2,
        gear: DEFAULT_GEAR,
        consumables: NO_CONSUMABLES,
        baseDiff: [],
        moves: ["down"] as MineAction[],
      }),
    );
    const cloudGear = { ...DEFAULT_GEAR, pickaxe: 2 };
    // The save-slot list loads in parallel with the world/gear chain, so the
    // mock keys responses by URL instead of call order.
    const responsesByUrl: Record<string, () => Response> = {
      "/api/account/load": () =>
        jsonResponse({
          mode: "cloud_loaded",
          activeSlot: 1,
          accountSave: {
            exists: true,
            createdAt: "2026-07-03T00:00:00.000Z",
            balance: 30,
            deepestDepth: 8,
            partsOwned: 4,
            designs: 3,
            stamps: 2,
          },
        }),
      "/api/account/trip": () =>
        jsonResponse({
          trip: {
            mineVersion: MINE_VERSION,
            seed: 777,
            tripIndex: 6,
            gear: cloudGear,
            consumables: stock({ ladder: 1 }),
            baseDiff: [],
            moves: ["down"],
          },
        }),
      "/api/mine/world": () =>
        jsonResponse({
          seed: 777,
          tripIndex: 6,
          diff: [],
          activeSlot: 1,
        }),
      "/api/gear": () =>
        jsonResponse({
          gear: cloudGear,
          consumables: stock({ ladder: 1 }),
          balance: 30,
          deepestDepth: 8,
        }),
      "/api/save-slots": () =>
        jsonResponse({
          activeSlot: 1,
          slots: [
            {
              slot: 1,
              active: true,
              exists: true,
              createdAt: "2026-07-03T00:00:00.000Z",
              balance: 30,
              deepestDepth: 8,
              partsOwned: 4,
              designs: 3,
              stamps: 2,
            },
          ],
        }),
    };
    const fetchMock = vi.fn(async (url: string) => {
      const respond = responsesByUrl[url];
      if (!respond) throw new Error(`unexpected fetch: ${url}`);
      return respond();
    });
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().loadAccountSave();

    expect(ok).toBe(true);
    const calledUrls = fetchMock.mock.calls.map((call) => call[0]);
    expect(calledUrls.slice(0, 2)).toEqual([
      "/api/account/load",
      "/api/account/trip",
    ]);
    expect([...calledUrls].sort()).toEqual([
      "/api/account/load",
      "/api/account/trip",
      "/api/gear",
      "/api/mine/world",
      "/api/save-slots",
    ]);
    expect(localStorage.removeItem).toHaveBeenCalledWith(
      "vibebots-mine-trip-v2-slot-1",
    );
    expect(store().seed).toBe(777);
    expect(store().tripIndex).toBe(6);
    expect(store().gear).toEqual(cloudGear);
    expect(store().balance).toBe(30);
    // The load response carries everything the popup shows; the email was
    // already in state from the status read that revealed the conflict.
    expect(store().accountSync).toMatchObject({
      state: "ready",
      mode: "cloud_loaded",
      currentSave: { balance: 30 },
      accountSave: { balance: 30 },
    });
  });

  it("does not replace local trip state for malformed cloud-load success", async () => {
    localStorage.setItem(
      "vibebots-mine-trip-v2-slot-1",
      JSON.stringify({
        mineVersion: MINE_VERSION,
        seed: 123,
        tripIndex: 2,
        gear: DEFAULT_GEAR,
        consumables: NO_CONSUMABLES,
        baseDiff: [],
        moves: ["down"] as MineAction[],
      }),
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        mode: "cloud_loaded",
        activeSlot: 1,
        accountSave: { exists: false },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().loadAccountSave();

    expect(ok).toBe(false);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/account/load",
    ]);
    expect(localStorage.removeItem).not.toHaveBeenCalled();
    expect(store().seed).toBe(123);
    expect(store().tripIndex).toBe(2);
    expect(store().accountSync).toMatchObject({
      state: "error",
      message: "could not read cloud save",
    });
  });

  it("flushes the current slot and removes the deleted slot checkpoint", async () => {
    localStorage.setItem(
      "vibebots-mine-trip-v2-slot-2",
      JSON.stringify({
        mineVersion: MINE_VERSION,
        seed: 456,
        tripIndex: 1,
        gear: DEFAULT_GEAR,
        consumables: NO_CONSUMABLES,
        baseDiff: [],
        moves: ["down"] as MineAction[],
      }),
    );
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        activeSlot: 1,
        slots: [
          {
            slot: 1,
            active: true,
            exists: true,
            createdAt: "2026-06-18T00:00:00.000Z",
            balance: 10,
            deepestDepth: 3,
            partsOwned: 1,
            designs: 1,
            stamps: 2,
          },
          {
            slot: 2,
            active: false,
            exists: false,
            createdAt: null,
            balance: 0,
            deepestDepth: 0,
            partsOwned: 0,
            designs: 0,
            stamps: 0,
          },
          {
            slot: 3,
            active: false,
            exists: false,
            createdAt: null,
            balance: 0,
            deepestDepth: 0,
            partsOwned: 0,
            designs: 0,
            stamps: 0,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().deleteSaveSlot(2);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/save-slots",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ slot: 2, confirm: "DELETE SLOT 2" }),
      }),
    );
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "vibebots-mine-trip-v2-slot-1",
      expect.any(String),
    );
    expect(localStorage.removeItem).toHaveBeenCalledWith(
      "vibebots-mine-trip-v2-slot-2",
    );
    expect(store().saveSlots.state).toBe("ready");
  });

  it("drops versionless local trips and restores the server save", async () => {
    localStorage.setItem(
      "vibebots-mine-trip-v2-slot-1",
      JSON.stringify({
        seed: 555,
        tripIndex: 4,
        gear: DEFAULT_GEAR,
        consumables: stock({ ladder: 1 }),
        baseDiff: [],
        moves: ["down"] as MineAction[],
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          seed: 555,
          tripIndex: 4,
          diff: [],
          activeSlot: 1,
        }),
      ),
    );

    await store().loadWorld();

    expect(localStorage.removeItem).toHaveBeenCalledWith(
      "vibebots-mine-trip-v2-slot-1",
    );
    expect(store().moves).toEqual([]);
    expect(store().tripIndex).toBe(4);
  });

  describe("multi-device save conflicts", () => {
    // The freshness probe throttles on Date.now; each test advances a fake
    // clock past the window so probes from earlier tests never gate later
    // ones (the throttle timestamp lives in the store module closure).
    let probeClock = 10_000_000;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      probeClock += 60_000;
      vi.setSystemTime(probeClock);
      useMineStore.setState((state) => ({
        accountSync: {
          ...state.accountSync,
          state: "ready",
          mode: "cloud_loaded",
        },
        saveConflict: "none",
      }));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function stubFetchByUrl(responses: Record<string, () => Response>) {
      const fetchMock = vi.fn(async (url: string) => {
        const respond = responses[url];
        if (!respond) throw new Error(`unexpected fetch: ${url}`);
        return respond();
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    const resyncResponses = {
      "/api/account/trip": () => jsonResponse({ trip: null }),
      "/api/mine/world": () =>
        jsonResponse({ seed: 123, tripIndex: 3, diff: [], activeSlot: 1 }),
      "/api/gear": () =>
        jsonResponse({
          gear: DEFAULT_GEAR,
          consumables: NO_CONSUMABLES,
          balance: 10,
          deepestDepth: 3,
        }),
      "/api/save-slots": () => jsonResponse({ activeSlot: 1, slots: [] }),
    };

    it("prompts when the cloud save advanced under real trip progress", async () => {
      const fetchMock = stubFetchByUrl({
        "/api/mine/world/version": () =>
          jsonResponse({ world: { seed: 123, tripCount: 3 } }),
      });

      await store().checkWorldFreshness();

      expect(store().saveConflict).toBe("prompt");
      // The doomed run stays on screen untouched until the player decides.
      expect(store().moves).toEqual(["down"]);
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
        "/api/mine/world/version",
      ]);
    });

    it("stays quiet while the local world matches the server", async () => {
      const fetchMock = stubFetchByUrl({
        "/api/mine/world/version": () =>
          jsonResponse({ world: { seed: 123, tripCount: 2 } }),
      });

      await store().checkWorldFreshness();

      expect(store().saveConflict).toBe("none");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("adopts a newer save silently when this device has no real progress", async () => {
      useMineStore.setState({ moves: [] });
      const fetchMock = stubFetchByUrl({
        "/api/mine/world/version": () =>
          jsonResponse({ world: { seed: 123, tripCount: 3 } }),
        ...resyncResponses,
      });

      await store().checkWorldFreshness();

      expect(store().saveConflict).toBe("none");
      expect(store().tripIndex).toBe(3);
      expect(fetchMock.mock.calls.map((call) => call[0])).toContain(
        "/api/mine/world",
      );
    });

    it("does not probe for guest saves", async () => {
      useMineStore.setState((state) => ({
        accountSync: { ...state.accountSync, mode: "guest" },
      }));
      const fetchMock = stubFetchByUrl({});

      await store().checkWorldFreshness();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("keeps the doomed run when the player dismisses the conflict", async () => {
      useMineStore.setState({ saveConflict: "prompt" });
      const fetchMock = stubFetchByUrl({});

      await store().resolveSaveConflict("keep");

      expect(store().saveConflict).toBe("dismissed");
      expect(store().moves).toEqual(["down"]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("syncs to the newer save when the player chooses to", async () => {
      useMineStore.setState({ saveConflict: "prompt" });
      const fetchMock = stubFetchByUrl(resyncResponses);

      await store().resolveSaveConflict("sync");

      expect(store().saveConflict).toBe("none");
      expect(store().tripIndex).toBe(3);
      expect(store().moves).toEqual([]);
      expect(fetchMock.mock.calls.map((call) => call[0])).toContain(
        "/api/mine/world",
      );
    });

    it("routes a lost cash-out race into the conflict flow", async () => {
      stubFetchByUrl({
        "/api/mine/bank": () =>
          jsonResponse(
            {
              error: "trip already cashed out",
              code: "trip_already_cashed_out",
            },
            409,
          ),
        "/api/account/trip": () => jsonResponse({ stored: true }),
      });

      const ok = await store().submitCashOut();

      expect(ok).toBe(false);
      expect(store().saveConflict).toBe("prompt");
      expect(store().cashOut).toEqual({ state: "idle" });
    });

    it("keeps the raw cash-out error for guest saves", async () => {
      useMineStore.setState((state) => ({
        accountSync: { ...state.accountSync, mode: "guest" },
      }));
      stubFetchByUrl({
        "/api/mine/bank": () =>
          jsonResponse(
            {
              error: "trip already cashed out",
              code: "trip_already_cashed_out",
            },
            409,
          ),
      });

      const ok = await store().submitCashOut();

      expect(ok).toBe(false);
      expect(store().saveConflict).toBe("none");
      expect(store().cashOut).toMatchObject({ state: "error" });
    });
  });
});
