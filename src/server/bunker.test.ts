import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUNKER_LAYOUT_VERSION,
  type BunkerFootprint,
  type BunkerState,
  bunkerCells,
  proposedBunkerFootprint,
} from "@/sim/bunker";
import {
  bunkerCellBlock,
  bunkerSpawnPocketCells,
  deriveBunkerBlockSeed,
} from "@/sim/bunker-blocks";
import { BUNKER_RAID_LIVE_VERSION } from "@/sim/bunker-raid-live";
import { applyAchievementProgress } from "./achievements";
import {
  buyBasePart,
  claimBunker,
  collectBunkerLoot,
  excavateBunker,
  loadBunkerView,
  moveBunkerPart,
  placeBunkerPart,
  removeBunkerPart,
  repairBunker,
  resetBunker,
  setBunkerSkin,
  startFreshBunker,
} from "./bunker";

/** An ore cell plus a face-adjacent in-footprint cell to pre-open, so an
 * excavation test can chain the dig from an open neighbor. */
function oreCellWithOpenNeighbor(
  footprint: BunkerFootprint,
  blockSeed: number,
): {
  ore: { col: number; row: number; depth: number };
  open: { col: number; row: number; depth: number };
} | null {
  const bottomRow = footprint.row + footprint.height - 1;
  for (let depth = 1; depth < 5; depth++) {
    for (let y = 0; y < footprint.height; y++) {
      for (let x = 0; x < footprint.width; x++) {
        if (bunkerCellBlock(blockSeed, footprint, x, y, depth).kind !== "ore") {
          continue;
        }
        // The cell one step toward the plane (depth-1) is always in the
        // footprint and can be the open face this dig chains from.
        return {
          ore: { col: footprint.col + x, row: bottomRow - y, depth },
          open: {
            col: footprint.col + x,
            row: bottomRow - y,
            depth: depth - 1,
          },
        };
      }
    }
  }
  return null;
}

vi.mock("./balance-telemetry", () => ({
  recordBalanceEvent: vi.fn(async () => undefined),
}));

function makeBuySql({
  trackXp = 0,
  defenseXp = 0,
  inventoryRows = [],
  parts = [],
}: {
  trackXp?: number;
  defenseXp?: number;
  inventoryRows?: Array<{ part_id: string; count: number }>;
  parts?: unknown[];
}) {
  return vi.fn(async (strings: TemplateStringsArray) => {
    const query = strings.join(" ");
    if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
      return [{ emeralds: 200, track_xp: trackXp, defense_xp: defenseXp }];
    }
    if (query.includes("SELECT footprint, parts")) {
      return [
        {
          footprint: { col: 1, row: 1, width: 7, height: 5 },
          parts,
        },
      ];
    }
    if (query.includes("SELECT snapshot")) return [];
    if (query.includes("SELECT part_id, count")) return inventoryRows;
    if (query.includes("UPDATE players")) return [{ id: "player-1" }];
    if (query.includes("INSERT INTO player_base_parts")) return [];
    return [];
  });
}

vi.mock("./achievements", () => ({
  applyAchievementProgress: vi.fn(async () => []),
}));

