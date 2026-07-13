import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBunker,
  type PendingBunkerBuild,
  STARTER_BASE_PART_INVENTORY,
} from "@/sim/bunker";
import {
  applyAction,
  createMine,
  DEFAULT_GEAR,
  exportDiff,
  MINE_VERSION,
  type MineAction,
  NO_CONSUMABLES,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
} from "@/sim/mine";
import {
  loadLocalTrip,
  localTripKey,
  removeLocalTrip,
  replaySavedTrip,
  type SavedTrip,
  saveLocalTrip,
} from "./mine-trip-persistence";

function savedTrip(overrides: Partial<SavedTrip> = {}): SavedTrip {
  return {
    mineVersion: MINE_VERSION,
    seed: 123,
    tripIndex: 2,
    gear: DEFAULT_GEAR,
    consumables: NO_CONSUMABLES,
    baseDiff: [],
    moves: ["down"] as MineAction[],
    ...overrides,
  };
}

describe("mine trip persistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const local = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => local.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => local.set(key, value)),
      removeItem: vi.fn((key: string) => local.delete(key)),
    });
  });

  it("migrates the legacy local trip into slot 1", () => {
    const trip = savedTrip();
    localStorage.setItem("vibebots-mine-trip-v2", JSON.stringify(trip));

    expect(loadLocalTrip(1)).toMatchObject({ seed: trip.seed });
    expect(localStorage.setItem).toHaveBeenCalledWith(
      localTripKey(1),
      JSON.stringify(trip),
    );
    expect(localStorage.removeItem).toHaveBeenCalledWith(
      "vibebots-mine-trip-v2",
    );
  });

  it("loads only the requested active slot", () => {
    saveLocalTrip(1, savedTrip({ seed: 111 }));
    saveLocalTrip(2, savedTrip({ seed: 222 }));

    expect(loadLocalTrip(2)?.seed).toBe(222);
    expect(loadLocalTrip(1)?.seed).toBe(111);
  });

  it("removes wrong-version, missing-version, and invalid-move trips", () => {
    localStorage.setItem(
      localTripKey(1),
      JSON.stringify(savedTrip({ mineVersion: MINE_VERSION - 1 })),
    );
    expect(loadLocalTrip(1)).toBeNull();
    expect(localStorage.removeItem).toHaveBeenCalledWith(localTripKey(1));

    localStorage.setItem(
      localTripKey(2),
      JSON.stringify({ ...savedTrip(), mineVersion: undefined }),
    );
    expect(loadLocalTrip(2)).toBeNull();
    expect(localStorage.removeItem).toHaveBeenCalledWith(localTripKey(2));

    localStorage.setItem(
      localTripKey(3),
      JSON.stringify(
        savedTrip({ moves: ["not-a-move"] as unknown as MineAction[] }),
      ),
    );
    expect(loadLocalTrip(3)).toBeNull();
    expect(localStorage.removeItem).toHaveBeenCalledWith(localTripKey(3));
  });

  it("returns null for malformed JSON without removing the slot", () => {
    localStorage.setItem(localTripKey(1), "{broken");

    expect(loadLocalTrip(1)).toBeNull();
    expect(localStorage.getItem(localTripKey(1))).toBe("{broken");
  });

  it("normalizes legacy saved gear on load", () => {
    saveLocalTrip(
      1,
      savedTrip({
        gear: {
          pickaxe: 1,
          lamp: 3,
          cargo: 1,
          lantern: 1,
          elevator: 0,
          warpcoil: 1,
        } as unknown as SavedTrip["gear"],
      }),
    );

    expect(loadLocalTrip(1)?.gear.battery).toBe(3);
    expect(loadLocalTrip(1)?.gear.blast).toBe(1);
  });

  it("replays non-terminal moves and keeps pending bunker state", () => {
    const seed = 333;
    const mine = createMine(seed, DEFAULT_GEAR, STARTING_CONSUMABLES);
    setCell(mine, START_COL, 1, { kind: "empty", ladder: true });
    const baseDiff = exportDiff(mine);
    const moves = ["down", "right"] as MineAction[];
    const expected = createMine(
      seed,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      baseDiff,
    );
    for (const move of moves) applyAction(expected, move);
    const pendingBunker = {
      claimCol: START_COL,
      claimRow: 5,
      claimedAtMoveCount: 1,
      bunker: createBunker({ col: START_COL - 3, row: 1, width: 7, height: 5 }),
      inventory: { ...STARTER_BASE_PART_INVENTORY },
    };

    const replay = replaySavedTrip(
      savedTrip({
        seed,
        consumables: STARTING_CONSUMABLES,
        baseDiff,
        moves,
        pendingBunker,
      }),
      baseDiff,
    );

    expect(replay.moves).toEqual(moves);
    expect(replay.mine.miner.row).toBe(expected.miner.row);
    expect(replay.mine.miner.col).toBe(expected.miner.col);
    expect(replay.pendingBunker).toEqual(pendingBunker);
    expect(replay.terminalReplayCollapsed).toBe(false);
  });

  it("clears pending bunker state for terminal replays", () => {
    const seed = 6161;
    const mine = createMine(seed, DEFAULT_GEAR, STARTING_CONSUMABLES);
    for (let row = 1; row <= 6; row++) {
      setCell(mine, START_COL, row, { kind: "empty" });
    }
    setCell(mine, START_COL, 7, { kind: "dirt" });
    const baseDiff = exportDiff(mine);

    const replay = replaySavedTrip(
      savedTrip({
        seed,
        consumables: STARTING_CONSUMABLES,
        baseDiff,
        moves: ["down"] as MineAction[],
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
        terminalReplayConsumed: true,
      }),
      baseDiff,
    );

    expect(replay.pendingBunker).toBeNull();
    expect(replay.terminalReplayCollapsed).toBe(true);
    expect(replay.terminalReplayConsumed).toBe(true);
  });

  it("removes slot trips through the persistence boundary", () => {
    saveLocalTrip(1, savedTrip());
    removeLocalTrip(1);

    expect(localStorage.removeItem).toHaveBeenCalledWith(localTripKey(1));
    expect(loadLocalTrip(1)).toBeNull();
  });
});

