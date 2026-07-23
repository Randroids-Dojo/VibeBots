import { afterEach, describe, expect, it, vi } from "vitest";
import { BUNKER_RAID_COOLDOWN_CODE } from "@/lib/api-codes";
import { BUNKER_LAYOUT_VERSION } from "@/sim/bunker";
import {
  BUNKER_RAID_LIVE_VERSION,
  type LiveRaidOutcomeReport,
} from "@/sim/bunker-raid-live";
import {
  forfeitLiveRaid,
  loadBunkerView,
  placeBunkerPart,
  resolveLiveRaid,
  startLiveRaid,
} from "./bunker";

const FOOTPRINT = { col: 1, row: 1, width: 7, height: 5 };

/** A bunkers-table row with one wall at an arbitrary (unworn) durability. */
function bunkerRow(durability: number) {
  return {
    footprint: FOOTPRINT,
    parts: [{ partId: "wall-panel", col: 3, row: 3, durability, depth: 1 }],
    dug: [{ col: 3, row: 3, depth: 1 }],
    block_seed: null,
    loot: [],
    skin: null,
    skins_owned: [],
    revision: 2,
    layout_version: BUNKER_LAYOUT_VERSION,
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
        if (query.includes("SELECT footprint, parts")) return [bunkerRow(88)];
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

  it("rejects a start inside the cooldown window with the view attached", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T01:00:00.000Z"));
    // The last raid settled but started only an hour ago: the gate reads
    // the deadline the view computed and ships that view in the 409 body,
    // so a stale client adopts the countdown instead of a silent no-op.
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp"))
        return [{ emeralds: 100, track_xp: 500, defense_xp: 500 }];
      if (query.includes("SELECT footprint, parts")) return [bunkerRow(88)];
      if (query.includes("SELECT snapshot"))
        return [
          {
            snapshot: liveSnapshot(88, "live-done"),
            raid_version: BUNKER_RAID_LIVE_VERSION,
            started_at: new Date("2026-07-15T00:00:00.000Z").toISOString(),
            result: { outcome: "lost" },
          },
        ];
      if (query.includes("SELECT part_id, count")) return [];
      return [];
    });

    const result = await startLiveRaid(sql as never, "player-1", 1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toBe("raid cooldown active: 3h remaining");
    expect(result.code).toBe(BUNKER_RAID_COOLDOWN_CODE);
    expect(
      (result.body as { nextRaidAvailableAtMs?: number })
        ?.nextRaidAvailableAtMs,
    ).toBe(new Date("2026-07-15T04:00:00.000Z").getTime());
    // No raid row was inserted for the rejected start.
    expect(
      sql.mock.calls.some(([strings]) =>
        (strings as TemplateStringsArray)
          .join(" ")
          .includes("INSERT INTO bunker_raids"),
      ),
    ).toBe(false);
  });

  it("rejects a start while a live raid is already active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp"))
        return [{ emeralds: 100, track_xp: 500, defense_xp: 500 }];
      if (query.includes("SELECT footprint, parts")) return [bunkerRow(88)];
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

  it("refuses to start a raid on a layout-incompatible bunker (F-117)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
    // A legacy row carries no layout_version, so it reads as incompatible.
    const legacyRow = { ...bunkerRow(88), layout_version: 0 };
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp"))
        return [{ emeralds: 100, track_xp: 500, defense_xp: 500 }];
      if (query.includes("SELECT footprint, parts")) return [legacyRow];
      if (query.includes("SELECT snapshot")) return [];
      if (query.includes("SELECT part_id, count")) return [];
      return [];
    });

    const result = await startLiveRaid(sql as never, "player-1", 2);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.code).toBe("bunker-layout-incompatible");
    }
    // It never freezes a snapshot: no raid row is inserted, so no old layout
    // can ever run a raid whose settlement could race a Start fresh.
    expect(
      sql.mock.calls.some((c) =>
        (c[0] as TemplateStringsArray)
          .join(" ")
          .includes("INSERT INTO bunker_raids"),
      ),
    ).toBe(false);
  });
});