describe("bunker server helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(applyAchievementProgress).mockClear();
  });

  it("adds missing starter base parts once for existing base inventories", async () => {
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ..._values: unknown[]) => {
        const query = strings.join(" ");
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds: 30, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("SELECT footprint, parts")) return [];
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) {
          return [
            { part_id: "wall-panel", count: 1 },
            { part_id: "door-panel", count: 1 },
          ];
        }
        if (query.includes("INSERT INTO player_base_parts")) return [];
        return [];
      },
    );

    const view = await loadBunkerView(sql as never, "player-1");

    expect(view.inventory).toMatchObject({
      "wall-panel": 1,
      "floor-panel": 4,
      "roof-panel": 4,
      "door-panel": 1,
      "basic-turret": 0,
      "floor-spikes": 0,
      "stair-panel": 2,
    });
    const insertedParts = sql.mock.calls
      .filter(([strings]) =>
        strings.join(" ").includes("INSERT INTO player_base_parts"),
      )
      .map((call) => call[2]);
    expect(insertedParts).toEqual(["floor-panel", "roof-panel", "stair-panel"]);
  });

  it("requires the full footprint, including side cells on the miner row", async () => {
    const footprint = proposedBunkerFootprint(10, 8);
    const blockedCell = {
      col: footprint.col,
      row: footprint.row + footprint.height - 1,
    };
    const diff = bunkerCells(footprint)
      .filter(
        (cell) => cell.col !== blockedCell.col || cell.row !== blockedCell.row,
      )
      .map((cell) => [cell.col, cell.row, { kind: "empty" }] as const);
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT player_id")) return [];
      if (query.includes("SELECT seed, diff")) return [{ seed: 123, diff }];
      if (query.includes("INSERT INTO bunkers")) {
        throw new Error("claim should not insert");
      }
      return [];
    });

    const result = await claimBunker(sql as never, "player-1", 10, 8);

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "clear the full 7x5 claim first",
    });
  });

  it("repairs the bunker for vibes and rejects an unaffordable repair", async () => {
    const footprint = { col: 1, row: 1, width: 7, height: 5 };
    const damagedParts = [
      { partId: "wall-panel", col: 3, row: 3, durability: 45 },
    ];
    const makeSql = (emeralds: number) =>
      vi.fn(async (strings: TemplateStringsArray) => {
        const query = strings.join(" ");
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("UPDATE players SET emeralds")) {
          // Guarded debit: only returns a row when the player can afford it.
          return emeralds >= 7 ? [{ emeralds: emeralds - 7 }] : [];
        }
        if (query.includes("SELECT footprint, parts")) {
          return [
            {
              footprint,
              parts: damagedParts,
              layout_version: BUNKER_LAYOUT_VERSION,
            },
          ];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) return [];
        if (query.includes("SELECT seed, diff")) return [{ seed: 5, diff: [] }];
        return [];
      });

    const broke = await repairBunker(makeSql(1) as never, "player-1");
    expect(broke.ok).toBe(false);
    if (!broke.ok) expect(broke.error).toContain("repairs cost");

    const rich = makeSql(100);
    const result = await repairBunker(rich as never, "player-1");
    expect(result.ok).toBe(true);
    const queries = rich.mock.calls.map((call) =>
      (call[0] as TemplateStringsArray).join(" "),
    );
    expect(queries.some((q) => q.includes("UPDATE players SET emeralds"))).toBe(
      true,
    );
    // The persisted bunker carries the restored durabilities, not just any
    // UPDATE: inspect the parts JSON bound into the UPDATE bunkers call.
    const updateCall = rich.mock.calls.find((call) =>
      (call[0] as TemplateStringsArray).join(" ").includes("UPDATE bunkers"),
    );
    expect(updateCall).toBeDefined();
    const bound = ((updateCall ?? []) as unknown[])
      .slice(1)
      .filter((value): value is string => typeof value === "string");
    const partsJson = bound.find((value) => value.includes('"partId"'));
    expect(partsJson).toBeDefined();
    expect(
      JSON.parse(partsJson ?? "[]").map(
        (part: { durability: number }) => part.durability,
      ),
    ).toEqual([90]);
  });

  it("resets the bunker to a bare claim and refunds undamaged parts", async () => {
    const footprint = { col: 1, row: 1, width: 7, height: 5 };
    const makeSql = (activeRaid: boolean) =>
      vi.fn(async (strings: TemplateStringsArray) => {
        const query = strings.join(" ");
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds: 50, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("SELECT footprint, parts")) {
          return [
            {
              footprint,
              parts: [
                { partId: "wall-panel", col: 3, row: 3, durability: 90 },
                { partId: "wall-panel", col: 5, row: 3, durability: 45 },
                { partId: "door-panel", col: 4, row: 2, durability: 60 },
              ],
              dug: [{ col: 4, row: 3, depth: 1 }],
              skin: "gilded",
              skins_owned: ["gilded"],
              layout_version: BUNKER_LAYOUT_VERSION,
            },
          ];
        }
        if (query.includes("SELECT snapshot")) {
          // An active live raid freezes bunker edits (F-108): the reset guard
          // reads it as an in-flight raid and rejects. The row mirrors the live
          // start shape (versioned, recent start, readable frozen bunker).
          return activeRaid
            ? [
                {
                  snapshot: {
                    version: BUNKER_RAID_LIVE_VERSION,
                    raidId: "live-active",
                    tier: 1,
                    durationSeconds: 180,
                    bunker: {
                      footprint,
                      parts: [],
                      dug: [],
                      block_seed: null,
                      loot: [],
                      skin: null,
                      skins_owned: [],
                      revision: 0,
                    },
                  },
                  raid_version: BUNKER_RAID_LIVE_VERSION,
                  started_at: new Date().toISOString(),
                },
              ]
            : [];
        }
        if (query.includes("SELECT part_id, count")) {
          return [
            { part_id: "wall-panel", count: 2 },
            { part_id: "floor-panel", count: 4 },
            { part_id: "roof-panel", count: 4 },
            { part_id: "door-panel", count: 0 },
          ];
        }
        return [];
      });

    // Mid-raid resets reject with the same guard as repairs.
    const raiding = makeSql(true);
    const blocked = await resetBunker(raiding as never, "player-1");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.status).toBe(409);
      expect(blocked.error).toContain("finish the raid");
    }
    expect(
      raiding.mock.calls.some((call) =>
        (call[0] as TemplateStringsArray).join(" ").includes("UPDATE bunkers"),
      ),
    ).toBe(false);

    const sql = makeSql(false);
    const result = await resetBunker(sql as never, "player-1");
    expect(result.ok).toBe(true);

    // One UPDATE persists the emptied parts and the preserved excavation
    // (F-120: reset keeps dug-out rock) together.
    const updateCall = sql.mock.calls.find((call) =>
      (call[0] as TemplateStringsArray).join(" ").includes("UPDATE bunkers"),
    );
    expect(updateCall).toBeDefined();
    const updateQuery = (
      (updateCall?.[0] ?? []) as unknown as TemplateStringsArray
    ).join(" ");
    expect(updateQuery).toContain("SET parts");
    expect(updateQuery).toContain("dug");
    const bound = ((updateCall ?? []) as unknown[]).slice(1);
    expect(bound[0]).toBe("[]");
    // The dug set survives the reset (F-120) and always carries the spawn
    // pocket seeded on load (F-115): the 3x3x3 (27-cell) pocket, into which
    // the stored dug cell (4,3,1) now falls, so it dedups to 27.
    const persistedDug = JSON.parse(String(bound[1]));
    expect(persistedDug).toContainEqual({ col: 4, row: 3, depth: 1 });
    expect(persistedDug).toHaveLength(27);

    // The inventory upsert carries the refunds: the undamaged wall and
    // door return (2 -> 3, 0 -> 1); the damaged wall is lost.
    const upserts = new Map<string, number>();
    for (const call of sql.mock.calls) {
      const args = call as unknown[];
      const query = (args[0] as TemplateStringsArray).join(" ");
      if (!query.includes("ON CONFLICT (player_id, part_id)")) continue;
      upserts.set(String(args[2]), Number(args[3]));
    }
    expect(upserts.get("wall-panel")).toBe(3);
    expect(upserts.get("door-panel")).toBe(1);
    expect(upserts.get("floor-panel")).toBe(4);
  });

  it("rejects a reset without a claimed bunker", async () => {
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 50, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, parts")) return [];
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      return [];
    });
    const result = await resetBunker(sql as never, "player-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("claim a bunker");
  });

  it("buys a skin once and reselects owned skins for free", async () => {
    const footprint = { col: 1, row: 1, width: 7, height: 5 };
    const makeSql = (emeralds: number, skinsOwned: string[]) =>
      vi.fn(async (strings: TemplateStringsArray) => {
        const query = strings.join(" ");
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("UPDATE players SET emeralds")) {
          // Guarded debit: only returns a row when the player can afford it.
          return emeralds >= 120 ? [{ emeralds: emeralds - 120 }] : [];
        }
        if (query.includes("SELECT footprint, parts")) {
          return [
            {
              footprint,
              parts: [],
              skin: "steelworks",
              skins_owned: skinsOwned,
            },
          ];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) return [];
        if (query.includes("SELECT seed, diff")) return [{ seed: 5, diff: [] }];
        return [];
      });

    const broke = await setBunkerSkin(makeSql(10, []) as never, "p1", "gilded");
    expect(broke.ok).toBe(false);
    if (!broke.ok) expect(broke.error).toContain("costs");

    const rich = makeSql(500, []);
    const bought = await setBunkerSkin(rich as never, "p1", "gilded");
    if (!bought.ok) throw new Error(`buy failed: ${bought.error}`);
    expect(bought.ok).toBe(true);
    const richQueries = rich.mock.calls.map((call) =>
      (call[0] as TemplateStringsArray).join(" "),
    );
    expect(
      richQueries.some((q) => q.includes("UPDATE players SET emeralds")),
    ).toBe(true);
    // The persisted row carries the selected skin and updated ownership.
    const skinUpdate = rich.mock.calls.find((call) =>
      (call[0] as TemplateStringsArray).join(" ").includes("SET skin"),
    );
    expect(skinUpdate).toBeDefined();
    const skinBound = ((skinUpdate ?? []) as unknown[])
      .slice(1)
      .filter((value): value is string => typeof value === "string");
    expect(skinBound).toContain("gilded");
    expect(skinBound.some((value) => value.includes('"gilded"'))).toBe(true);

    expect(vi.mocked(applyAchievementProgress)).toHaveBeenCalledWith(
      expect.anything(),
      "p1",
      { bunkerSkinsBought: 1 },
    );

    const owned = makeSql(0, ["gilded"]);
    const reselect = await setBunkerSkin(owned as never, "p1", "gilded");
    if (!reselect.ok) throw new Error(`reselect failed: ${reselect.error}`);
    expect(reselect.ok).toBe(true);
    const ownedQueries = owned.mock.calls.map((call) =>
      (call[0] as TemplateStringsArray).join(" "),
    );
    expect(
      ownedQueries.some((q) => q.includes("UPDATE players SET emeralds")),
    ).toBe(false);
    // Reselecting an owned skin is not a purchase: no new stamp progress.
    expect(vi.mocked(applyAchievementProgress)).toHaveBeenCalledTimes(1);
  });

  it("rejects Basic Turret buys below player level 2 before spending", async () => {
    const sql = makeBuySql({});

    const result = await buyBasePart(
      sql as never,
      "player-1",
      "basic-turret",
      1,
    );

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "requires player level 2",
    });
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("UPDATE players"),
      ),
    ).toBe(false);
  });

  it("rejects Basic Turret buys when one is already owned", async () => {
    const sql = makeBuySql({
      defenseXp: 100,
      inventoryRows: [{ part_id: "basic-turret", count: 1 }],
    });

    const result = await buyBasePart(
      sql as never,
      "player-1",
      "basic-turret",
      1,
    );

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "stock limit 1 reached",
    });
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("UPDATE players"),
      ),
    ).toBe(false);
  });

  it("sells the revealed staircase like any other part (F-117)", async () => {
    // The stair is no longer comingSoon, so the buy path treats it normally
    // (funds and stock permitting) instead of the unreleased 409.
    const sql = makeBuySql({ defenseXp: 100_000 });

    const result = await buyBasePart(
      sql as never,
      "player-1",
      "stair-panel",
      1,
    );

    expect(result.ok).toBe(true);
    expect(
      sql.mock.calls.some(([strings]) =>
        strings.join(" ").includes("UPDATE players"),
      ),
    ).toBe(true);
  });
});

