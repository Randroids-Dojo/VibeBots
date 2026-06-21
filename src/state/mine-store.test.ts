import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBunker, STARTER_BASE_PART_INVENTORY } from "@/sim/bunker";
import {
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
} from "@/sim/mine";
import { useMineStore } from "./mine-store";

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
      shopNote: null,
      tripIndex: 2,
      tripBaseDiff: [],
      moves: ["down"] as MineAction[],
      tick: 0,
      lastResult: null,
      lastAction: null,
      cashOut: { state: "idle" },
      pendingBunker: null,
      activeSlot: 1,
      saveSlots: { state: "unknown", activeSlot: 1, slots: [] },
      worldLoaded: true,
    });
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

    expect(store().placePendingBunkerPart("wall-panel", START_COL - 3, 1)).toBe(
      true,
    );
    expect(store().pendingBunker?.inventory["wall-panel"]).toBe(1);
    expect(
      store().movePendingBunkerPart(START_COL - 3, 1, START_COL - 2, 1),
    ).toBe(true);
    expect(store().pendingBunker?.bunker.parts[0]).toMatchObject({
      partId: "wall-panel",
      col: START_COL - 2,
      row: 1,
    });
    expect(store().removePendingBunkerPart(START_COL - 2, 1)).toBe(true);
    expect(store().pendingBunker?.inventory["wall-panel"]).toBe(2);
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
    expect(store().placePendingBunkerPart("wall-panel", START_COL - 3, 1)).toBe(
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
      parts: [{ partId: "wall-panel", col: START_COL - 3, row: 1 }],
    });
    expect(store().pendingBunker).toBeNull();
    expect(store().cashOut).toMatchObject({
      state: "done",
      bunkerClaimed: true,
    });
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
    const fetchMock = vi.fn().mockResolvedValueOnce(
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
    );
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

  it("flushes the current slot before loading save slot summaries", async () => {
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
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "vibebots-mine-trip-v2-slot-1",
      expect.any(String),
    );
    expect(store().saveSlots.state).toBe("ready");
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
});