describe("loadBunkerView live raid discrimination", () => {
  const baseSql =
    (raidRows: unknown[]) => async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT emeralds, track_xp, defense_xp"))
        return [{ emeralds: 100, track_xp: 500, defense_xp: 500 }];
      if (query.includes("SELECT footprint, parts")) return [bunkerRow(88)];
      if (query.includes("SELECT snapshot")) return raidRows;
      if (query.includes("SELECT part_id, count")) return [];
      return [];
    };

  it("exposes an active live raid", async () => {
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

    expect(view.activeLiveRaid?.raidId).toBe("live-active");
    expect(view.activeLiveRaid?.tier).toBe(2);
  });

  it("resolves a legacy snapshot whose frozen bunker still carries a core (F-118)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
    // A snapshot frozen before the core was removed serialized one into its
    // bunker; the new parser must ignore it, not crash, and expose the raid.
    const legacy = liveSnapshot(88, "live-legacy");
    (legacy.bunker as Record<string, unknown>).core = {
      col: 4,
      row: 3,
      depth: 0,
      durability: 160,
    };
    const sql = vi.fn(
      baseSql([
        {
          snapshot: legacy,
          raid_version: BUNKER_RAID_LIVE_VERSION,
          started_at: new Date().toISOString(),
        },
      ]),
    );

    const view = await loadBunkerView(sql as never, "player-1");

    expect(view.activeLiveRaid?.raidId).toBe("live-legacy");
    expect(view.activeLiveRaid?.bunker).not.toHaveProperty("core");
    expect(view.activeLiveRaid?.bunker.parts).toHaveLength(1);
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

    expect(view.activeLiveRaid).toBeNull();
  });

  it("exposes the raid cooldown deadline from the newest start, settled or not", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T01:00:00.000Z"));
    // The raid settled an hour ago; the 4h cooldown still runs from its
    // start, so the view carries the deadline the HUD counts down to (from
    // the same newest-row query that drives active-raid discrimination).
    const startedAt = new Date("2026-07-15T00:00:00.000Z");
    const sql = vi.fn(
      baseSql([
        {
          snapshot: liveSnapshot(88, "live-settled"),
          raid_version: BUNKER_RAID_LIVE_VERSION,
          started_at: startedAt.toISOString(),
          result: { outcome: "lost" },
        },
      ]),
    );

    const view = await loadBunkerView(sql as never, "player-1");

    expect(view.activeLiveRaid).toBeNull();
    expect(view.nextRaidAvailableAtMs).toBe(
      startedAt.getTime() + 4 * 60 * 60 * 1000,
    );
  });

  it("reports no cooldown once the window has passed, and none with no raids", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T05:00:00.001Z"));
    const staleSql = vi.fn(
      baseSql([
        {
          snapshot: liveSnapshot(88, "live-old"),
          raid_version: BUNKER_RAID_LIVE_VERSION,
          started_at: new Date("2026-07-15T00:00:00.000Z").toISOString(),
          result: { outcome: "won" },
        },
      ]),
    );
    expect(
      (await loadBunkerView(staleSql as never, "player-1"))
        .nextRaidAvailableAtMs,
    ).toBeNull();

    const emptySql = vi.fn(baseSql([]));
    expect(
      (await loadBunkerView(emptySql as never, "player-1"))
        .nextRaidAvailableAtMs,
    ).toBeNull();
  });

  it("settles a past-grace live raid as a forfeit loss on load", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T01:00:00.000Z"));
    const queries: string[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      queries.push(query);
      if (query.includes("SELECT emeralds, track_xp, defense_xp"))
        return [{ emeralds: 100, track_xp: 500, defense_xp: 500 }];
      if (query.includes("SELECT footprint, parts")) return [bunkerRow(88)];
      if (query.includes("SELECT snapshot"))
        return [
          {
            snapshot: liveSnapshot(88, "live-stale"),
            raid_version: BUNKER_RAID_LIVE_VERSION,
            started_at: new Date("2026-07-15T00:00:00.000Z").toISOString(),
          },
        ];
      if (query.includes("SELECT part_id, count")) return [];
      return [];
    });

    const view = await loadBunkerView(sql as never, "player-1");

    expect(view.activeLiveRaid).toBeNull();
    // The abandoned raid is settled as a forfeit loss now, not left open.
    expect(queries.some((q) => q.includes("UPDATE bunker_raids"))).toBe(true);
  });

  it("freezes bunker edits while a live raid is active", async () => {
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

    const result = await placeBunkerPart(
      sql as never,
      "player-1",
      "wall-panel",
      2,
      2,
      1,
    );

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "finish the raid first",
    });
    // The edit was rejected before any write.
    expect(sql.mock.calls.some((c) => c[0].join(" ").includes("UPDATE"))).toBe(
      false,
    );
  });
});

