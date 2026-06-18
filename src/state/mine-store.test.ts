import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMine,
  DEFAULT_GEAR,
  type MineAction,
  type MineConsumables,
  NO_CONSUMABLES,
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

  it("shows a reload instruction for stale mine-version cash-outs", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        {
          error: "the mine has shifted since this trip started; start fresh",
          code: "mine_version_mismatch",
          expectedMineVersion: 29,
        },
        409,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await store().submitCashOut();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store().cashOut).toEqual({
      state: "error",
      message: "Mine updated. Reload this page, then sell again.",
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

  it("does not overwrite a legacy local trip before the slot world loads", () => {
    const saved = {
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
      seed: 111,
      tripIndex: 1,
      gear: DEFAULT_GEAR,
      consumables: NO_CONSUMABLES,
      baseDiff: [],
      moves: ["left"] as MineAction[],
    };
    const slotTwo = {
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
    const fetchMock = vi.fn().mockResolvedValue(
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
    );
    vi.stubGlobal("fetch", fetchMock);

    const ok = await store().switchSaveSlot(2);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/save-slots",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ slot: 2 }),
      }),
    );
    expect(localStorage.setItem).toHaveBeenCalledWith(
      "vibebots-mine-trip-v2-slot-1",
      expect.any(String),
    );
    expect(store().activeSlot).toBe(2);
    expect(store().saveSlots.state).toBe("ready");
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
});
