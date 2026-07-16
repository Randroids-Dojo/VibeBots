import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAchievementProgress } from "@/server/achievements";
import { db, storageConfigured } from "@/server/db";
import {
  BASE_PART_CATALOG,
  createBunker,
  proposedBunkerFootprint,
  STARTER_BASE_PART_INVENTORY,
} from "@/sim/bunker";
import { bunkerSpawnPocketCells } from "@/sim/bunker-blocks";
import {
  createMine,
  DEFAULT_GEAR,
  exportDiff,
  MINE_VERSION,
  type MineConsumables,
  NO_CONSUMABLES,
  START_COL,
  STARTING_CONSUMABLES,
  setCell,
} from "@/sim/mine";
import {
  achievementProgressForTrip,
  cashOutRequestSummary,
  chargeableConsumables,
  gearOwnershipError,
  POST,
  paidConsumableSnapshotExceedsOwned,
  replayConsumablesForCashOut,
  validatePendingBunkerClaim,
} from "./route";

vi.mock("@/server/db", () => ({
  db: vi.fn(),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/achievements", () => ({
  applyAchievementProgress: vi.fn(async () => []),
}));

vi.mock("@/server/save-sync-push", () => ({
  pushEndpointHashFromRequest: vi.fn(() => null),
  queueSaveSyncPush: vi.fn(),
}));

vi.mock("@/server/balance-telemetry", () => ({
  recordBalanceEvent: vi.fn(async () => undefined),
}));

vi.mock("@/server/player", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/player")>();
  return {
    ...actual,
    currentPlayerId: vi.fn(async () => "player-1"),
    getOrCreatePlayerId: vi.fn(async () => "player-1"),
  };
});

const mockedDb = vi.mocked(db);
const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedApplyAchievementProgress = vi.mocked(applyAchievementProgress);
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let infoSpy: ReturnType<typeof vi.spyOn>;

const ownedBase = {
  pickaxe_level: 1,
  lamp_level: 1,
  cargo_level: 1,
  lantern_level: 1,
  warpcoil_level: 1,
  elevator_depth: 0,
  elevator_col: null,
  blast_level: 1,
  elevator_speed_level: 1,
  fall_level: 1,
  recall_level: 1,
  dynamite_count: 0,
  rope_count: 0,
  ladder_count: 0,
  plank_count: 0,
  beacon_count: 0,
  emeralds: 0,
  track_xp: 0,
  defense_xp: 0,
  deepest_depth: 0,
  support_kit_granted_at: "2026-06-17T00:00:00.000Z",
  elevator_support_refund_at: null,
  elevator_column_migrated_at: "2026-07-13T00:00:00.000Z",
  elevator_rail_installed_at: "2026-07-14T00:00:00.000Z",
  elevator_placement_chosen_at: "2026-07-14T00:00:00.000Z",
  legacy_support_snapshot_reconciled_at: "2026-06-17T00:00:00.000Z",
  dynamite_tier_unlock_reset_at: "2026-06-18T00:00:00.000Z",
};

const stock = (overrides: Partial<MineConsumables> = {}): MineConsumables => ({
  ...NO_CONSUMABLES,
  ...overrides,
});

function pendingBunkerBaseDiff(blocked = false) {
  const mine = createMine(123, DEFAULT_GEAR, STARTING_CONSUMABLES);
  for (let row = 1; row <= 5; row++) {
    for (let col = START_COL - 3; col <= START_COL + 3; col++) {
      setCell(mine, col, row, { kind: "empty" });
    }
  }
  if (blocked) setCell(mine, START_COL - 3, 5, { kind: "dirt" });
  return exportDiff(mine);
}

function post(overrides: Record<string, unknown> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/mine/bank", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seed: 123,
        tripIndex: 0,
        moves: ["down"],
        mineVersion: MINE_VERSION,
        gear: DEFAULT_GEAR,
        consumables: STARTING_CONSUMABLES,
        ...overrides,
      }),
    }),
  );
}

