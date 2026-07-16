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
  anyRailResyncBlock,
  loadLocalTrip,
  loadRailResyncBlock,
  localTripKey,
  normalizePendingBunker,
  removeLocalTrip,
  replaySavedTrip,
  type SavedTrip,
  saveLocalTrip,
  saveRailResyncBlock,
  storedTripPendingBunkerIsCorrupt,
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

  it("restores boarded choice and partial elevator travel in either direction", () => {
    const gear = {
      ...DEFAULT_GEAR,
      elevator: 20,
      elevatorColumn: START_COL,
    };
    const mine = createMine(444, gear, STARTING_CONSUMABLES);
    for (let row = 1; row <= gear.elevator; row++) {
      setCell(mine, START_COL, row, { kind: "empty" });
    }
    const baseDiff = exportDiff(mine);

    const boarded = replaySavedTrip(
      savedTrip({
        seed: 444,
        gear,
        consumables: STARTING_CONSUMABLES,
        baseDiff,
        moves: ["down"] as MineAction[],
      }),
      baseDiff,
    );
    expect(boarded.mine.miner.row).toBe(0);
    expect(boarded.mine.elevatorPhase).toBe("boarded");
    expect(boarded.resumeElevatorDirection).toBeNull();

    const midwayDown = replaySavedTrip(
      savedTrip({
        seed: 444,
        gear,
        consumables: STARTING_CONSUMABLES,
        baseDiff,
        moves: ["down", "ride-down"] as MineAction[],
      }),
      baseDiff,
    );
    expect(midwayDown.mine.miner.row).toBe(6);
    expect(midwayDown.mine.elevatorPhase).toBe("riding-down");
    expect(midwayDown.resumeElevatorDirection).toBe("ride-down");

    const downToBottom = [
      "down",
      "ride-down",
      "ride-down",
      "ride-down",
      "ride-down",
    ] as MineAction[];
    const bottom = replaySavedTrip(
      savedTrip({
        seed: 444,
        gear,
        consumables: STARTING_CONSUMABLES,
        baseDiff,
        moves: downToBottom,
      }),
      baseDiff,
    );
    expect(bottom.mine.miner.row).toBe(20);
    expect(bottom.mine.elevatorPhase).toBe("boarded");
    expect(bottom.resumeElevatorDirection).toBeNull();

    const midwayUp = replaySavedTrip(
      savedTrip({
        seed: 444,
        gear,
        consumables: STARTING_CONSUMABLES,
        baseDiff,
        moves: [...downToBottom, "ride-up"] as MineAction[],
      }),
      baseDiff,
    );
    expect(midwayUp.mine.miner.row).toBe(14);
    expect(midwayUp.mine.elevatorPhase).toBe("riding-up");
    expect(midwayUp.resumeElevatorDirection).toBe("ride-up");

    const surface = replaySavedTrip(
      savedTrip({
        seed: 444,
        gear,
        consumables: STARTING_CONSUMABLES,
        baseDiff,
        moves: [
          ...downToBottom,
          "ride-up",
          "ride-up",
          "ride-up",
          "ride-up",
        ] as MineAction[],
      }),
      baseDiff,
    );
    expect(surface.mine.miner.row).toBe(0);
    expect(surface.mine.elevatorPhase).toBe("boarded");
    expect(surface.resumeElevatorDirection).toBeNull();
  });

  it("does not restore automatic travel from a failed elevator action", () => {
    const gear = {
      ...DEFAULT_GEAR,
      elevator: 20,
      elevatorColumn: START_COL,
    };

    const replay = replaySavedTrip(
      savedTrip({
        gear,
        moves: ["ride-down"] as MineAction[],
      }),
      [],
    );

    expect(replay.moves).toEqual([]);
    expect(replay.mine.elevatorPhase).toBe("idle");
    expect(replay.resumeElevatorDirection).toBeNull();
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
    expect(replay.mine.elevatorPhase).toBe("idle");
    expect(replay.resumeElevatorDirection).toBeNull();
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

    expect(loaded?.pendingBunker?.bunker.parts).toEqual([
      { partId: "wall-panel", col: 2, row: 5, depth: 0, durability: 90 },
      { partId: "door-panel", col: 3, row: 5, depth: 0, durability: 60 },
    ]);
    // A pre-dig-out save has no dug set; load seeds the spawn pocket
    // (F-115), which is exactly what a fresh createBunker ships.
    expect(loaded?.pendingBunker?.bunker.dug).toEqual(bunker.dug);
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

describe("pending bunker validation (F-112)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const local = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => local.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => local.set(key, value)),
      removeItem: vi.fn((key: string) => local.delete(key)),
    });
  });

  function validPending(): PendingBunkerBuild {
    return {
      claimCol: START_COL,
      claimRow: 5,
      claimedAtMoveCount: 0,
      bunker: createBunker({ col: START_COL - 3, row: 1, width: 7, height: 5 }),
      inventory: { ...STARTER_BASE_PART_INVENTORY },
    };
  }

  function withBunker(patch: Record<string, unknown>): unknown {
    const valid = validPending();
    return { ...valid, bunker: { ...valid.bunker, ...patch } };
  }

  it("returns null for a null part instead of throwing", () => {
    const malformed = withBunker({ parts: [null] });
    expect(() => normalizePendingBunker(malformed)).not.toThrow();
    expect(normalizePendingBunker(malformed)).toBeNull();
  });

  it("returns null for non-array parts", () => {
    expect(normalizePendingBunker(withBunker({ parts: {} }))).toBeNull();
  });

  it("strips a legacy core field from a stored checkpoint (F-118)", () => {
    // A checkpoint saved before the core was removed still carries one; the
    // object schema drops the unknown key rather than rejecting the trip.
    const result = normalizePendingBunker(
      withBunker({ core: { col: 3, row: 3, depth: 0, durability: 160 } }),
    );
    expect(result).not.toBeNull();
    expect(result?.bunker).not.toHaveProperty("core");
    expect(result?.bunker.footprint).toBeDefined();
    expect(Array.isArray(result?.bunker.parts)).toBe(true);
  });

  it("returns null for a malformed dug cell", () => {
    expect(normalizePendingBunker(withBunker({ dug: [null] }))).toBeNull();
    // Missing depth: dug cells always carry a real depth, so this is corruption.
    expect(
      normalizePendingBunker(withBunker({ dug: [{ col: 1, row: 1 }] })),
    ).toBeNull();
  });

  it("caps the checkpoint parts array at the 175-cell volume, not the old 174", () => {
    // Checkpoint validation only bounds shape and array length (the bank
    // route is the authoritative placement/occupancy boundary; see its
    // "maxed 175-part bunker" test). This proves the length cap moved off
    // 174 to the full 5 x 5 x 7 = 175-cell volume now the core is gone.
    const uniqueParts = [];
    for (let depth = 0; depth < 5; depth++) {
      for (let row = 1; row <= 5; row++) {
        for (let col = 1; col <= 7; col++) {
          uniqueParts.push({
            partId: "wall-panel",
            col,
            row,
            depth,
            durability: 10,
          });
        }
      }
    }
    expect(uniqueParts).toHaveLength(175);
    const accepted = normalizePendingBunker(withBunker({ parts: uniqueParts }));
    expect(accepted).not.toBeNull();
    expect(accepted?.bunker.parts).toHaveLength(175);
    // A 176th part (one cell repeated) exceeds the volume and is rejected.
    expect(
      normalizePendingBunker(
        withBunker({ parts: [...uniqueParts, uniqueParts[0]] }),
      ),
    ).toBeNull();
  });

  it("passes a null pending through as no checkpoint", () => {
    expect(normalizePendingBunker(null)).toBeNull();
    expect(normalizePendingBunker(undefined)).toBeNull();
  });

  it("accepts a valid pending bunker and seeds the spawn pocket", () => {
    const valid = validPending();
    const normalized = normalizePendingBunker(valid);
    expect(normalized).not.toBeNull();
    expect(normalized?.bunker.dug).toEqual(valid.bunker.dug);
  });

  it("drops a stored trip whose pending bunker is malformed", () => {
    const malformed = withBunker({ parts: [null] });
    localStorage.setItem(
      localTripKey(1),
      JSON.stringify(savedTripWithPending(malformed as PendingBunkerBuild)),
    );
    // The corrupt checkpoint is flagged for the fresh-start notice.
    expect(storedTripPendingBunkerIsCorrupt(1)).toBe(true);
    // Rejects (no crash) and clears the unusable blob so it cannot nag.
    expect(loadLocalTrip(1)).toBeNull();
    expect(localStorage.getItem(localTripKey(1))).toBeNull();
  });

  it("keeps loading a stored trip whose pending bunker is valid", () => {
    localStorage.setItem(
      localTripKey(1),
      JSON.stringify(savedTripWithPending(validPending())),
    );
    expect(storedTripPendingBunkerIsCorrupt(1)).toBe(false);
    expect(loadLocalTrip(1)?.pendingBunker).not.toBeNull();
  });

  it("does not flag a version mismatch as a corrupt checkpoint", () => {
    // A routine version bump is expected, not corruption: it must not trigger
    // the fresh-start notice (F-112 scope).
    const stale = savedTripWithPending(validPending());
    localStorage.setItem(
      localTripKey(1),
      JSON.stringify({ ...stale, mineVersion: MINE_VERSION - 1 }),
    );
    expect(storedTripPendingBunkerIsCorrupt(1)).toBe(false);
    expect(loadLocalTrip(1)).toBeNull();
  });

  it("coerces an unknown skin to the default instead of rejecting the trip", () => {
    const skinned = withBunker({ skin: "future-skin" });
    const normalized = normalizePendingBunker(skinned);
    expect(normalized).not.toBeNull();
    expect(normalized?.bunker.skin).toBeUndefined();
  });

  it("round-trips the rail-resync block per slot", () => {
    expect(loadRailResyncBlock(1)).toBe(false);

    saveRailResyncBlock(1, true);
    expect(loadRailResyncBlock(1)).toBe(true);
    // The block is scoped to its own slot only.
    expect(loadRailResyncBlock(2)).toBe(false);

    saveRailResyncBlock(1, false);
    expect(loadRailResyncBlock(1)).toBe(false);
    expect(localStorage.removeItem).toHaveBeenCalledWith(
      "vibebots-rail-resync-blocked-slot-1",
    );
  });

  it('treats any non-"1" stored rail-block value as unblocked', () => {
    localStorage.setItem("vibebots-rail-resync-blocked-slot-3", "true");
    expect(loadRailResyncBlock(3)).toBe(false);
  });

  it("reports a block on ANY slot for the unresolved-slot fail-closed check", () => {
    expect(anyRailResyncBlock()).toBe(false);
    // A block on a slot other than the assumed active one still trips it.
    saveRailResyncBlock(2, true);
    expect(anyRailResyncBlock()).toBe(true);
    saveRailResyncBlock(2, false);
    expect(anyRailResyncBlock()).toBe(false);
  });
});
