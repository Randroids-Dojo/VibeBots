import { afterEach, describe, expect, it, vi } from "vitest";
import { bunkerCells, proposedBunkerFootprint } from "@/sim/bunker";
import { applyAchievementProgress } from "./achievements";
import {
  buyBasePart,
  claimBunker,
  collectBunkerRaidPickup,
  excavateBunker,
  finishBunkerRaid,
  loadBunkerView,
  placeBunkerPart,
  repairBunker,
  resetBunker,
  setBunkerSkin,
  startBunkerRaid,
} from "./bunker";

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
    if (query.includes("SELECT footprint, core, parts")) {
      return [
        {
          footprint: { col: 1, row: 1, width: 7, height: 5 },
          core: { col: 4, row: 3, durability: 160 },
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

  it("normalizes legacy active raid rows before returning the bunker view", async () => {
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 30, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, core, parts")) return [];
      if (query.includes("SELECT snapshot")) {
        return [
          {
            snapshot: {
              raidId: "raid-legacy",
              tier: 1,
              durationSeconds: 180,
              clankers: [],
              turretShots: 0,
              turretDamage: 0,
              spikeTriggers: 0,
              spikeDamage: 0,
              totalPartDurability: 160,
              incomingDamage: 40,
              breached: false,
              survived: true,
              reward: { vibes: 30 },
            },
          },
        ];
      }
      if (query.includes("SELECT part_id, count")) return [];
      if (query.includes("INSERT INTO player_base_parts")) return [];
      return [];
    });

    const view = await loadBunkerView(sql as never, "player-1");

    expect(view.activeRaid).toMatchObject({
      raidId: "raid-legacy",
      partDamage: [],
      coreDamage: 0,
      xpPickups: [],
      allClankersDead: false,
      minerKilled: false,
      reward: { vibes: 30, defenseXp: 0 },
    });
  });

  it("finishes a survived legacy raid row without XP pickup fields", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T00:05:00.000Z"));
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT raid_id, snapshot")) {
        return [
          {
            raid_id: "raid-legacy",
            started_at: "2026-06-18T00:00:00.000Z",
            duration_seconds: 180,
            snapshot: {
              raidId: "raid-legacy",
              tier: 1,
              durationSeconds: 180,
              clankers: [],
              turretShots: 0,
              turretDamage: 0,
              spikeTriggers: 0,
              spikeDamage: 0,
              totalPartDurability: 160,
              incomingDamage: 40,
              breached: false,
              survived: true,
              reward: { vibes: 30 },
            },
          },
        ];
      }
      if (query.includes("UPDATE bunker_raids"))
        return [{ raid_id: "raid-legacy" }];
      if (query.includes("SELECT track_xp, defense_xp")) {
        return [{ track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT achievement_id")) return [];
      if (query.includes("UPDATE players")) return [{ defense_xp: 0 }];
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 60, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, core, parts")) return [];
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      if (query.includes("INSERT INTO player_base_parts")) return [];
      return [];
    });

    const result = await finishBunkerRaid(sql as never, "player-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.raid.xpPickups).toEqual([]);
    expect(result.reward).toMatchObject({
      survived: true,
      vibesGained: 30,
      xpGained: 0,
    });
  });

  it("does not pay a raid reward when the finish row was already claimed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T00:05:00.000Z"));
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT raid_id, snapshot")) {
        return [
          {
            raid_id: "raid-1",
            started_at: "2026-06-18T00:00:00.000Z",
            duration_seconds: 180,
            snapshot: {
              raidId: "raid-1",
              tier: 1,
              durationSeconds: 180,
              clankers: [],
              turretShots: 0,
              turretDamage: 0,
              spikeTriggers: 0,
              spikeDamage: 0,
              totalPartDurability: 180,
              incomingDamage: 100,
              partDamage: [],
              coreDamage: 0,
              xpPickups: [],
              allClankersDead: true,
              breached: false,
              minerKilled: false,
              survived: true,
              reward: { vibes: 30, defenseXp: 60 },
            },
          },
        ];
      }
      if (query.includes("UPDATE bunker_raids")) return [];
      if (query.includes("UPDATE players")) {
        throw new Error("reward should not be paid");
      }
      return [];
    });

    const result = await finishBunkerRaid(sql as never, "player-1");

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "raid already finished",
    });
  });

  it("refuses to finish a survived raid while XP pickups are uncollected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T00:00:10.000Z"));
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT raid_id, snapshot")) {
        return [
          {
            raid_id: "raid-1",
            started_at: "2026-06-18T00:00:00.000Z",
            duration_seconds: 180,
            snapshot: {
              raidId: "raid-1",
              tier: 1,
              durationSeconds: 3,
              clankers: [],
              turretShots: 0,
              turretDamage: 0,
              spikeTriggers: 0,
              spikeDamage: 0,
              totalPartDurability: 180,
              incomingDamage: 100,
              partDamage: [],
              coreDamage: 0,
              xpPickups: [
                {
                  id: "raid-1-clanker-1-xp",
                  col: 4,
                  row: 5,
                  defenseXp: 25,
                  collected: false,
                },
              ],
              allClankersDead: true,
              breached: false,
              minerKilled: false,
              survived: true,
              reward: { vibes: 30, defenseXp: 25 },
            },
          },
        ];
      }
      if (query.includes("UPDATE players")) {
        throw new Error("reward should wait for pickup collection");
      }
      return [];
    });

    const result = await finishBunkerRaid(sql as never, "player-1");

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "collect raid XP pickups first",
    });
  });

  it("marks XP pickups collected when the miner overlaps their visible cell", async () => {
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT raid_id, snapshot")) {
        return [
          {
            raid_id: "raid-1",
            snapshot: {
              raidId: "raid-1",
              tier: 1,
              durationSeconds: 3,
              clankers: [],
              turretShots: 0,
              turretDamage: 0,
              spikeTriggers: 0,
              spikeDamage: 0,
              totalPartDurability: 180,
              incomingDamage: 100,
              partDamage: [],
              coreDamage: 0,
              xpPickups: [
                {
                  id: "raid-1-clanker-1-xp",
                  col: 4,
                  row: 5,
                  defenseXp: 25,
                  collected: false,
                },
              ],
              allClankersDead: true,
              breached: false,
              minerKilled: false,
              survived: true,
              reward: { vibes: 30, defenseXp: 25 },
            },
          },
        ];
      }
      if (query.includes("UPDATE bunker_raids")) return [];
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 0, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, core, parts")) return [];
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      if (query.includes("INSERT INTO player_base_parts")) return [];
      return [];
    });

    const missed = await collectBunkerRaidPickup(
      sql as never,
      "player-1",
      8,
      5,
    );
    expect(missed.ok).toBe(true);
    if (!missed.ok) return;
    expect(missed.raid.xpPickups[0]?.collected).toBe(false);

    const collected = await collectBunkerRaidPickup(
      sql as never,
      "player-1",
      5,
      5,
    );
    expect(collected.ok).toBe(true);
    if (!collected.ok) return;
    expect(collected.raid.xpPickups[0]?.collected).toBe(true);
    expect(collected.raid.reward.defenseXp).toBe(25);
  });

  it("reports collected defense XP, level-up rewards, and the first defense stamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T00:00:10.000Z"));
    vi.mocked(applyAchievementProgress).mockResolvedValueOnce([
      "survival-first-defense",
    ]);
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT raid_id, snapshot")) {
        return [
          {
            raid_id: "raid-1",
            started_at: "2026-06-18T00:00:00.000Z",
            duration_seconds: 180,
            snapshot: {
              raidId: "raid-1",
              tier: 1,
              durationSeconds: 180,
              clankers: [],
              turretShots: 0,
              turretDamage: 0,
              spikeTriggers: 0,
              spikeDamage: 0,
              totalPartDurability: 180,
              incomingDamage: 100,
              partDamage: [],
              coreDamage: 0,
              xpPickups: [
                {
                  id: "raid-1-clanker-1-xp",
                  col: 4,
                  row: 5,
                  defenseXp: 100,
                  collected: true,
                },
              ],
              allClankersDead: true,
              breached: false,
              minerKilled: false,
              survived: true,
              sealed: true,
              reward: { vibes: 30, defenseXp: 100 },
            },
          },
        ];
      }
      if (query.includes("UPDATE bunker_raids")) return [{ raid_id: "raid-1" }];
      if (query.includes("SELECT track_xp, defense_xp")) {
        return [{ track_xp: 0, defense_xp: 60 }];
      }
      if (query.includes("UPDATE players")) return [{ defense_xp: 160 }];
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 30, track_xp: 0, defense_xp: 160 }];
      }
      if (query.includes("SELECT footprint, core, parts")) return [];
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      return [];
    });

    const result = await finishBunkerRaid(sql as never, "player-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reward).toEqual({
      survived: true,
      vibesGained: 30,
      xpGained: 100,
      defenseXpBefore: 60,
      defenseXpAfter: 160,
      levelBefore: 1,
      levelAfter: 2,
      leveledUp: true,
      beaconLimitBefore: 2,
      beaconLimitAfter: 3,
      newStamps: ["survival-first-defense"],
    });
    expect(applyAchievementProgress).toHaveBeenCalledWith(sql, "player-1", {
      bunkerRaidsSurvived: 1,
      raidsSurvivedSealed: 1,
    });
  });

  it("adds missing starter base parts once for existing base inventories", async () => {
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ..._values: unknown[]) => {
        const query = strings.join(" ");
        if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
          return [{ emeralds: 30, track_xp: 0, defense_xp: 0 }];
        }
        if (query.includes("SELECT footprint, core, parts")) return [];
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
    });
    const insertedParts = sql.mock.calls
      .filter(([strings]) =>
        strings.join(" ").includes("INSERT INTO player_base_parts"),
      )
      .map((call) => call[2]);
    expect(insertedParts).toEqual(["floor-panel", "roof-panel"]);
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

  it("starts raids with clanker paths from the saved mine world", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T00:00:00.000Z"));
    const footprint = { col: 7, row: 6, width: 7, height: 5 };
    const diff = [
      [4, 5, { kind: "empty" }],
      [5, 5, { kind: "empty" }],
      [6, 5, { kind: "empty" }],
      [7, 5, { kind: "empty" }],
    ];
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 100, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, core, parts")) {
        return [
          { footprint, core: { col: 10, row: 8, durability: 160 }, parts: [] },
        ];
      }
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      if (query.includes("SELECT started_at")) return [];
      if (query.includes("SELECT seed, diff")) return [{ seed: 123, diff }];
      if (query.includes("UPDATE bunkers")) return [];
      if (query.includes("INSERT INTO bunker_raids")) return [];
      if (query.includes("INSERT INTO player_base_parts")) return [];
      return [];
    });

    const result = await startBunkerRaid(sql as never, "player-1", 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.raid.clankers[0]).toMatchObject({
      col: 4,
      row: 5,
      targetCol: 10,
      targetRow: 8,
    });
    expect(result.raid.clankers[0].path?.at(-1)).toEqual({
      col: 10,
      row: 8,
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
        if (query.includes("SELECT footprint, core, parts")) {
          return [
            {
              footprint,
              core: { col: 4, row: 3, durability: 140 },
              parts: damagedParts,
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
    // UPDATE: inspect the core/parts JSON bound into the UPDATE bunkers call.
    const updateCall = rich.mock.calls.find((call) =>
      (call[0] as TemplateStringsArray).join(" ").includes("UPDATE bunkers"),
    );
    expect(updateCall).toBeDefined();
    const bound = ((updateCall ?? []) as unknown[])
      .slice(1)
      .filter((value): value is string => typeof value === "string");
    const coreJson = bound.find(
      (value) => value.includes('"durability"') && !value.includes('"partId"'),
    );
    const partsJson = bound.find((value) => value.includes('"partId"'));
    expect(coreJson).toBeDefined();
    expect(partsJson).toBeDefined();
    expect(JSON.parse(coreJson ?? "{}").durability).toBe(160);
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
        if (query.includes("SELECT footprint, core, parts")) {
          return [
            {
              footprint,
              core: { col: 4, row: 3, depth: 0, durability: 100 },
              parts: [
                { partId: "wall-panel", col: 3, row: 3, durability: 90 },
                { partId: "wall-panel", col: 5, row: 3, durability: 45 },
                { partId: "door-panel", col: 4, row: 2, durability: 60 },
              ],
              dug: [{ col: 4, row: 3, depth: 1 }],
              skin: "gilded",
              skins_owned: ["gilded"],
            },
          ];
        }
        if (query.includes("SELECT snapshot")) {
          return activeRaid ? [{ snapshot: { raidId: "raid-live" } }] : [];
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

    // One UPDATE persists the emptied parts, refilled rock, and the
    // restored core together.
    const updateCall = sql.mock.calls.find((call) =>
      (call[0] as TemplateStringsArray).join(" ").includes("UPDATE bunkers"),
    );
    expect(updateCall).toBeDefined();
    const updateQuery = (
      (updateCall?.[0] ?? []) as unknown as TemplateStringsArray
    ).join(" ");
    expect(updateQuery).toContain("SET parts");
    expect(updateQuery).toContain("dug");
    expect(updateQuery).toContain("core");
    const bound = ((updateCall ?? []) as unknown[]).slice(1);
    expect(bound[0]).toBe("[]");
    expect(bound[1]).toBe("[]");
    expect(JSON.parse(String(bound[2])).durability).toBe(160);

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
      if (query.includes("SELECT footprint, core, parts")) return [];
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
        if (query.includes("SELECT footprint, core, parts")) {
          return [
            {
              footprint,
              core: { col: 4, row: 3, durability: 160 },
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

  it("rejects a raid tier above the player's level gate (F-084)", async () => {
    const footprint = { col: 1, row: 1, width: 7, height: 5 };
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        // Level 1 player: only tier 1 is startable.
        return [{ emeralds: 100, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, core, parts")) {
        return [
          { footprint, core: { col: 4, row: 3, durability: 160 }, parts: [] },
        ];
      }
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      if (query.includes("SELECT started_at")) return [];
      if (query.includes("SELECT seed, diff")) return [{ seed: 5, diff: [] }];
      return [];
    });

    const result = await startBunkerRaid(sql as never, "player-1", 3);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.error).toContain("unlocks at player level");
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
});

describe("bunker depth normalization", () => {
  it("normalizes legacy bunker rows without depth onto the tunnel plane", async () => {
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp")) {
        return [{ emeralds: 30, track_xp: 0, defense_xp: 0 }];
      }
      if (query.includes("SELECT footprint, core, parts")) {
        return [
          {
            footprint: { col: 1, row: 4, width: 7, height: 5 },
            core: { col: 4, row: 6, durability: 160 },
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

    expect(view.bunker?.core).toMatchObject({ col: 4, row: 6, depth: 0 });
    expect(view.bunker?.parts).toEqual([
      { partId: "wall-panel", col: 1, row: 4, depth: 0, durability: 90 },
      { partId: "door-panel", col: 2, row: 4, depth: 0, durability: 60 },
    ]);
    expect(view.bunker?.dug).toEqual([]);
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
        if (query.includes("SELECT footprint, core, parts")) {
          return [
            {
              footprint: { col: 1, row: 4, width: 7, height: 5 },
              core: { col: 4, row: 6, depth: 0, durability: 160 },
              parts: [],
              dug: [],
            },
          ];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) {
          return [{ part_id: "wall-panel", count: 2 }];
        }
        if (query.includes("UPDATE bunkers")) {
          writes.push(values.map(String).join("|"));
          return [];
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
        if (query.includes("SELECT footprint, core, parts")) {
          return [
            {
              footprint: { col: 1, row: 4, width: 7, height: 5 },
              core: { col: 4, row: 6, depth: 0, durability: 160 },
              parts: [],
              dug: [
                { col: 2, row: 5, depth: 1 },
                { col: 2, row: 5, depth: 2 },
                { col: 2, row: 5, depth: 3 },
              ],
            },
          ];
        }
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) {
          return [{ part_id: "wall-panel", count: 2 }];
        }
        if (query.includes("UPDATE bunkers")) {
          writes.push(values.map(String).join("|"));
          return [];
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
});