function mockSql(
  owned: Record<string, unknown> = ownedBase,
  options: {
    seed?: number;
    diff?: unknown;
    tripCount?: number;
    atomicUpdate?: boolean;
    bunkerClaimed?: boolean;
    existingBunker?: boolean;
    bunkerFootprint?: {
      col: number;
      row: number;
      width: number;
      height: number;
    };
  } = {},
) {
  const worldSeed = options.seed ?? 123;
  const sql = vi.fn(async () => {
    const calls = sql.mock.calls as unknown as Array<[TemplateStringsArray]>;
    const strings = calls[calls.length - 1]?.[0];
    const query = strings?.join(" ") ?? "";
    if (query.includes("SELECT seed, diff, trip_count")) {
      return [
        {
          seed: worldSeed,
          diff: options.diff ?? [],
          trip_count: options.tripCount ?? 0,
        },
      ];
    }
    if (query.includes("SELECT pickaxe_level")) return [owned];
    if (query.includes("SELECT player_id") && query.includes("FROM bunkers")) {
      return options.existingBunker ? [{ player_id: "player-1" }] : [];
    }
    if (query.includes("SELECT footprint") && query.includes("FROM bunkers")) {
      return options.bunkerFootprint
        ? [{ footprint: options.bunkerFootprint }]
        : [];
    }
    if (
      query.includes("SELECT part_id, count") &&
      query.includes("FROM player_base_parts")
    ) {
      return Object.entries(STARTER_BASE_PART_INVENTORY).map(
        ([part_id, count]) => ({ part_id, count }),
      );
    }
    if (query.includes("support_kit_granted_at = now()")) {
      return [
        {
          ladder_count: 8,
          plank_count: 4,
          support_kit_granted_at: "2026-06-17T00:00:00.000Z",
          legacy_support_snapshot_reconciled_at: "2026-06-17T00:00:00.000Z",
        },
      ];
    }
    if (query.includes("WITH world AS") && options.atomicUpdate === false) {
      return [
        {
          emeralds: null,
          deepest_depth: null,
          dynamite_count: null,
          rope_count: null,
          ladder_count: null,
          plank_count: null,
          beacon_count: null,
          trip_count: null,
          bunker_claimed: null,
        },
      ];
    }
    return [
      {
        emeralds: 12,
        deepest_depth: 1,
        dynamite_count: owned.dynamite_count ?? 0,
        rope_count: owned.rope_count ?? 0,
        ladder_count: owned.ladder_count ?? 0,
        plank_count: owned.plank_count ?? 0,
        beacon_count: owned.beacon_count ?? 0,
        bonus: 0,
        trip_count: 1,
        bunker_claimed: options.bunkerClaimed === true,
      },
    ];
  });
  mockedDb.mockResolvedValue(sql as never);
  return sql;
}

