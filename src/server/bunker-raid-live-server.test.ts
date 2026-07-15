import { afterEach, describe, expect, it, vi } from "vitest";
import { BUNKER_RAID_LIVE_VERSION } from "@/sim/bunker-raid-live";
import { loadBunkerView, startLiveRaid } from "./bunker";

const FOOTPRINT = { col: 1, row: 1, width: 7, height: 5 };
const CORE = { col: 4, row: 3, durability: 160, depth: 0 };

/** A bunkers-table row with one wall at an arbitrary (unworn) durability. */
function bunkerRow(durability: number) {
  return {
    footprint: FOOTPRINT,
    core: CORE,
    parts: [{ partId: "wall-panel", col: 3, row: 3, durability, depth: 1 }],
    dug: [{ col: 3, row: 3, depth: 1 }],
    block_seed: null,
    loot: [],
    skin: null,
    skins_owned: [],
    revision: 2,
  };
}

/** The frozen-snapshot jsonb shape a live raid row stores (bunker in row shape). */
function liveSnapshot(durability: number, raidId = "live-test") {
  return {
    version: BUNKER_RAID_LIVE_VERSION,
    raidId,
    tier: 2,
    durationSeconds: 180,
    bunker: bunkerRow(durability),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("startLiveRaid (F-108)", () => {
  it("freezes the current bunker with no wear and versions the row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
    const queries: string[] = [];
    let insertedSnapshot: unknown = null;
    let insertedVersion: unknown = null;

    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        queries.push(query);
        if (query.includes("SELECT emeralds, track_xp, defense_xp"))
          return [{ emeralds: 100, track_xp: 500, defense_xp: 500 }];
        if (query.includes("SELECT footprint, core, parts"))
          return [bunkerRow(88)];
        // The raid row is empty until the INSERT, then reads back the frozen row.
        if (query.includes("SELECT snapshot")) {
          return insertedSnapshot
            ? [
                {
                  snapshot: insertedSnapshot,
                  raid_version: insertedVersion,
                  started_at: new Date().toISOString(),
                },
              ]
            : [];
        }
        if (query.includes("SELECT part_id, count")) return [];
        if (query.includes("SELECT started_at")) return [];
        if (query.includes("INSERT INTO bunker_raids")) {
          insertedSnapshot = JSON.parse(values[3] as string);
          insertedVersion = values[5];
          return [];
        }
        return [];
      },
    );

    const result = await startLiveRaid(sql as never, "player-1", 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.liveRaid.tier).toBe(2);
    expect(result.liveRaid.durationSeconds).toBe(180);
    // The frozen defenses carry the current, unworn durability.
    expect(result.liveRaid.bunker.parts[0]?.durability).toBe(88);
    expect(insertedVersion).toBe(BUNKER_RAID_LIVE_VERSION);
    const frozen = insertedSnapshot as ReturnType<typeof liveSnapshot> | null;
    expect(frozen?.bunker.parts[0]?.durability).toBe(88);
    // Start applies no wear, so it never writes the bunkers table.
    expect(queries.some((q) => q.includes("UPDATE bunkers"))).toBe(false);
  });

  it("rejects a start while a live raid is already active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp"))
        return [{ emeralds: 100, track_xp: 500, defense_xp: 500 }];
      if (query.includes("SELECT footprint, core, parts"))
        return [bunkerRow(88)];
      if (query.includes("SELECT snapshot"))
        return [
          {
            snapshot: liveSnapshot(88, "live-existing"),
            raid_version: BUNKER_RAID_LIVE_VERSION,
            started_at: new Date().toISOString(),
          },
        ];
      if (query.includes("SELECT part_id, count")) return [];
      return [];
    });

    const result = await startLiveRaid(sql as never, "player-1", 2);

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "raid already active",
    });
  });
});

describe("loadBunkerView live raid discrimination", () => {
  const baseSql =
    (raidRows: unknown[]) => async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp"))
        return [{ emeralds: 100, track_xp: 500, defense_xp: 500 }];
      if (query.includes("SELECT footprint, core, parts"))
        return [bunkerRow(88)];
      if (query.includes("SELECT snapshot")) return raidRows;
      if (query.includes("SELECT part_id, count")) return [];
      return [];
    };

  it("exposes an active live raid and leaves the interim field null", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
    const sql = vi.fn(
      baseSql([
        {
          snapshot: liveSnapshot(88, "live-active"),
          raid_version: BUNKER_RAID_LIVE_VERSION,
          started_at: new Date().toISOString(),
        },
      ]),
    );

    const view = await loadBunkerView(sql as never, "player-1");

    expect(view.activeRaid).toBeNull();
    expect(view.activeLiveRaid?.raidId).toBe("live-active");
    expect(view.activeLiveRaid?.tier).toBe(2);
  });

  it("treats a live raid past duration plus grace as inactive", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T01:00:00.000Z"));
    // Started an hour before "now": far beyond 180s duration + 60s grace.
    const sql = vi.fn(
      baseSql([
        {
          snapshot: liveSnapshot(88, "live-stale"),
          raid_version: BUNKER_RAID_LIVE_VERSION,
          started_at: new Date("2026-07-15T00:00:00.000Z").toISOString(),
        },
      ]),
    );

    const view = await loadBunkerView(sql as never, "player-1");

    expect(view.activeRaid).toBeNull();
    expect(view.activeLiveRaid).toBeNull();
  });
});
