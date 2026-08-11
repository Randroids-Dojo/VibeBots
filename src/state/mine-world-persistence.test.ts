import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAction,
  cellAt,
  createMine,
  DEFAULT_GEAR,
  exportDiff,
  MINE_VERSION,
  type MineAction,
  START_COL,
  STARTING_CONSUMABLES,
  type WorldDiff,
} from "@/sim/mine";
import {
  tripChangedWorld,
  tripChangedWorldBeyondSurfaceBoarding,
  useMineStore,
} from "./mine-store";
import { localTripKey } from "./mine-trip-persistence";

/**
 * The carved world must survive a restart (REQ-026). This covers the load
 * path end to end, which nothing else did: a player reported breaking a
 * block, returning to the surface, restarting, and finding the block back.
 */

const SEED = 4242;

const store = () => useMineStore.getState();

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const storageless = () =>
  jsonResponse({ error: "storage not configured" }, 503);

/** Storage-less guest: world and gear both 503, so the session runs
 * entirely from localStorage. */
const storagelessFetch = () => vi.fn(async () => storageless());

/** A server that serves one world checkpoint and 503s everything else. */
function worldFetch(world: { tripIndex: number; diff: WorldDiff }) {
  return vi.fn(async (input: unknown) =>
    String(input).includes("/api/mine/world")
      ? jsonResponse({ activeSlot: 1, seed: SEED, ...world })
      : storageless(),
  );
}

/** Dig straight down until the cell below the spawn opens. Dirt takes
 * several swings, so the log is never a single action. */
function digOneBlock(): { moves: MineAction[]; row: number } {
  const mine = createMine(SEED, DEFAULT_GEAR, STARTING_CONSUMABLES);
  const moves: MineAction[] = [];
  let guard = 0;
  while (mine.miner.row < 1 && guard < 40) {
    if (applyAction(mine, "down").ok) moves.push("down");
    guard += 1;
  }
  return { moves, row: mine.miner.row };
}

/** The same dig, driven through the store so it persists as it goes. */
function digOneBlockInStore(): number {
  let guard = 0;
  while (store().mine.miner.row < 1 && guard < 40) {
    store().move("down");
    guard += 1;
  }
  return store().mine.miner.row;
}

/** A trip on disk, carved by `moves`, anchored at `tripIndex`. */
function saveTrip(tripIndex: number, moves: MineAction[]): void {
  localStorage.setItem(
    localTripKey(1),
    JSON.stringify({
      mineVersion: MINE_VERSION,
      seed: SEED,
      tripIndex,
      gear: DEFAULT_GEAR,
      consumables: STARTING_CONSUMABLES,
      baseDiff: [],
      moves,
    }),
  );
}

function setStore(seed: number, worldLoaded: boolean): void {
  useMineStore.setState((state) => ({
    // Reset the account mode too: it gates the cloud-copy prompt, and
    // zustand state is shared across tests in this file.
    accountSync: { ...state.accountSync, mode: "guest" as const },
    mine: createMine(seed, DEFAULT_GEAR, STARTING_CONSUMABLES),
    seed,
    gear: DEFAULT_GEAR,
    consumables: STARTING_CONSUMABLES,
    tripBaseDiff: [],
    moves: [],
    tripIndex: 0,
    activeSlot: 1,
    worldLoaded,
    saveConflict: "none",
  }));
}

/** A restart: the store knows only which slot it was on, so it starts on
 * a throwaway seed that the loaded world must replace. */
const restartApp = () => setStore(1, false);

/** A cloud-linked save: only these can be offered a newer cloud copy. */
function signInToCloud(): void {
  useMineStore.setState((state) => ({
    accountSync: { ...state.accountSync, mode: "cloud_loaded" },
  }));
}