describe("POST /api/mine/bank", () => {
  beforeEach(() => {
    mockedStorageConfigured.mockReturnValue(true);
    mockedDb.mockReset();
    mockedApplyAchievementProgress.mockClear();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("logs invalid JSON bodies before auth-bound route work", async () => {
    const res = await POST(
      new Request("http://localhost/api/mine/bank", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid JSON body",
    });
    expect(mockedDb).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(warnSpy.mock.calls[0][0]));
    expect(payload).toMatchObject({
      source: "vibebots",
      component: "mine.cash_out",
      event: "mine.cash_out.invalid_json_body",
      alert: true,
      severity: "warn",
      code: "invalid_json_body",
      detail: "request body could not be parsed as JSON",
    });
    expect(String(warnSpy.mock.calls[0][0])).not.toContain("player-1");
  });

  it("requires legacy elevator rail installation before cash-out", async () => {
    const sql = mockSql({
      ...ownedBase,
      elevator_depth: 4,
      elevator_col: -5,
      elevator_rail_installed_at: null,
    });

    const res = await post();

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "refresh the mine to finish elevator rail setup",
      code: "elevator_rail_migration_required",
    });
    const calls = sql.mock.calls as unknown as Array<[TemplateStringsArray]>;
    expect(
      calls.some(([strings]) =>
        strings.join(" ").includes("UPDATE mine_worlds"),
      ),
    ).toBe(false);
  });

  it("labels a stale world revision for the save-conflict flow", async () => {
    mockSql(ownedBase, { tripCount: 1 });

    const res = await post({ tripIndex: 0 });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "this trip was already cashed out; reload the mine",
      code: "trip_already_cashed_out",
    });
  });

  it("labels an atomic cash-out race for the save-conflict flow", async () => {
    mockSql(ownedBase, { atomicUpdate: false });

    const res = await post();

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "this trip was already cashed out",
      code: "trip_already_cashed_out",
    });
  });

  it("validates pending bunker parts stacked across depths", () => {
    // A pocket floor cell is open at depth 0; digging one layer past the
    // pocket (depth 3) opens a second buildable cell in the same column.
    const result = validatePendingBunkerClaim(
      {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: [{ col: START_COL - 1, row: 5, depth: 3 }],
        parts: [
          {
            partId: "wall-panel",
            col: START_COL - 1,
            row: 5,
            depth: 0,
            durability: BASE_PART_CATALOG["wall-panel"].durability,
          },
          {
            partId: "wall-panel",
            col: START_COL - 1,
            row: 5,
            depth: 3,
            durability: BASE_PART_CATALOG["wall-panel"].durability,
          },
        ],
      },
      123,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      pendingBunkerBaseDiff(),
      ["down", "down", "down", "down", "down"],
      STARTER_BASE_PART_INVENTORY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bunker.parts.map((part) => part.depth)).toEqual([0, 3]);
  });

  it("banks a fresh claim whose dug payload carries the whole spawn pocket", () => {
    // Regression: the client submits its entire dug set, which for a
    // fresh claim is exactly the pre-mined spawn pocket createBunker
    // opens (F-115). The validator must treat those pocket cells as
    // already open and skip them, not reject the whole cash-out with
    // "cannot excavate: open".
    const footprint = proposedBunkerFootprint(START_COL, 5);
    const result = validatePendingBunkerClaim(
      {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: createBunker(footprint).dug,
        parts: [],
      },
      123,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      pendingBunkerBaseDiff(),
      ["down", "down", "down", "down", "down"],
      STARTER_BASE_PART_INVENTORY,
    );

    expect(result.ok).toBe(true);
  });

  it("rejects pending dug chains that skip a connecting cell", () => {
    const result = validatePendingBunkerClaim(
      {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: [{ col: START_COL - 3, row: 1, depth: 2 }],
        parts: [],
      },
      123,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      pendingBunkerBaseDiff(),
      ["down", "down", "down", "down", "down"],
      STARTER_BASE_PART_INVENTORY,
    );

    expect(result).toEqual({
      ok: false,
      error: "cannot excavate: unreachable",
    });
  });

  it("rejects pending parts placed inside undug rock", () => {
    const result = validatePendingBunkerClaim(
      {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: [],
        parts: [
          {
            partId: "wall-panel",
            col: START_COL - 3,
            row: 1,
            depth: 1,
            durability: BASE_PART_CATALOG["wall-panel"].durability,
          },
        ],
      },
      123,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      pendingBunkerBaseDiff(),
      ["down", "down", "down", "down", "down"],
      STARTER_BASE_PART_INVENTORY,
    );

    expect(result).toEqual({
      ok: false,
      error: "cannot place bunker part: rock",
    });
  });

  it("rejects pending bunker parts outside the depth range", async () => {
    const res = await post({
      moves: ["down", "down", "down", "down", "down"],
      pendingBunker: {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        parts: [
          {
            partId: "wall-panel",
            col: START_COL - 3,
            row: 1,
            depth: 5,
            durability: BASE_PART_CATALOG["wall-panel"].durability,
          },
        ],
      },
    });

    expect(res.status).toBe(400);
    expect(mockedDb).not.toHaveBeenCalled();
  });

  it("rejects a pending bunker over the full-volume part cap (F-118: 175 cells)", async () => {
    const res = await post({
      moves: ["down", "down", "down", "down", "down"],
      pendingBunker: {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        // 176 exceeds the 7 x 5 x 5 = 175 cell volume that is now fully
        // buildable (the old cap of 174 reserved the removed core cell).
        parts: Array.from({ length: 176 }, () => ({
          partId: "wall-panel",
          col: START_COL - 3,
          row: 1,
          depth: 0,
          durability: BASE_PART_CATALOG["wall-panel"].durability,
        })),
      },
    });

    expect(res.status).toBe(400);
    expect(mockedDb).not.toHaveBeenCalled();
  });

  it("accepts a legitimately maxed 175-part bunker at the bank boundary (F-118)", () => {
    // A part in every cell of the 7 x 5 x 5 volume, only possible now the
    // core no longer reserves the center cell. Build a valid dig order by
    // flood-filling out from the pre-mined spawn pocket (each dig must be
    // face-adjacent to an already-open cell), then a wall in every cell.
    const footprint = { col: START_COL - 3, row: 1, width: 7, height: 5 };
    const key = (c: number, r: number, d: number) => `${c},${r},${d}`;
    const open = new Set(
      bunkerSpawnPocketCells(footprint).map((c) => key(c.col, c.row, c.depth)),
    );
    const allCells: Array<{ col: number; row: number; depth: number }> = [];
    for (let depth = 0; depth < 5; depth++) {
      for (let row = footprint.row; row < footprint.row + 5; row++) {
        for (let col = footprint.col; col < footprint.col + 7; col++) {
          allCells.push({ col, row, depth });
        }
      }
    }
    const dug: Array<{ col: number; row: number; depth: number }> = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const cell of allCells) {
        const k = key(cell.col, cell.row, cell.depth);
        if (open.has(k)) continue;
        const adjacentToOpen = [
          [cell.col - 1, cell.row, cell.depth],
          [cell.col + 1, cell.row, cell.depth],
          [cell.col, cell.row - 1, cell.depth],
          [cell.col, cell.row + 1, cell.depth],
          [cell.col, cell.row, cell.depth - 1],
          [cell.col, cell.row, cell.depth + 1],
        ].some(([c, r, d]) => open.has(key(c, r, d)));
        if (adjacentToOpen) {
          open.add(k);
          dug.push(cell);
          progressed = true;
        }
      }
    }
    expect(open.size).toBe(175);
    const parts = allCells.map((cell) => ({
      partId: "wall-panel" as const,
      col: cell.col,
      row: cell.row,
      depth: cell.depth,
      durability: BASE_PART_CATALOG["wall-panel"].durability,
    }));

    const result = validatePendingBunkerClaim(
      { claimCol: START_COL, claimRow: 5, claimedAtMoveCount: 5, dug, parts },
      123,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      pendingBunkerBaseDiff(),
      ["down", "down", "down", "down", "down"],
      { ...STARTER_BASE_PART_INVENTORY, "wall-panel": 175 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bunker.parts).toHaveLength(175);
  });

  it("validates a locally claimed bunker against the replayed claim moment", () => {
    const result = validatePendingBunkerClaim(
      {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: [],
        parts: [
          {
            partId: "wall-panel",
            col: START_COL - 1,
            row: 5,
            depth: 0,
            durability: BASE_PART_CATALOG["wall-panel"].durability,
          },
        ],
      },
      123,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      pendingBunkerBaseDiff(),
      ["down", "down", "down", "down", "down"],
      STARTER_BASE_PART_INVENTORY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bunker.footprint).toMatchObject({
      col: START_COL - 3,
      row: 1,
      width: 7,
      height: 5,
    });
    expect(result.inventory["wall-panel"]).toBe(5);
  });

  it("rejects pending bunkers that were not clear when claimed", () => {
    const result = validatePendingBunkerClaim(
      {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: [],
        parts: [],
      },
      123,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      pendingBunkerBaseDiff(true),
      ["down", "down", "down", "down", "down"],
      STARTER_BASE_PART_INVENTORY,
    );

    expect(result).toEqual({
      ok: false,
      error: "clear the full 7x5 claim first",
    });
  });

  it("rejects pending bunker parts that exceed server-owned stock", () => {
    const result = validatePendingBunkerClaim(
      {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: [],
        parts: [
          {
            partId: "door-panel",
            col: START_COL - 1,
            row: 5,
            depth: 0,
            durability: BASE_PART_CATALOG["door-panel"].durability,
          },
          {
            partId: "door-panel",
            col: START_COL,
            row: 5,
            depth: 0,
            durability: BASE_PART_CATALOG["door-panel"].durability,
          },
        ],
      },
      123,
      DEFAULT_GEAR,
      STARTING_CONSUMABLES,
      pendingBunkerBaseDiff(),
      ["down", "down", "down", "down", "down"],
      STARTER_BASE_PART_INVENTORY,
    );

    expect(result).toEqual({
      ok: false,
      error: "cannot place bunker part: stock",
    });
  });

  it("persists a valid pending bunker during cash-out", async () => {
    const sql = mockSql(ownedBase, {
      diff: pendingBunkerBaseDiff(),
      bunkerClaimed: true,
    });

    const res = await post({
      moves: ["down", "down", "down", "down", "down"],
      pendingBunker: {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        dug: [{ col: START_COL - 1, row: 5, depth: 3 }],
        parts: [
          {
            partId: "wall-panel",
            col: START_COL - 1,
            row: 5,
            durability: BASE_PART_CATALOG["wall-panel"].durability,
          },
        ],
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      bunkerClaimed: true,
      tripIndex: 1,
    });
    const queries = (
      sql.mock.calls as unknown as Array<[TemplateStringsArray]>
    ).map(([strings]) => strings.join(" "));
    expect(queries.some((query) => query.includes("INSERT INTO bunkers"))).toBe(
      true,
    );
    expect(
      queries.some((query) => query.includes("INSERT INTO player_base_parts")),
    ).toBe(true);
    // Groundbreaker is backfill-only: cells dug before banking surface
    // through the durable bunkers.dug backfill inside
    // applyAchievementProgress, never through the bank patch (so a
    // dig-then-claim run can never count the same cells twice).
    expect(mockedApplyAchievementProgress).toHaveBeenCalledWith(
      expect.anything(),
      "player-1",
      expect.not.objectContaining({ bunkerCellsDug: expect.anything() }),
    );
  });

  it("replays scaffold movement only after the pending claim checkpoint", async () => {
    mockSql(ownedBase, {
      diff: pendingBunkerBaseDiff(),
      bunkerClaimed: true,
    });

    const res = await post({
      moves: ["down", "down", "down", "down", "down", "bunker-scaffold-up"],
      pendingBunker: {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        parts: [],
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      bunkerClaimed: true,
      tripIndex: 1,
    });
  });

  it("rejects scaffold movement without an authoritative bunker claim", async () => {
    mockSql(ownedBase, { diff: pendingBunkerBaseDiff() });

    const res = await post({
      moves: ["down", "down", "down", "down", "down", "bunker-scaffold-up"],
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "bunker scaffold requires a claimed bunker",
    });
  });

  it("rejects duplicate pending bunker claims before granting starter parts", async () => {
    const sql = mockSql(ownedBase, {
      diff: pendingBunkerBaseDiff(),
      existingBunker: true,
    });

    const res = await post({
      moves: ["down", "down", "down", "down", "down"],
      pendingBunker: {
        claimCol: START_COL,
        claimRow: 5,
        claimedAtMoveCount: 5,
        parts: [],
      },
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "bunker already claimed",
    });
    const queries = (
      sql.mock.calls as unknown as Array<[TemplateStringsArray]>
    ).map(([strings]) => strings.join(" "));
    expect(
      queries.some((query) => query.includes("INSERT INTO player_base_parts")),
    ).toBe(false);
  });

  it("logs request-shape failures with safe cash-out context", async () => {
    const res = await post({
      moves: [],
      mineVersion: "29",
      // A sentinel shaft column that must never survive into the serialized
      // validation event (F-121).
      gear: { ...DEFAULT_GEAR, pickaxe: 99, elevatorColumn: 4242 },
      consumables: { ...STARTING_CONSUMABLES, rope: "22" },
    });

    expect(res.status).toBe(400);
    expect(mockedDb).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const raw = String(warnSpy.mock.calls[0][0]);
    const payload = JSON.parse(raw);
    expect(payload).toMatchObject({
      source: "vibebots",
      component: "mine.cash_out",
      event: "mine.cash_out.request_validation_failed",
      alert: true,
      severity: "warn",
      code: "request_validation_failed",
      request: {
        bodyType: "object",
        seed: 123,
        tripIndex: 0,
        mineVersionType: "string",
        moveCount: 0,
        movesType: "array",
        gear: { pickaxe: 99 },
        consumables: { rope: { type: "string" } },
      },
    });
    expect(payload.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "moves" }),
        expect.objectContaining({ path: "mineVersion" }),
        expect.objectContaining({ path: "gear.pickaxe" }),
        expect.objectContaining({ path: "consumables.rope" }),
      ]),
    );
    // The submitted shaft column is stripped from the serialized event (F-121).
    expect(payload.request.gear).not.toHaveProperty("elevatorColumn");
    expect(raw).not.toContain("4242");
    expect(raw).not.toContain("player-1");
    expect(raw).not.toContain("down");
  });

  it("logs a bounded per-level digest, not the full gear object, on gear_not_owned (F-121)", async () => {
    mockSql();
    // Overclaim a gear level so the ownership check rejects and emits the
    // gear_not_owned monitoring event.
    const res = await post({ gear: { ...DEFAULT_GEAR, pickaxe: 5 } });

    expect(res.status).toBe(422);
    const raw = errorSpy.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .find((line: string) => line.includes("gear_not_owned"));
    expect(raw).toBeDefined();
    const payload = JSON.parse(raw as string);
    expect(payload).toMatchObject({
      component: "mine.cash_out",
      event: "mine.cash_out.gear_not_owned",
      code: "gear_not_owned",
    });
    // The bounded per-level digest is logged, never the full gear object: a
    // full object would carry the elevatorColumn key (the shaft coordinate).
    expect(payload.submitted).not.toHaveProperty("elevatorColumn");
    expect(payload.submitted.pickaxe).toBe(5);
    expect(raw as string).not.toContain("elevatorColumn");
    // The rejection detail is bounded, never a coordinate.
    expect(payload.detail).toBe("gear not owned: pickaxe level 5");
  });

  it("logs mine-version mismatches with hashed existing player context", async () => {
    const res = await post({ mineVersion: MINE_VERSION - 1 });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "the mine has shifted since this trip started; start fresh",
      code: "mine_version_mismatch",
      expectedMineVersion: MINE_VERSION,
    });
    expect(mockedDb).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const raw = String(warnSpy.mock.calls[0][0]);
    const payload = JSON.parse(raw);
    expect(payload).toMatchObject({
      source: "vibebots",
      component: "mine.cash_out",
      event: "mine.cash_out.mine_version_mismatch",
      alert: true,
      severity: "warn",
      code: "mine_version_mismatch",
      tripIndex: 0,
      moveCount: 1,
      seed: 123,
      mineVersion: MINE_VERSION - 1,
      expectedMineVersion: MINE_VERSION,
    });
    expect(payload.player).toBeTruthy();
    expect(raw).not.toContain("player-1");
  });

  it("credits legacy support snapshots even when support stock is not owned", async () => {
    const sql = mockSql({
      ...ownedBase,
      support_kit_granted_at: "2026-06-17T00:00:00.000Z",
      legacy_support_snapshot_reconciled_at: null,
    });

    const res = await post({
      moves: ["down", "down", "down", "down", "up"],
      consumables: STARTING_CONSUMABLES,
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      balance: 12,
      tripIndex: 1,
    });
    expect(sql).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(warnSpy.mock.calls[0][0]));
    expect(payload).toMatchObject({
      source: "vibebots",
      component: "mine.cash_out",
      event: "mine.cash_out.legacy_support_reconciled",
      alert: true,
      severity: "warn",
      code: "legacy_support_reconciled",
      tripIndex: 0,
      moveCount: 5,
    });
    expect(String(warnSpy.mock.calls[0][0])).not.toContain("player-1");
  });

  it("does not charge a support erased by a newer owned rail", async () => {
    const sql = mockSql(
      {
        ...ownedBase,
        elevator_depth: 4,
        elevator_col: START_COL,
        ladder_count: 1,
      },
      {
        diff: [[START_COL, 4, { kind: "empty", ladder: true }]],
      },
    );

    const res = await post({
      moves: ["down", "collect-ladder", "ride-up"],
      gear: {
        ...DEFAULT_GEAR,
        elevator: 4,
        elevatorColumn: START_COL,
      },
      consumables: stock({ ladder: 1 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.credited.credits).toBe(0);
    for (let row = 1; row <= 4; row++) {
      expect(body.diff).toContainEqual([START_COL, row, { kind: "empty" }]);
    }
    const cashOutCall = (sql.mock.calls as unknown[][]).find((call) =>
      (call[0] as TemplateStringsArray).join(" ").includes("WITH world AS"),
    );
    expect(cashOutCall).toBeDefined();
    const strings = cashOutCall?.[0] as TemplateStringsArray;
    const ladderChargeIndex = strings.findIndex((part) =>
      part.includes("ladder_count = GREATEST(0, ladder_count -"),
    );
    expect(ladderChargeIndex).toBeGreaterThanOrEqual(0);
    expect(cashOutCall?.[ladderChargeIndex + 1]).toBe(0);
    expect(strings.join(" ")).toContain("elevator_depth =");
    expect(strings.join(" ")).toContain("elevator_col IS NOT DISTINCT FROM");
    expect(strings.join(" ")).toContain("AND diff =");
  });

  it("rejects stale paid consumable snapshots without owned stock", async () => {
    const sql = mockSql();

    const res = await post({
      moves: ["dynamite-1"],
      consumables: { ...STARTING_CONSUMABLES, dynamite: 1 },
    });

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "consumables not owned",
    });
    expect(sql).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errorSpy.mock.calls[0][0]))).toMatchObject({
      source: "vibebots",
      component: "mine.cash_out",
      event: "mine.cash_out.consumables_not_owned",
      alert: true,
      severity: "error",
      code: "consumables_not_owned",
      detail: "paid consumable overclaim",
      submitted: { dynamite: 1 },
      owned: { dynamite: 0 },
    });
  });

  it("ignores stale support snapshots after the legacy marker", async () => {
    const sql = mockSql({
      ...ownedBase,
      ladder_count: 13,
      plank_count: 4,
    });

    const res = await post({
      moves: ["down"],
      consumables: { ...NO_CONSUMABLES, ladder: 14, plank: 2 },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      balance: 12,
      tripIndex: 1,
    });
    expect(sql).toHaveBeenCalledTimes(3);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("caps legacy support snapshots above the starter floor", async () => {
    const sql = mockSql({
      ...ownedBase,
      legacy_support_snapshot_reconciled_at: null,
    });

    const res = await post({
      moves: ["down", "down", "down", "down", "up"],
      consumables: { ...STARTING_CONSUMABLES, ladder: 9 },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      balance: 12,
      tripIndex: 1,
    });
    expect(sql).toHaveBeenCalledTimes(3);
  });

  it("replays with server-owned consumables instead of the submitted snapshot", async () => {
    const sql = mockSql({ ...ownedBase, rope_count: 1 }, { seed: 5 });

    const res = await post({
      seed: 5,
      moves: [
        "down",
        "down",
        "down",
        "down",
        "down",
        "down",
        "down",
        "down",
        "down",
        "recall",
      ],
      consumables: NO_CONSUMABLES,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      credited: { credits: 7 },
      balance: 12,
      consumables: stock({ rope: 1 }),
      tripIndex: 1,
    });
    expect(body.credited.soldHaul).toMatchObject({
      totalVibes: 7,
      salvageCredits: 0,
    });
    const soldOres = body.credited.soldHaul.ores as Record<string, number>;
    expect(
      Object.values(soldOres).reduce((sum, count) => sum + count, 0),
    ).toBeGreaterThan(0);
    expect(sql).toHaveBeenCalledTimes(3);
  });

  it("accepts large legitimate support stock from long-running players", async () => {
    const owned = {
      ...ownedBase,
      dynamite_count: 34,
      rope_count: 22,
      ladder_count: 1018,
      plank_count: 206,
      beacon_count: 22,
    };
    const sql = mockSql(owned, { seed: 2155004236 });

    const res = await post({
      seed: 2155004236,
      moves: ["down"],
      consumables: stock({
        dynamite: 34,
        rope: 22,
        ladder: 1018,
        plank: 206,
        beacon: 22,
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      balance: 12,
      consumables: stock({
        dynamite: 34,
        rope: 22,
        ladder: 1018,
        plank: 206,
        beacon: 22,
      }),
      tripIndex: 1,
    });
    expect(sql).toHaveBeenCalledTimes(3);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const successPayload = JSON.parse(String(infoSpy.mock.calls[0][0]));
    expect(successPayload).toMatchObject({
      source: "vibebots",
      component: "mine.cash_out",
      event: "mine.cash_out.cash_out_succeeded",
      alert: false,
      severity: "info",
      code: "cash_out_succeeded",
      tripIndex: 0,
      moveCount: 1,
      seed: 2155004236,
      mineVersion: MINE_VERSION,
      charged: stock(),
      credited: { credits: 0, parts: 0 },
      remaining: stock({
        dynamite: 34,
        rope: 22,
        ladder: 1018,
        plank: 206,
        beacon: 22,
      }),
      worldTripIndex: 1,
    });
    expect(String(infoSpy.mock.calls[0][0])).not.toContain("player-1");
  });

  it("ignores manual bag drop actions that replay did not apply", async () => {
    const sql = mockSql(ownedBase, { seed: 3 });

    const res = await post({
      seed: 3,
      moves: ["down", "drop:coal:1"],
    });

    expect(res.status).toBe(200);
    expect(mockedApplyAchievementProgress).toHaveBeenCalledWith(
      sql,
      "player-1",
      expect.objectContaining({ bagDrops: 0 }),
    );
  });
});

describe("mine bank policy helpers", () => {
  it("flags gear snapshots above owned profile levels", () => {
    expect(gearOwnershipError({ ...DEFAULT_GEAR, pickaxe: 2 }, ownedBase)).toBe(
      "gear not owned: pickaxe level 2",
    );
    expect(gearOwnershipError({ ...DEFAULT_GEAR, recall: 2 }, ownedBase)).toBe(
      "gear not owned: recall level 2",
    );
    expect(
      gearOwnershipError({ ...DEFAULT_GEAR, elevatorSpeed: 2 }, ownedBase),
    ).toBe("gear not owned: elevator speed level 2");
    expect(gearOwnershipError({ ...DEFAULT_GEAR, fall: 2 }, ownedBase)).toBe(
      "gear not owned: fall harness level 2",
    );
    expect(gearOwnershipError(DEFAULT_GEAR, ownedBase)).toBeNull();
  });

  it("requires the submitted rail column to match the owned shaft", () => {
    const owned = {
      ...ownedBase,
      elevator_depth: 3,
      elevator_col: 27,
    };

    expect(
      gearOwnershipError(
        { ...DEFAULT_GEAR, elevator: 3, elevatorColumn: 27 },
        owned,
      ),
    ).toBeNull();
    // The error carries a bounded state, never the exact submitted column
    // (F-121): a disagreeing column is "mismatch".
    const mismatch = gearOwnershipError(
      { ...DEFAULT_GEAR, elevator: 3, elevatorColumn: 28 },
      owned,
    );
    expect(mismatch).toBe("rail not owned: column mismatch");
    expect(mismatch).not.toMatch(/\d/);
    expect(gearOwnershipError(DEFAULT_GEAR, owned)).toBeNull();
  });

  it("keeps the shaft column out of the cash-out request summary (F-121)", () => {
    // The validation summary and the gear_not_owned event both build their gear
    // digest through this helper, so a submitted elevatorColumn must never
    // survive into telemetry as a coordinate.
    const summary = cashOutRequestSummary({
      seed: 1,
      tripIndex: 0,
      mineVersion: MINE_VERSION,
      moves: ["down"],
      gear: { ...DEFAULT_GEAR, elevator: 4, elevatorColumn: 42 },
      consumables: NO_CONSUMABLES,
    });
    const gearSummary = summary.gear as Record<string, unknown>;
    expect(gearSummary).not.toHaveProperty("elevatorColumn");
    // The rail DEPTH is a bounded level and stays for validation debugging.
    expect(gearSummary.elevator).toBe(4);
    // No field anywhere in the summary retains the exact shaft column.
    expect(JSON.stringify(summary)).not.toContain("42");
  });

  it("accepts missing column data for a legacy fixed-column rail", () => {
    expect(
      gearOwnershipError(
        { ...DEFAULT_GEAR, elevator: 3, elevatorColumn: undefined },
        { ...ownedBase, elevator_depth: 3, elevator_col: null },
      ),
    ).toBeNull();
  });

  it("separates paid consumable ownership from support reconciliation", () => {
    expect(
      paidConsumableSnapshotExceedsOwned(
        stock({ ladder: 8, plank: 4 }),
        NO_CONSUMABLES,
      ),
    ).toBe(false);
    expect(
      paidConsumableSnapshotExceedsOwned(
        stock({ dynamite: 1 }),
        NO_CONSUMABLES,
      ),
    ).toBe(true);
  });

  it("caps one legacy support snapshot at the starter support floor", () => {
    expect(
      replayConsumablesForCashOut(stock({ ladder: 10, plank: 6 }), {
        ...ownedBase,
        legacy_support_snapshot_reconciled_at: null,
      }),
    ).toEqual({
      consumables: stock({ ladder: 8, plank: 4 }),
      usedLegacySupportSnapshot: true,
    });
    expect(
      replayConsumablesForCashOut(stock({ ladder: 8, plank: 4 }), ownedBase),
    ).toEqual({
      consumables: NO_CONSUMABLES,
      usedLegacySupportSnapshot: false,
    });
  });

  it("charges only paid support stock after death grants", () => {
    expect(
      chargeableConsumables({
        bankedCredits: 0,
        bankedParts: [],
        maxDepth: 0,
        moves: 0,
        bagDrops: 0,
        elevatorRides: 0,
        roofRescues: 0,
        collapsesSurvived: 0,
        used: stock({ dynamite: 1, rope: 1, ladder: 7, plank: 5, beacon: 1 }),
        granted: stock({ ladder: 3, plank: 2 }),
        diff: [],
      }),
    ).toEqual(stock({ dynamite: 1, rope: 1, ladder: 4, plank: 3, beacon: 1 }));
  });

  it("counts replayed bag drop actions for achievement progress", () => {
    expect(
      achievementProgressForTrip(
        {
          bankedCredits: 0,
          bankedParts: [],
          maxDepth: 1,
          moves: 3,
          bagDrops: 2,
          elevatorRides: 1,
          roofRescues: 1,
          collapsesSurvived: 1,
          used: stock(),
          granted: stock(),
          diff: [],
        },
        ["down", "drop:coal:1", "drop:copper:2"],
      ),
    ).toMatchObject({
      bagDrops: 2,
      elevatorRides: 1,
      roofRescues: 1,
      collapsesSurvived: 1,
    });
  });

  it("ignores submitted bag drop actions that replay did not apply", () => {
    expect(
      achievementProgressForTrip(
        {
          bankedCredits: 0,
          bankedParts: [],
          maxDepth: 1,
          moves: 2,
          bagDrops: 0,
          elevatorRides: 0,
          roofRescues: 0,
          collapsesSurvived: 0,
          used: stock(),
          granted: stock(),
          diff: [],
        },
        ["down", "drop:coal:1"],
      ),
    ).toMatchObject({ bagDrops: 0 });
  });
});