describe("bunker depth normalization", () => {
  it("normalizes legacy bunker rows without depth onto the tunnel plane", async () => {
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 30, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, parts")) {
        return [
          {
            footprint: { col: 1, row: 4, width: 7, height: 5 },
            parts: [
              { partId: "wall-panel", col: 1, row: 4, durability: 90 },
              {
                partId: "door-panel",
                col: 2,
                row: 4,
                depth: 9,
                durability: 60,
              },
            ],
          },
        ];
      }
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      if (query.includes("INSERT INTO player_base_parts")) return [];
      return [];
    });

    const view = await loadBunkerView(sql as never, "player-1");

    expect(view.bunker?.parts).toEqual([
      { partId: "wall-panel", col: 1, row: 4, depth: 0, durability: 90 },
      { partId: "door-panel", col: 2, row: 4, depth: 0, durability: 60 },
    ]);
    // A legacy row has no dug set, but load seeds the spawn pocket (F-115)
    // so the claim still opens into a walkable room.
    expect(view.bunker?.dug).toEqual(
      bunkerSpawnPocketCells({ col: 1, row: 4, width: 7, height: 5 }),
    );
  });

  it("ignores a legacy core field on a stored bunker row (F-118)", async () => {
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 30, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, parts")) {
        // A row written before the core was removed may still carry one as
        // a stray property; the parser no longer reads it, so it is ignored
        // and the bunker loads without a core rather than crashing.
        return [
          {
            footprint: { col: 1, row: 4, width: 7, height: 5 },
            core: { col: 4, row: 6, depth: 0, durability: 160 },
            parts: [{ partId: "wall-panel", col: 1, row: 4, durability: 90 }],
          },
        ];
      }
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      if (query.includes("INSERT INTO player_base_parts")) return [];
      return [];
    });

    const view = await loadBunkerView(sql as never, "player-1");

    expect(view.bunker).not.toBeNull();
    expect(view.bunker).not.toHaveProperty("core");
    expect(view.bunker?.parts).toEqual([
      { partId: "wall-panel", col: 1, row: 4, depth: 0, durability: 90 },
    ]);
  });
});