describe("resolveLiveRaid (F-105/F-106)", () => {
  const WON_REPORT: LiveRaidOutcomeReport = {
    version: BUNKER_RAID_LIVE_VERSION,
    raidId: "live-existing",
    outcome: "won",
    minerKilled: false,
    sealed: true,
    endedTick: 30,
    clankersKilled: 2,
    defenseXp: 40,
    partWear: [
      { partId: "wall-panel", col: 3, row: 3, depth: 1, durability: 20 },
    ],
  };

  /** A resolve-path sql mock: serves the active row, controls the settle CAS,
   * and records every query plus the parts written to the bunker. */
  function makeResolveSql({
    activeRow = true,
    casClaimed = true,
  }: {
    activeRow?: boolean;
    casClaimed?: boolean;
  } = {}) {
    const queries: string[] = [];
    let writtenParts: Array<{ durability: number }> | null = null;
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        queries.push(query);
        if (query.includes("SELECT raid_id, tier, snapshot"))
          return activeRow
            ? [
                {
                  raid_id: "live-existing",
                  tier: 2,
                  snapshot: liveSnapshot(88, "live-existing"),
                },
              ]
            : [];
        if (query.includes("UPDATE bunker_raids"))
          return casClaimed ? [{ raid_id: "live-existing" }] : [];
        if (query.includes("UPDATE bunkers")) {
          writtenParts = JSON.parse(values[0] as string);
          return [];
        }
        if (query.includes("SELECT track_xp, defense_xp"))
          return [{ track_xp: 1000, defense_xp: 500 }];
        if (query.includes("UPDATE players")) return [{ defense_xp: 540 }];
        // loadBunkerView after resolution: the raid is settled, so no active row.
        if (query.includes("SELECT emeralds, track_xp, defense_xp"))
          return [{ emeralds: 100, track_xp: 1000, defense_xp: 540 }];
        if (query.includes("SELECT footprint, parts")) return [bunkerRow(20)];
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) return [];
        return [];
      },
    );
    return { sql, queries, writtenParts: () => writtenParts };
  }

  it("settles a survive: applies wear once and credits vibes and XP", async () => {
    const { sql, queries, writtenParts } = makeResolveSql();

    const result = await resolveLiveRaid(sql as never, "player-1", WON_REPORT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reward.survived).toBe(true);
    // Tier 2 survive: 20 base + 2 * 10 per tier, plus the reported defense XP.
    expect(result.reward.vibesGained).toBe(40);
    expect(result.reward.xpGained).toBe(40);
    expect(result.sealed).toBe(true);
    // The chewed wall's reduced durability is written back to the bunker.
    expect(writtenParts()?.[0]?.durability).toBe(20);
    expect(queries.some((q) => q.includes("UPDATE players"))).toBe(true);
  });

  it("guards the settled parts-write on the frozen layout version (F-117)", async () => {
    const { sql, queries } = makeResolveSql();

    const result = await resolveLiveRaid(sql as never, "player-1", WON_REPORT);

    expect(result.ok).toBe(true);
    // The parts-write carries the layout-version guard, so a Start fresh that
    // advanced the bunker between the raid-row claim and this write drops the
    // worn old parts instead of restoring them onto the freshly reset bunker.
    const bunkerWrite = queries.find((q) => q.includes("UPDATE bunkers"));
    expect(bunkerWrite).toBeDefined();
    expect(bunkerWrite).toContain("layout_version =");
  });

  it("contends the settled parts-write on the frozen bunker revision (F-106)", async () => {
    // A snapshot frozen at bunker revision 7. Claiming the raid row flips the
    // raid inactive, so an ordinary edit can then succeed at the same layout
    // version; contending the settlement write on the frozen revision makes it
    // lose to that edit (which already bumped the revision) instead of silently
    // overwriting the newer parts. Here the write matches zero rows, standing
    // in for that lost race; the resolve still succeeds and pays the reward.
    const queries: string[] = [];
    const bunkerWriteValues: unknown[] = [];
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        queries.push(query);
        if (query.includes("SELECT raid_id, tier, snapshot"))
          return [
            {
              raid_id: "live-existing",
              tier: 2,
              snapshot: { ...liveSnapshot(88, "live-existing"), revision: 7 },
            },
          ];
        if (query.includes("UPDATE bunker_raids"))
          return [{ raid_id: "live-existing" }];
        if (query.includes("UPDATE bunkers")) {
          bunkerWriteValues.push(...values);
          // Zero rows: a concurrent same-version edit already moved the
          // revision, so the settlement write misses and its parts do not land.
          return [];
        }
        if (query.includes("SELECT track_xp, defense_xp"))
          return [{ track_xp: 1000, defense_xp: 500 }];
        if (query.includes("UPDATE players")) return [{ defense_xp: 540 }];
        if (query.includes("SELECT emeralds, track_xp, defense_xp"))
          return [{ emeralds: 100, track_xp: 1000, defense_xp: 540 }];
        if (query.includes("SELECT footprint, parts")) return [bunkerRow(20)];
        return [];
      },
    );

    const result = await resolveLiveRaid(sql as never, "player-1", WON_REPORT);

    expect(result.ok).toBe(true);
    const bunkerWrite = queries.find((q) => q.includes("UPDATE bunkers"));
    expect(bunkerWrite).toBeDefined();
    // The write is contended on the frozen revision, and it is bound with the
    // snapshot's revision (7), so the DB refuses it when a concurrent edit has
    // moved the bunker on.
    expect(bunkerWrite).toContain("IS NULL OR revision =");
    expect(bunkerWriteValues).toContain(7);
    // The reward still lands even though the parts-write missed: settlement
    // does not depend on its parts-write winning.
    if (result.ok) expect(result.reward.survived).toBe(true);
  });

  it("rejects an invalid report with 422 and its reason", async () => {
    const { sql } = makeResolveSql();
    const bad = { ...WON_REPORT, defenseXp: 999999 };

    const result = await resolveLiveRaid(sql as never, "player-1", bad);

    expect(result).toEqual({
      ok: false,
      status: 422,
      error: "invalid raid outcome: reward-range",
    });
  });

  it("settles a loss with no reward but still applies defense wear", async () => {
    const { sql, queries, writtenParts } = makeResolveSql();
    const lossReport: LiveRaidOutcomeReport = {
      ...WON_REPORT,
      outcome: "lost",
      minerKilled: true,
      sealed: false,
      defenseXp: 0,
    };

    const result = await resolveLiveRaid(sql as never, "player-1", lossReport);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reward.survived).toBe(false);
    expect(result.reward.vibesGained).toBe(0);
    expect(result.reward.xpGained).toBe(0);
    // Damage stands on a loss: the wall is still written worn.
    expect(writtenParts()?.[0]?.durability).toBe(20);
    // No survive means no reward credit to the player.
    expect(queries.some((q) => q.includes("UPDATE players"))).toBe(false);
  });

  it("refuses a second resolve after the row is already settled", async () => {
    const { sql } = makeResolveSql({ casClaimed: false });

    const result = await resolveLiveRaid(sql as never, "player-1", WON_REPORT);

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "raid already finished",
    });
  });

  it("rejects a resolve when no live raid is active", async () => {
    const { sql } = makeResolveSql({ activeRow: false });

    const result = await resolveLiveRaid(sql as never, "player-1", WON_REPORT);

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "no active live raid",
    });
  });
});

