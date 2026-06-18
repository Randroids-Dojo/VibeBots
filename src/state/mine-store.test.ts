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
});