describe("bunker block-seed backfill", () => {
  const footprint = { col: 1, row: 4, width: 7, height: 5 };

  it("backfills a missing block seed from the player's mine world (F-116)", async () => {
    // A bunker claimed before block seeds existed stores block_seed NULL, so
    // every cell renders as flat dirt and pays no ore. Loading it derives and
    // persists the same seed a fresh claim would, so its walls gain ore.
    const worldSeed = 777;
    const expected = deriveBunkerBlockSeed(worldSeed, footprint);
    const queries: string[] = [];
    const seedWrites: unknown[][] = [];
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        queries.push(query);
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds: 0, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("SELECT footprint, parts")) {
          return [
            {
              footprint,
              parts: [],
              dug: [],
              block_seed: null,
              layout_version: BUNKER_LAYOUT_VERSION,
            },
          ];
        }
        if (query.includes("SELECT seed") && query.includes("mine_worlds")) {
          return [{ seed: worldSeed }];
        }
        if (
          query.includes("UPDATE bunkers") &&
          query.includes("SET block_seed")
        ) {
          seedWrites.push(values);
          // The guarded write wins and RETURNING echoes the stored seed.
          return [{ block_seed: expected }];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) return [];
        return [];
      },
    );

    const view = await loadBunkerView(sql as never, "player-1");

    // The returned seed is the one the write reported, not a local guess.
    expect(view.bunker?.blockSeed).toBe(expected);
    // The seeded bunker now generates real ore for at least one cell.
    const hasOre = Array.from({ length: 7 }, (_, x) => x).some((x) =>
      Array.from({ length: 5 }, (_, y) => y).some((y) =>
        Array.from({ length: 5 }, (_, z) => z).some(
          (z) => bunkerCellBlock(expected, footprint, x, y, z).kind === "ore",
        ),
      ),
    );
    expect(hasOre).toBe(true);
    // Persisted exactly once, guarded on the column still being NULL so it is
    // idempotent and never overwrites a real seed.
    expect(seedWrites).toHaveLength(1);
    expect(seedWrites[0]).toContain(expected);
    const write = queries.find(
      (q) => q.includes("UPDATE bunkers") && q.includes("SET block_seed"),
    );
    expect(write).toContain("block_seed IS NULL");
    expect(write).toContain("RETURNING block_seed");
  });

  it("adopts the authoritative seed when it loses the backfill race", async () => {
    // A concurrent load already backfilled: the guarded write matches zero
    // rows, so the view must read the persisted seed rather than trust the
    // locally derived value.
    const worldSeed = 777;
    const concurrentSeed = deriveBunkerBlockSeed(worldSeed, footprint);
    let sawReread = false;
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 0, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, parts")) {
        return [
          {
            footprint,
            parts: [],
            dug: [],
            block_seed: null,
            layout_version: BUNKER_LAYOUT_VERSION,
          },
        ];
      }
      if (query.includes("SELECT seed") && query.includes("mine_worlds")) {
        return [{ seed: worldSeed }];
      }
      if (
        query.includes("UPDATE bunkers") &&
        query.includes("SET block_seed")
      ) {
        // Zero-row loser: the column was no longer NULL.
        return [];
      }
      if (
        query.includes("SELECT block_seed") &&
        query.includes("FROM bunkers")
      ) {
        sawReread = true;
        return [{ block_seed: concurrentSeed }];
      }
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      return [];
    });

    const view = await loadBunkerView(sql as never, "player-1");

    expect(sawReread).toBe(true);
    expect(view.bunker?.blockSeed).toBe(concurrentSeed);
  });

  it("leaves an old bunker unseeded when the mine seed is malformed", async () => {
    // A non-numeric seed cannot derive real blocks; the bunker is returned
    // as-is (renders as dirt) rather than seeded from a garbage value.
    const queries: string[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      queries.push(query);
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 0, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, parts")) {
        return [
          {
            footprint,
            parts: [],
            dug: [],
            block_seed: null,
            layout_version: BUNKER_LAYOUT_VERSION,
          },
        ];
      }
      if (query.includes("SELECT seed") && query.includes("mine_worlds")) {
        return [{ seed: "not-a-seed" }];
      }
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      return [];
    });

    const view = await loadBunkerView(sql as never, "player-1");

    expect(view.bunker?.blockSeed).toBeUndefined();
    expect(
      queries.some(
        (q) => q.includes("UPDATE bunkers") && q.includes("SET block_seed"),
      ),
    ).toBe(false);
  });

  it("leaves a bunker that already has a seed untouched", async () => {
    const queries: string[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      queries.push(query);
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 0, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, parts")) {
        return [
          {
            footprint,
            parts: [],
            dug: [],
            block_seed: 4242,
            layout_version: BUNKER_LAYOUT_VERSION,
          },
        ];
      }
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      return [];
    });

    const view = await loadBunkerView(sql as never, "player-1");

    expect(view.bunker?.blockSeed).toBe(4242);
    // No world lookup and no backfill write for an already-seeded bunker.
    expect(queries.some((q) => q.includes("mine_worlds"))).toBe(false);
    expect(
      queries.some(
        (q) => q.includes("UPDATE bunkers") && q.includes("SET block_seed"),
      ),
    ).toBe(false);
  });

  it("leaves an old bunker unseeded when the player has no mine world", async () => {
    const queries: string[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      queries.push(query);
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 0, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, parts")) {
        return [
          {
            footprint,
            parts: [],
            dug: [],
            block_seed: null,
            layout_version: BUNKER_LAYOUT_VERSION,
          },
        ];
      }
      if (query.includes("SELECT seed") && query.includes("mine_worlds")) {
        return [];
      }
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      return [];
    });

    const view = await loadBunkerView(sql as never, "player-1");

    expect(view.bunker?.blockSeed).toBeUndefined();
    expect(
      queries.some(
        (q) => q.includes("UPDATE bunkers") && q.includes("SET block_seed"),
      ),
    ).toBe(false);
  });

  it("preserves parts, dug cells, and loot while filling the seed", async () => {
    // The backfill fills only block_seed; the player's build and digging must
    // survive untouched. Use a cell outside the spawn pocket (x 6, depth 3) so
    // its presence proves preservation, not the pocket seeding.
    const worldSeed = 555;
    const expected = deriveBunkerBlockSeed(worldSeed, footprint);
    const bottomRow = footprint.row + footprint.height - 1;
    const part = {
      partId: "wall-panel",
      col: footprint.col + 2,
      row: bottomRow,
      depth: 0,
      durability: 90,
    };
    const dugCell = { col: footprint.col + 6, row: bottomRow, depth: 3 };
    const lootPile = {
      col: footprint.col + 6,
      row: bottomRow,
      depth: 3,
      ores: { coal: 3 },
    };
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 0, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, parts")) {
        return [
          {
            footprint,
            parts: [part],
            dug: [dugCell],
            loot: [lootPile],
            block_seed: null,
            layout_version: BUNKER_LAYOUT_VERSION,
          },
        ];
      }
      if (query.includes("SELECT seed") && query.includes("mine_worlds")) {
        return [{ seed: worldSeed }];
      }
      if (
        query.includes("UPDATE bunkers") &&
        query.includes("SET block_seed")
      ) {
        return [{ block_seed: expected }];
      }
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      return [];
    });

    const view = await loadBunkerView(sql as never, "player-1");

    expect(view.bunker?.blockSeed).toBe(expected);
    expect(view.bunker?.parts).toContainEqual(part);
    expect(view.bunker?.dug).toContainEqual(dugCell);
    expect(view.bunker?.loot).toContainEqual(lootPile);
  });
});