describe("forfeitLiveRaid (F-160)", () => {
  /** A forfeit-path sql mock: records the forfeit UPDATE payload and serves a
   * loadBunkerView with no active raid (the row is settled by the forfeit). */
  function makeForfeitSql() {
    const queries: string[] = [];
    let forfeitPayload: unknown = null;
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const query = strings.join(" ");
        queries.push(query);
        if (query.includes("UPDATE bunker_raids")) {
          forfeitPayload = JSON.parse(values[0] as string);
          return [];
        }
        if (query.includes("SELECT emeralds, track_xp, defense_xp"))
          return [{ emeralds: 100, track_xp: 1000, defense_xp: 500 }];
        if (query.includes("SELECT footprint, parts")) return [bunkerRow(20)];
        // The forfeit settled the row, so loadBunkerView finds no active raid.
        if (query.includes("SELECT snapshot")) return [];
        if (query.includes("SELECT part_id, count")) return [];
        return [];
      },
    );
    return { sql, queries, forfeitPayload: () => forfeitPayload };
  }

  it("settles the active row as a no-reward forfeit and returns a raid-free view", async () => {
    const { sql, queries, forfeitPayload } = makeForfeitSql();

    const result = await forfeitLiveRaid(sql as never, "player-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A no-reward forfeit result is written to the raid row...
    expect(forfeitPayload()).toEqual({ outcome: "forfeit", survived: false });
    // ...guarded to the active live row only (so a finished raid is untouched).
    const forfeitQuery = queries.find((q) => q.includes("UPDATE bunker_raids"));
    expect(forfeitQuery).toContain("result IS NULL");
    expect(forfeitQuery).toContain("raid_version");
    // No player or bunker mutation runs: a forfeit costs no reward and no wear.
    expect(queries.some((q) => q.includes("UPDATE players"))).toBe(false);
    expect(queries.some((q) => q.includes("UPDATE bunkers"))).toBe(false);
    // The returned view shows the raid cleared, so re-entry cannot re-roll it.
    expect(result.view.activeLiveRaid).toBeNull();
  });
});