describe("carved world survives a restart", () => {
  let local: Map<string, string>;

  beforeEach(() => {
    vi.restoreAllMocks();
    local = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => local.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => local.set(key, value)),
      removeItem: vi.fn((key: string) => local.delete(key)),
    });
    setStore(SEED, true);
  });

  it("counts an ore-less digging trip as worth banking", async () => {
    // The root cause of the reported loss. Reaching the surface only
    // auto-banked when the hold had loot, so "mine one block with no ore,
    // walk up" never reached the server: the carving stayed in the device's
    // move log and the stored world sat frozen at the last loot-bearing
    // trip, which is what let the two trip counters drift apart. A carved
    // shaft is a world investment (REQ-026) and the bank route already
    // accepts a zero-value trip, so the log itself decides.
    vi.stubGlobal("fetch", storagelessFetch());
    digOneBlockInStore();

    // The same predicate the surface-arrival effect in mine-panel reads.
    expect(tripChangedWorld(store().moves)).toBe(true);
    expect(store().mine.miner.bankedCredits).toBe(0);
    expect(store().mine.miner.bankedParts).toEqual([]);
  });

  it("counts activating a portal beacon as worth banking", async () => {
    // Activating a beacon writes kind, portal, and portalActive onto its
    // cell, so it is durable world state even though the miner never left
    // the surface. The conflict-prompt rule forgives portal activity, which
    // is why banking cannot simply reuse it: a trip that only lit a beacon
    // still has to reach the server or the activation is lost.
    expect(tripChangedWorld(["activate-portal:winter"])).toBe(true);
    // Warping between lit beacons only moves the miner, so it is exempt.
    expect(tripChangedWorld(["portal-warp:winter", "left"])).toBe(false);
  });

  it("does not treat boarding the elevator at the surface as worth banking", async () => {
    // Boarding at row 0 logs a "down" that alters nothing, but counting it
    // as carving made the surface auto-bank fire the moment the player
    // entered from the top: the cash-out reset the trip and kicked the bot
    // back off the car, so a ride down from the surface never started.
    const boardedAtSurface = {
      elevatorPhase: "boarded",
      miner: { row: 0 },
    } as const;
    expect(
      tripChangedWorldBeyondSurfaceBoarding(["left", "down"], boardedAtSurface),
    ).toBe(false);
    // Earlier real carving in the same trip still banks.
    expect(
      tripChangedWorldBeyondSurfaceBoarding(
        ["down", "left", "down"],
        boardedAtSurface,
      ),
    ).toBe(true);
    // A ride-up arrival at the surface is not a boarding and still banks.
    expect(
      tripChangedWorldBeyondSurfaceBoarding(["down", "ride-up"], {
        elevatorPhase: "boarded",
        miner: { row: 0 },
      }),
    ).toBe(true);
    // A trailing "down" that dug (not boarded, or not at the surface)
    // counts like any other carve.
    expect(
      tripChangedWorldBeyondSurfaceBoarding(["down"], {
        elevatorPhase: "idle",
        miner: { row: 1 },
      }),
    ).toBe(true);
    expect(
      tripChangedWorldBeyondSurfaceBoarding(["down"], {
        elevatorPhase: "boarded",
        miner: { row: 5 },
      }),
    ).toBe(true);
  });

  it("does not treat a pure surface walk as worth banking", async () => {
    // The other half of the rule: strolling the surface changes nothing,
    // so arriving back must not fire a bank on every step.
    vi.stubGlobal("fetch", storagelessFetch());
    store().move("left");
    store().move("right");

    expect(store().moves.length).toBe(2);
    expect(tripChangedWorld(store().moves)).toBe(false);
  });

  it("keeps a dug block dug after a reload (guest, storage-less)", async () => {
    vi.stubGlobal("fetch", storagelessFetch());
    const dugRow = digOneBlockInStore();
    expect(dugRow).toBe(1);
    expect(local.get(localTripKey(1))).toBeTruthy();

    restartApp();
    await store().loadWorld();
    await store().loadGear();

    expect(cellAt(store().mine, START_COL, dugRow)?.kind).toBe("empty");
  });

  it("keeps a dug block dug after the server serves the banked diff", async () => {
    vi.stubGlobal("fetch", storagelessFetch());
    const dugRow = digOneBlockInStore();
    const bankedDiff = exportDiff(store().mine);
    expect(bankedDiff.length).toBeGreaterThan(0);

    restartApp();
    local.clear();
    vi.stubGlobal("fetch", worldFetch({ tripIndex: 1, diff: bankedDiff }));
    await store().loadWorld();

    expect(cellAt(store().mine, START_COL, dugRow)?.kind).toBe("empty");
  });

  it("keeps the carved trip and prompts when the trip index diverges", async () => {
    // A signed-in save whose local trip index has drifted from the
    // server's trip_count. A fresh save cannot hit this, because both
    // counters are created in step, which is why only long-lived saves
    // showed the loss.
    const { moves, row: dugRow } = digOneBlock();
    saveTrip(7, moves);

    restartApp();
    signInToCloud();
    // The server sits one trip ahead of the device.
    vi.stubGlobal("fetch", worldFetch({ tripIndex: 8, diff: [] }));
    await store().loadWorld();

    expect(store().moves.length).toBe(moves.length);
    expect(cellAt(store().mine, START_COL, dugRow)?.kind).toBe("empty");
    expect(store().tripIndex).toBe(7);
    expect(store().saveConflict).toBe("prompt");
  });

  it("keeps a guest's diverged trip without offering a cloud copy", async () => {
    // A guest gets a server tripIndex from their cookie, so divergence is
    // reachable without any cloud save. Their work must still be kept, but
    // they must NOT be told the save changed on another device: there is
    // no other device, and no cloud copy to adopt. Same precondition
    // checkWorldFreshness applies before it prompts.
    const { moves, row: dugRow } = digOneBlock();
    saveTrip(7, moves);

    restartApp();
    vi.stubGlobal("fetch", worldFetch({ tripIndex: 8, diff: [] }));
    await store().loadWorld();

    expect(cellAt(store().mine, START_COL, dugRow)?.kind).toBe("empty");
    expect(store().tripIndex).toBe(7);
    expect(store().saveConflict).toBe("none");
  });

  it("still adopts the server world when the diverged log only walked the surface", async () => {
    // Matching checkWorldFreshness: a surface-only log is not progress
    // worth interrupting for, so a newer cloud save wins silently.
    saveTrip(7, ["left", "right"]);

    restartApp();
    vi.stubGlobal("fetch", worldFetch({ tripIndex: 8, diff: [] }));
    await store().loadWorld();

    expect(store().tripIndex).toBe(8);
    expect(store().moves).toEqual([]);
    expect(store().saveConflict).toBe("none");
  });
});