describe("bunker excavation wrapper", () => {
  it("persists reachable digs and rejects unreachable ones", async () => {
    const writes: string[] = [];
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds: 30, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("SELECT footprint, parts")) {
          return [
            {
              footprint: { col: 1, row: 4, width: 7, height: 5 },
              parts: [],
              // One open floor cell so the depth-1 dig below chains from
              // it; depth-3 stays unreachable (no open neighbor).
              dug: [{ col: 2, row: 5, depth: 0 }],
              layout_version: BUNKER_LAYOUT_VERSION,
            },
          ];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) {
          return [{ part_id: "wall-panel", count: 2 }];
        }
        if (query.includes("UPDATE bunkers")) {
          writes.push(values.map(String).join("|"));
          // The guarded dig CTE reports the row it wrote so the wrapper
          // knows the revision guard was satisfied (F-122).
          return [{ dug_rows: 1, ore_rows: 0 }];
        }
        if (query.includes("INSERT INTO player_base_parts")) return [];
        return [];
      },
    );

    const unreachable = await excavateBunker(sql as never, "player-1", 2, 5, 3);
    expect(unreachable.ok).toBe(false);
    if (!unreachable.ok) {
      expect(unreachable.error).toBe("cannot dig: unreachable");
    }
    expect(writes).toEqual([]);
    expect(applyAchievementProgress).not.toHaveBeenCalled();

    vi.mocked(applyAchievementProgress).mockResolvedValueOnce([
      "bunker-groundbreaker",
    ]);
    const dug = await excavateBunker(sql as never, "player-1", 2, 5, 1);
    expect(dug.ok).toBe(true);
    if (dug.ok) {
      expect(dug.newStamps).toEqual(["bunker-groundbreaker"]);
    }
    expect(writes.length).toBeGreaterThan(0);
    expect(writes[0]).toContain('"depth":1');
    // Groundbreaker is backfill-only: the wrapper never increments the
    // counter; the refresh reads the durable bunkers.dug array instead.
    expect(applyAchievementProgress).toHaveBeenCalledWith(sql, "player-1", {});
  });

  it("credits the block's ore vibes to the balance when digging ore", async () => {
    const footprint: BunkerFootprint = { col: 1, row: 40, width: 7, height: 5 };
    const blockSeed = deriveBunkerBlockSeed(9090, footprint);
    const target = oreCellWithOpenNeighbor(footprint, blockSeed);
    if (!target) throw new Error("expected an ore cell in a deep footprint");
    let playerCredit: unknown[] | null = null;
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds: 30, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("SELECT footprint, parts")) {
          return [
            {
              footprint,
              parts: [],
              dug: [target.open],
              block_seed: blockSeed,
              layout_version: BUNKER_LAYOUT_VERSION,
            },
          ];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) return [];
        if (query.includes("UPDATE players")) {
          // The excavate write is one CTE that digs and pays ore, so this
          // branch matches the whole statement; report the guarded dig as
          // won (F-122) while capturing the ore payout's bound values.
          playerCredit = values;
          return [{ dug_rows: 1, ore_rows: 1 }];
        }
        return [];
      },
    );
    const result = await excavateBunker(
      sql as never,
      "player-1",
      target.ore.col,
      target.ore.row,
      target.ore.depth,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.oreVibes ?? 0).toBeGreaterThan(0);
    // The single CTE credited the balance with the ore's vibes.
    expect(playerCredit).not.toBeNull();
  });

  it("persists cascaded parts atomically with the dug cell (F-117)", async () => {
    // A grounded slotted floor in a fully interior cell (every other face
    // already dug open and empty, so no rock, shell, or part attachment
    // remains). Digging the cell below out drops the floor (F-117 cascade).
    // The guarded write must bind both the new dug cell and the emptied
    // parts array in one statement, and a subsequent load must read the
    // settled state, so the drop is durable.
    const footprint: BunkerFootprint = { col: 1, row: 4, width: 7, height: 5 };
    // Stateful store: the SELECT returns whatever the last winning UPDATE
    // wrote, so a reload models real persistence rather than a fixed row.
    // The floor sits at depth 3, just behind the auto-seeded spawn pocket
    // (cols 3-5, rows 6-8, depths 0-2): the pocket cell in front of the
    // ground gives the dig its clear face, and the dug cells around the
    // floor leave it no rock, shell, or part to attach to once the ground
    // below it opens.
    let storedDug: Array<{ col: number; row: number; depth: number }> = [
      { col: 3, row: 6, depth: 3 },
      { col: 2, row: 6, depth: 3 },
      { col: 4, row: 6, depth: 3 },
      { col: 3, row: 6, depth: 4 },
      { col: 3, row: 5, depth: 3 },
    ];
    let storedParts: unknown[] = [
      {
        partId: "floor-panel",
        col: 3,
        row: 6,
        depth: 3,
        slot: "floor",
        durability: 70,
      },
    ];
    let bunkerUpdateQuery: string | null = null;
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds: 30, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("SELECT footprint, parts")) {
          return [
            {
              footprint,
              parts: storedParts,
              dug: storedDug,
              layout_version: BUNKER_LAYOUT_VERSION,
            },
          ];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) return [];
        if (query.includes("UPDATE bunkers")) {
          // The guarded dig CTE binds dug then parts; apply both to the store
          // so the next load observes the settled bunker.
          bunkerUpdateQuery = query;
          storedDug = JSON.parse(values[0] as string);
          storedParts = JSON.parse(values[1] as string);
          return [{ dug_rows: 1, ore_rows: 0 }];
        }
        return [];
      },
    );
    // Dig the cell below the floor through the pocket's clear depth face:
    // it pulls the floor's last attachment away.
    const result = await excavateBunker(sql as never, "player-1", 3, 7, 3);
    expect(result.ok).toBe(true);
    // The success result carries a fresh post-write reload; it must show the
    // cascaded floor gone, proving the guarded write did not resurrect it.
    if (result.ok) {
      expect(result.view.bunker?.parts ?? []).toEqual([]);
      expect(
        result.view.bunker?.dug.some(
          (cell) => cell.row === 7 && cell.depth === 3,
        ),
      ).toBe(true);
    }
    // One statement carried the dug write, the parts write, the revision
    // guard, and the ore-pay CTE, so dug and parts settle under one revision.
    expect(bunkerUpdateQuery).not.toBeNull();
    const updateSql = bunkerUpdateQuery ?? "";
    expect(updateSql).toContain("SET dug");
    expect(updateSql).toContain("parts =");
    expect(updateSql).toContain("revision = revision + 1");
    expect(updateSql).toContain("AND revision =");
    expect(updateSql).toContain("ore_pay");
    // The winning write also settled the underlying store (the next load's
    // source): the new cell is dug and the cascaded floor is gone.
    expect(storedDug.some((cell) => cell.row === 8)).toBe(true);
    expect(storedParts).toEqual([]);
  });
});

describe("bunker loot collection", () => {
  it("credits a loot cell's vibes and clears the pile", async () => {
    const footprint: BunkerFootprint = { col: 1, row: 40, width: 7, height: 5 };
    let lootWrite: string | null = null;
    let playerCredited = false;
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds: 5, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("SELECT footprint, parts")) {
          return [
            {
              footprint,
              parts: [],
              dug: [{ col: 2, row: 44, depth: 0 }],
              loot: [{ col: 2, row: 44, depth: 0, ores: { coal: 4 } }],
            },
          ];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) return [];
        if (query.includes("UPDATE players")) {
          playerCredited = true;
          lootWrite = String(values[0]);
          return [];
        }
        return [];
      },
    );
    const result = await collectBunkerLoot(sql as never, "player-1", 2, 44, 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.oreVibes).toBe(4); // coal value 1 x 4
    expect(playerCredited).toBe(true);
    // The loot list written back no longer holds the collected cell.
    expect(lootWrite).toBe("[]");
  });

  it("is a no-op on a cell with no loot", async () => {
    const footprint: BunkerFootprint = { col: 1, row: 40, width: 7, height: 5 };
    let playerCredited = false;
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 5, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, parts")) {
        return [
          {
            footprint,
            parts: [],
            dug: [{ col: 2, row: 44, depth: 0 }],
            loot: [],
          },
        ];
      }
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      if (query.includes("UPDATE players")) {
        playerCredited = true;
        return [];
      }
      return [];
    });
    const result = await collectBunkerLoot(sql as never, "player-1", 2, 44, 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.oreVibes).toBe(0);
    expect(playerCredited).toBe(false);
  });
});