describe("pending bunker depth normalization", () => {
  it("normalizes pre-depth pendingBunker saves onto the tunnel plane", () => {
    const bunker = createBunker({ col: 1, row: 4, width: 7, height: 5 });
    const legacyPending = {
      claimCol: 4,
      claimRow: 8,
      claimedAtMoveCount: 0,
      bunker: {
        footprint: bunker.footprint,
        core: {
          col: bunker.core.col,
          row: bunker.core.row,
          durability: bunker.core.durability,
        },
        parts: [
          { partId: "wall-panel", col: 2, row: 5, durability: 90 },
          { partId: "door-panel", col: 3, row: 5, depth: 9, durability: 60 },
        ],
      },
      inventory: STARTER_BASE_PART_INVENTORY,
    } as unknown as PendingBunkerBuild;
    localStorage.setItem(
      localTripKey(1),
      JSON.stringify(savedTripWithPending(legacyPending)),
    );

    const loaded = loadLocalTrip(1);

    expect(loaded?.pendingBunker?.bunker.core.depth).toBe(0);
    expect(loaded?.pendingBunker?.bunker.parts).toEqual([
      { partId: "wall-panel", col: 2, row: 5, depth: 0, durability: 90 },
      { partId: "door-panel", col: 3, row: 5, depth: 0, durability: 60 },
    ]);
    expect(loaded?.pendingBunker?.bunker.dug).toEqual([]);
  });
});

function savedTripWithPending(pending: PendingBunkerBuild): SavedTrip {
  return {
    mineVersion: MINE_VERSION,
    seed: 123,
    tripIndex: 2,
    gear: DEFAULT_GEAR,
    consumables: NO_CONSUMABLES,
    baseDiff: [],
    moves: ["down"] as MineAction[],
    pendingBunker: pending,
  };
}