describe("bunker part wrappers with depth", () => {
  it("persists placements on deeper layers", async () => {
    const writes: string[] = [];
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds: 30, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("SELECT footprint, parts")) {
          return [
            {
              footprint: { col: 1, row: 4, width: 7, height: 5 },
              parts: [],
              dug: [
                { col: 2, row: 5, depth: 1 },
                { col: 2, row: 5, depth: 2 },
                { col: 2, row: 5, depth: 3 },
              ],
              layout_version: BUNKER_LAYOUT_VERSION,
            },
          ];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) {
          return [{ part_id: "wall-panel", count: 2 }];
        }
        if (query.includes("UPDATE bunkers")) {
          writes.push(values.map(String).join("|"));
          // The guarded parts write returns its row so the wrapper sees
          // the revision guard was satisfied (F-122).
          return [{ player_id: "player-1" }];
        }
        if (query.includes("INSERT INTO player_base_parts")) return [];
        return [];
      },
    );

    const result = await placeBunkerPart(
      sql as never,
      "player-1",
      "wall-panel",
      2,
      5,
      3,
    );

    expect(result.ok).toBe(true);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes[0]).toContain('"depth":3');
  });

  it("persists a thin part's slot through the wrapper (F-117)", async () => {
    const writes: string[] = [];
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds: 30, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("SELECT footprint, parts")) {
          return [
            {
              footprint: { col: 1, row: 4, width: 7, height: 5 },
              parts: [],
              // Two adjacent open cells so the +x wall face is unambiguous.
              dug: [
                { col: 2, row: 5, depth: 3 },
                { col: 3, row: 5, depth: 3 },
              ],
              layout_version: BUNKER_LAYOUT_VERSION,
            },
          ];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) {
          return [{ part_id: "wall-panel", count: 2 }];
        }
        if (query.includes("UPDATE bunkers")) {
          writes.push(values.map(String).join("|"));
          return [{ player_id: "player-1" }];
        }
        if (query.includes("INSERT INTO player_base_parts")) return [];
        return [];
      },
    );

    const result = await placeBunkerPart(
      sql as never,
      "player-1",
      "wall-panel",
      2,
      5,
      3,
      "wall-px",
    );

    expect(result.ok).toBe(true);
    expect(writes.length).toBeGreaterThan(0);
    // The wall persists on a wall slot (canonical face), not as a whole-cell
    // legacy part, proving the wrapper forwarded the slot to the sim.
    expect(writes[0]).toContain('"slot":"wall');
  });

  it("persists a stair's orientation through the wrapper (F-117)", async () => {
    const writes: string[] = [];
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds: 30, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("SELECT footprint, parts")) {
          return [
            {
              footprint: { col: 1, row: 4, width: 7, height: 5 },
              parts: [],
              // A grounded bottom-row cell so the mount is supported.
              dug: [{ col: 2, row: 8, depth: 0 }],
              layout_version: BUNKER_LAYOUT_VERSION,
            },
          ];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) {
          return [{ part_id: "stair-panel", count: 1 }];
        }
        if (query.includes("UPDATE bunkers")) {
          writes.push(values.map(String).join("|"));
          return [{ player_id: "player-1" }];
        }
        if (query.includes("INSERT INTO player_base_parts")) return [];
        return [];
      },
    );

    const result = await placeBunkerPart(
      sql as never,
      "player-1",
      "stair-panel",
      2,
      8,
      0,
      "mount",
      2,
    );

    expect(result.ok).toBe(true);
    expect(writes.length).toBeGreaterThan(0);
    // The stair persists its facing, proving the wrapper forwarded the
    // orientation through to the sim write.
    expect(writes[0]).toContain('"orientation":2');
  });
});

describe("banked edit revision guard (F-122)", () => {
  function guardSql(opts: { revision: number; writeWins?: boolean }) {
    const guardedValues: unknown[][] = [];
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds: 200, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("SELECT footprint, parts")) {
          return [
            {
              footprint: { col: 1, row: 1, width: 7, height: 5 },
              parts: [],
              // The placement cell (1,1,0) is dug open so placeBasePart
              // reaches the revision-guarded write.
              dug: [{ col: 1, row: 1, depth: 0 }],
              block_seed: 123,
              loot: [],
              skin: null,
              skins_owned: [],
              revision: opts.revision,
              layout_version: BUNKER_LAYOUT_VERSION,
            },
          ];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) {
          return [{ part_id: "wall-panel", count: 5 }];
        }
        if (query.includes("revision = revision + 1")) {
          guardedValues.push(values);
          return opts.writeWins === false ? [] : [{ player_id: "player-1" }];
        }
        if (query.includes("INSERT INTO player_base_parts")) return [];
        return [];
      },
    );
    return { sql, guardedValues };
  }

  it("places when the expected revision matches and the guarded write wins", async () => {
    const { sql, guardedValues } = guardSql({ revision: 3 });
    const result = await placeBunkerPart(
      sql as never,
      "player-1",
      "wall-panel",
      1,
      1,
      0,
      undefined,
      undefined,
      3,
    );
    expect(result.ok).toBe(true);
    // The guarded write ran with the client's expected revision bound in.
    expect(guardedValues).toHaveLength(1);
    expect(guardedValues[0]).toContain(3);
  });

  it("409s a stale expected revision before it ever writes", async () => {
    const { sql, guardedValues } = guardSql({ revision: 5 });
    const result = await placeBunkerPart(
      sql as never,
      "player-1",
      "wall-panel",
      1,
      1,
      0,
      undefined,
      undefined,
      3,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("bunker-revision-conflict");
      // The conflict carries the authoritative view so the client resyncs.
      expect(result.body).toMatchObject({ revision: 5 });
    }
    expect(guardedValues).toHaveLength(0);
  });

  it("409s when a concurrent write won the guarded update", async () => {
    const { sql, guardedValues } = guardSql({ revision: 3, writeWins: false });
    const result = await placeBunkerPart(
      sql as never,
      "player-1",
      "wall-panel",
      1,
      1,
      0,
      undefined,
      undefined,
      3,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("bunker-revision-conflict");
    }
    // The guard ran (and lost) exactly once, so nothing double-writes.
    expect(guardedValues).toHaveLength(1);
  });

  it("falls back to the loaded revision when the client omits it", async () => {
    const { sql, guardedValues } = guardSql({ revision: 7 });
    const result = await placeBunkerPart(
      sql as never,
      "player-1",
      "wall-panel",
      1,
      1,
      0,
    );
    expect(result.ok).toBe(true);
    expect(guardedValues[0]).toContain(7);
  });

  it("409s a stale dig before touching the dug set", async () => {
    const { sql, guardedValues } = guardSql({ revision: 4 });
    const result = await excavateBunker(sql as never, "player-1", 1, 5, 0, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("bunker-revision-conflict");
    }
    expect(guardedValues).toHaveLength(0);
  });
});

describe("atomic bunker part and inventory writes (F-171)", () => {
  // The query-string mock cannot execute the CTE, so these prove the
  // app-level contract that closes the winner-side partial-write and the
  // blind-snapshot clobber: exactly one data-modifying inventory statement is
  // issued, it carries the change as a DELTA (count + EXCLUDED.count) with the
  // non-negative guard, and a losing guard resyncs with no separate write. The
  // all-or-nothing commit itself is a property of the single Postgres
  // statement, which a mock cannot run.
  type Call = { query: string; values: unknown[] };
  function atomicSql(opts: {
    parts?: unknown[];
    dug?: unknown[];
    inventory?: Array<{ part_id: string; count: number }>;
    revision?: number;
    writeWins?: boolean;
  }) {
    const calls: Call[] = [];
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        calls.push({ query, values });
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds: 200, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("SELECT footprint, parts")) {
          return [
            {
              footprint: { col: 1, row: 4, width: 7, height: 5 },
              parts: opts.parts ?? [],
              dug: opts.dug ?? [],
              block_seed: 123,
              loot: [],
              skin: null,
              skins_owned: [],
              revision: opts.revision ?? 3,
              layout_version: BUNKER_LAYOUT_VERSION,
            },
          ];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) {
          return opts.inventory ?? [{ part_id: "wall-panel", count: 5 }];
        }
        // The single atomic combined write is the only statement that carries
        // jsonb_to_recordset. A row means the guarded write won.
        if (query.includes("jsonb_to_recordset")) {
          return opts.writeWins === false ? [] : [{ player_id: "player-1" }];
        }
        return [];
      },
    );
    return { sql, calls };
  }

  // The starter backfill inserts with VALUES (no ON CONFLICT), so filtering on
  // the conflict clause isolates the one atomic delta upsert.
  const conflictWrites = (calls: Call[]) =>
    calls.filter((c) => c.query.includes("ON CONFLICT (player_id, part_id)"));

  it("places by debiting one part as a delta in a single atomic statement", async () => {
    const { sql, calls } = atomicSql({
      dug: [
        { col: 2, row: 5, depth: 1 },
        { col: 2, row: 5, depth: 2 },
        { col: 2, row: 5, depth: 3 },
      ],
      inventory: [{ part_id: "wall-panel", count: 5 }],
      revision: 3,
    });
    const result = await placeBunkerPart(
      sql as never,
      "player-1",
      "wall-panel",
      2,
      5,
      3,
      undefined,
      undefined,
      3,
    );
    expect(result.ok).toBe(true);

    const conflicts = conflictWrites(calls);
    expect(conflicts).toHaveLength(1);
    const write = conflicts[0];
    // One statement holds both the guarded parts write and the inventory
    // change, so there is no window where parts land without their debit.
    expect(write.query).toContain("jsonb_to_recordset");
    expect(write.query).toContain("UPDATE bunkers");
    // Inventory moves by delta, so a concurrent purchase is added to, never
    // overwritten by a stale absolute snapshot.
    expect(write.query).toContain(
      "count = player_base_parts.count + EXCLUDED.count",
    );
    // A debit that would drop a stored count below zero is rejected in the
    // same statement.
    expect(write.query).toContain("COALESCE(p.count, 0) + i.delta < 0");
    // The bound delta is exactly the one-part debit.
    expect(JSON.parse(String(write.values[0]))).toEqual([
      { part_id: "wall-panel", delta: -1 },
    ]);
  });

  it("removes by refunding one part as a +1 delta in the same statement", async () => {
    const { sql, calls } = atomicSql({
      parts: [
        { partId: "wall-panel", col: 2, row: 5, depth: 0, durability: 90 },
      ],
      inventory: [{ part_id: "wall-panel", count: 2 }],
      revision: 3,
    });
    const result = await removeBunkerPart(
      sql as never,
      "player-1",
      2,
      5,
      0,
      undefined,
      3,
    );
    expect(result.ok).toBe(true);
    const conflicts = conflictWrites(calls);
    expect(conflicts).toHaveLength(1);
    expect(JSON.parse(String(conflicts[0].values[0]))).toEqual([
      { part_id: "wall-panel", delta: 1 },
    ]);
  });

  it("moves with zero inventory deltas in one atomic statement", async () => {
    const { sql, calls } = atomicSql({
      parts: [
        { partId: "wall-panel", col: 2, row: 5, depth: 1, durability: 90 },
      ],
      // Both the source and the target cell are dug open so the whole-cell
      // move lands.
      dug: [
        { col: 2, row: 5, depth: 1 },
        { col: 3, row: 5, depth: 1 },
      ],
      inventory: [{ part_id: "wall-panel", count: 2 }],
      revision: 3,
    });
    const result = await moveBunkerPart(
      sql as never,
      "player-1",
      2,
      5,
      3,
      5,
      1,
      1,
      3,
    );
    expect(result.ok).toBe(true);
    const conflicts = conflictWrites(calls);
    expect(conflicts).toHaveLength(1);
    // A move changes no inventory: the atomic write carries an empty delta set.
    expect(JSON.parse(String(conflicts[0].values[0]))).toEqual([]);
  });

  it("409s a losing guard with no separate inventory write", async () => {
    const { sql, calls } = atomicSql({
      dug: [
        { col: 2, row: 5, depth: 1 },
        { col: 2, row: 5, depth: 2 },
        { col: 2, row: 5, depth: 3 },
      ],
      inventory: [{ part_id: "wall-panel", count: 5 }],
      revision: 3,
      // The guarded combined write matches zero rows (a concurrent edit won,
      // or the debit was impossible).
      writeWins: false,
    });
    const result = await placeBunkerPart(
      sql as never,
      "player-1",
      "wall-panel",
      2,
      5,
      3,
      undefined,
      undefined,
      3,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("bunker-revision-conflict");
    }
    // The atomic statement is the only inventory write, and it changed nothing
    // when it lost, so neither parts nor inventory can drift out of step.
    expect(conflictWrites(calls)).toHaveLength(1);
    expect(
      calls.some(
        (c) =>
          c.query.includes("ON CONFLICT (player_id, part_id)") &&
          !c.query.includes("jsonb_to_recordset"),
      ),
    ).toBe(false);
  });

  it("propagates an injected write failure with no partial second write", async () => {
    const calls: Call[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      calls.push({ query, values: [] });
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 200, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, parts")) {
        return [
          {
            footprint: { col: 1, row: 4, width: 7, height: 5 },
            parts: [],
            dug: [
              { col: 2, row: 5, depth: 1 },
              { col: 2, row: 5, depth: 2 },
              { col: 2, row: 5, depth: 3 },
            ],
            block_seed: 123,
            loot: [],
            skin: null,
            skins_owned: [],
            revision: 3,
            layout_version: BUNKER_LAYOUT_VERSION,
          },
        ];
      }
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) {
        return [{ part_id: "wall-panel", count: 5 }];
      }
      if (query.includes("jsonb_to_recordset")) {
        throw new Error("db down mid-write");
      }
      return [];
    });
    await expect(
      placeBunkerPart(
        sql as never,
        "player-1",
        "wall-panel",
        2,
        5,
        3,
        undefined,
        undefined,
        3,
      ),
    ).rejects.toThrow("db down");
    // Only the single combined write was attempted: there is no separate
    // inventory statement that could have committed on its own.
    expect(conflictWrites(calls)).toHaveLength(1);
  });
});

describe("layout-incompatible bunker fail-fast (F-117)", () => {
  // A legacy bunker row: it carries built parts but no layout_version, so it
  // parses as version 0 and reads as incompatible with the current model.
  function legacySql() {
    const updates: string[] = [];
    const upserts: Array<[string, number]> = [];
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds: 200, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("SELECT footprint, parts")) {
          return [
            {
              footprint: { col: 1, row: 4, width: 7, height: 5 },
              parts: [
                {
                  partId: "wall-panel",
                  col: 1,
                  row: 4,
                  depth: 0,
                  durability: 90,
                },
              ],
              dug: [{ col: 2, row: 5, depth: 1 }],
              block_seed: 4242,
              revision: 3,
              // No layout_version: legacy, reads as incompatible.
            },
          ];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) {
          return [{ part_id: "wall-panel", count: 5 }];
        }
        if (query.includes("UPDATE bunkers")) {
          updates.push(query);
          return [{ player_id: "player-1" }];
        }
        if (query.includes("ON CONFLICT (player_id, part_id)")) {
          upserts.push([String(values[1]), Number(values[2])]);
          return [];
        }
        return [];
      },
    );
    return { sql, updates, upserts };
  }

  it("rejects every edit on a legacy bunker with the layout-incompatible code", async () => {
    for (const call of [
      (sql: unknown) =>
        placeBunkerPart(sql as never, "player-1", "wall-panel", 2, 5, 1),
      (sql: unknown) => removeBunkerPart(sql as never, "player-1", 1, 4, 0),
      (sql: unknown) =>
        moveBunkerPart(sql as never, "player-1", 1, 4, 2, 4, 0, 0),
      (sql: unknown) => excavateBunker(sql as never, "player-1", 2, 5, 2),
      // The refunding reset and repair are blocked too: an old layout can
      // only Start fresh (no refund, Q-022), so it must not be reset for a
      // refund or have vibes spent patching parts about to be cleared.
      (sql: unknown) => resetBunker(sql as never, "player-1"),
      (sql: unknown) => repairBunker(sql as never, "player-1"),
    ]) {
      const { sql, updates } = legacySql();
      const result = await call(sql);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(409);
        expect(result.code).toBe("bunker-layout-incompatible");
      }
      // It fails before any write: no bunker UPDATE ran.
      expect(updates).toHaveLength(0);
    }
  });

  it("Start fresh wipes a legacy bunker with no refund and stamps the version", async () => {
    const { sql, updates, upserts } = legacySql();
    const result = await startFreshBunker(sql as never, "player-1");
    expect(result.ok).toBe(true);

    // One UPDATE clears parts, stamps the version, and keeps the excavation.
    const update = sql.mock.calls.find((call) =>
      (call[0] as TemplateStringsArray).join(" ").includes("UPDATE bunkers"),
    );
    expect(update).toBeDefined();
    const updateQuery = (
      (update?.[0] ?? []) as unknown as TemplateStringsArray
    ).join(" ");
    expect(updateQuery).toContain("SET parts");
    expect(updateQuery).toContain("layout_version =");
    expect(updateQuery).toContain("dug");
    expect(updateQuery).toContain("revision = revision + 1");
    // Guarded compare-and-swap: the write only lands on the still-legacy
    // bunker at the loaded revision, so a concurrent reset+rebuild is not
    // clobbered (F-117 TOCTOU).
    expect(updateQuery).toContain("AND revision =");
    expect(updateQuery).toContain("layout_version <");
    // RETURNING lets the wrapper tell a winning write from a lost race so a
    // loser can 409 instead of reporting a phantom success (F-122).
    expect(updateQuery).toContain("RETURNING");
    const bound = ((update ?? []) as unknown[]).slice(1);
    // parts cleared to [], excavation preserved.
    expect(bound[0]).toBe("[]");
    const persistedDug = JSON.parse(String(bound[1]));
    expect(persistedDug).toContainEqual({ col: 2, row: 5, depth: 1 });
    // Exactly one bunker UPDATE ran (no second guarded rewrite).
    expect(updates).toHaveLength(1);
    // No refund: Start fresh never upserts the base-part inventory.
    expect(upserts).toHaveLength(0);
  });

  it("does not clobber a bunker a concurrent request already reset and rebuilt", async () => {
    // The first load sees the legacy bunker this request will try to wipe.
    // Before its guarded write lands, a concurrent Start fresh has reset the
    // bunker to current and the player rebuilt a wall: the reload sees that.
    let advanced = false;
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 200, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, parts")) {
        return advanced
          ? [
              {
                footprint: { col: 1, row: 4, width: 7, height: 5 },
                parts: [
                  {
                    partId: "wall-panel",
                    col: 1,
                    row: 4,
                    depth: 0,
                    durability: 90,
                  },
                ],
                dug: [{ col: 2, row: 5, depth: 1 }],
                revision: 5,
                layout_version: BUNKER_LAYOUT_VERSION,
              },
            ]
          : [
              {
                footprint: { col: 1, row: 4, width: 7, height: 5 },
                parts: [
                  {
                    partId: "wall-panel",
                    col: 1,
                    row: 4,
                    depth: 0,
                    durability: 90,
                  },
                ],
                dug: [{ col: 2, row: 5, depth: 1 }],
                revision: 3,
                // Legacy: no layout_version.
              },
            ];
      }
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) {
        return [{ part_id: "wall-panel", count: 5 }];
      }
      if (query.includes("UPDATE bunkers")) {
        // The guarded write matches nothing: the bunker is no longer at the
        // loaded revision and is already current. Simulate the concurrent
        // advance the guard is protecting against.
        advanced = true;
        return [];
      }
      return [];
    });

    const result = await startFreshBunker(sql as never, "player-1");

    // A race loser follows the same F-122 conflict contract as every other
    // bunker edit: a 409 carrying the authoritative reloaded view, never a
    // phantom success and never a clobber.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("bunker-revision-conflict");
      // The rebuilt wall on the now-current bunker survives, not wiped, and
      // the client adopts it from the conflict body.
      const body = result.body as { bunker?: BunkerState };
      expect(body.bunker?.parts).toHaveLength(1);
      expect(body.bunker?.layoutVersion).toBe(BUNKER_LAYOUT_VERSION);
    }
  });

  it("Start fresh is a safe no-op on an already-current bunker", async () => {
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 200, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, parts")) {
        return [
          {
            footprint: { col: 1, row: 4, width: 7, height: 5 },
            parts: [
              {
                partId: "wall-panel",
                col: 1,
                row: 4,
                depth: 0,
                durability: 90,
              },
            ],
            dug: [{ col: 2, row: 5, depth: 1 }],
            revision: 3,
            layout_version: BUNKER_LAYOUT_VERSION,
          },
        ];
      }
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) {
        return [{ part_id: "wall-panel", count: 5 }];
      }
      return [];
    });
    const result = await startFreshBunker(sql as never, "player-1");
    expect(result.ok).toBe(true);
    // A current bunker is returned unchanged: no UPDATE ever runs, so a
    // retry can never wipe a valid layout with no refund.
    expect(
      sql.mock.calls.some((call) =>
        (call[0] as TemplateStringsArray).join(" ").includes("UPDATE bunkers"),
      ),
    ).toBe(false);
    if (result.ok) {
      expect(result.view.bunker?.parts).toHaveLength(1);
    }
  });
});
