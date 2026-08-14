import { describe, expect, it } from "vitest";
import {
  BENCH_ROSTER,
  type BenchMatch,
  type BenchReport,
  compareBench,
  runBench,
} from "./bench";
import {
  type BotDesign,
  CPU_BRAWLER_DESIGN,
  CPU_WHIRLIGIG_DESIGN,
  TEST_BOT_DESIGN,
} from "./design";

/** A short roster keeps the physics-backed cases quick but real. */
const SHORT_ROSTER = [
  { id: "brawler", name: "Brawler", design: CPU_BRAWLER_DESIGN },
  { id: "whirligig", name: "Whirligig", design: CPU_WHIRLIGIG_DESIGN },
];

function match(over: Partial<BenchMatch> = {}): BenchMatch {
  return {
    opponentId: "brawler",
    opponentName: "Brawler",
    outcome: "loss",
    reason: "timeout",
    ticks: 3600,
    damageDealt: 10,
    damageTaken: 20,
    partsLost: 0,
    lostPartIds: [],
    scoreMargin: -5,
    ...over,
  };
}

function report(over: Partial<BenchReport> = {}): BenchReport {
  const matches = over.matches ?? [match()];
  return {
    designName: "Bot",
    matches,
    wins: 0,
    losses: 1,
    draws: 0,
    winRate: 0,
    decisiveWins: 0,
    timeouts: 1,
    medianTimeToKill: null,
    averageDamageDealt: 10,
    averageDamageTaken: 20,
    weakestParts: [],
    ...over,
  };
}

describe("BENCH_ROSTER", () => {
  it("covers the stock archetypes and the replicas without duplicate ids", () => {
    const ids = BENCH_ROSTER.map((opponent) => opponent.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("brawler");
    expect(ids).toContain("whirligig");
    expect(BENCH_ROSTER.length).toBeGreaterThanOrEqual(6);
  });
});

describe("runBench", () => {
  it("fights every opponent once and reports a consistent tally", async () => {
    const report = await runBench(TEST_BOT_DESIGN, { roster: SHORT_ROSTER });

    expect(report.designName).toBe(TEST_BOT_DESIGN.name);
    expect(report.matches).toHaveLength(SHORT_ROSTER.length);
    expect(report.matches.map((m) => m.opponentId)).toEqual([
      "brawler",
      "whirligig",
    ]);
    expect(report.wins + report.losses + report.draws).toBe(
      report.matches.length,
    );
    expect(report.winRate).toBeCloseTo(report.wins / report.matches.length, 6);
    for (const bout of report.matches) {
      expect(bout.ticks).toBeGreaterThan(0);
      expect(bout.damageDealt).toBeGreaterThanOrEqual(0);
      expect(bout.damageTaken).toBeGreaterThanOrEqual(0);
      expect(bout.partsLost).toBe(bout.lostPartIds.length);
    }
  }, 60000);

  it("is deterministic: the same design and roster give the same report", async () => {
    const first = await runBench(TEST_BOT_DESIGN, { roster: SHORT_ROSTER });
    const second = await runBench(TEST_BOT_DESIGN, { roster: SHORT_ROSTER });
    expect(second).toEqual(first);
  }, 90000);

  it("reports progress once per match, in order", async () => {
    const seen: Array<{ index: number; total: number; id: string }> = [];
    await runBench(TEST_BOT_DESIGN, {
      roster: SHORT_ROSTER,
      onMatch: (bout, index, total) => {
        seen.push({ index, total, id: bout.opponentId });
      },
    });
    expect(seen).toEqual([
      { index: 0, total: 2, id: "brawler" },
      { index: 1, total: 2, id: "whirligig" },
    ]);
  }, 60000);

  it("names the parts the design loses, resolved to catalog names", async () => {
    // The saw bot reliably takes parts off a plain rammer.
    const report = await runBench(TEST_BOT_DESIGN, {
      roster: [SHORT_ROSTER[1]],
    });
    const totalLost = report.matches.reduce((sum, m) => sum + m.partsLost, 0);
    if (totalLost > 0) {
      expect(report.weakestParts.length).toBeGreaterThan(0);
      for (const part of report.weakestParts) {
        // A resolved catalog name is never the raw id.
        expect(part.name).not.toBe(part.partId);
        expect(part.losses).toBeGreaterThanOrEqual(part.matches);
      }
      const worst = report.weakestParts[0].losses;
      for (const part of report.weakestParts) {
        expect(part.losses).toBeLessThanOrEqual(worst);
      }
    } else {
      expect(report.weakestParts).toEqual([]);
    }
  }, 60000);

  it("only counts a disable win toward time-to-kill", async () => {
    const report = await runBench(TEST_BOT_DESIGN, { roster: SHORT_ROSTER });
    const decisive = report.matches.filter(
      (m) => m.outcome === "win" && m.reason === "disable",
    );
    expect(report.decisiveWins).toBe(decisive.length);
    if (decisive.length === 0) {
      expect(report.medianTimeToKill).toBeNull();
    } else {
      expect(report.medianTimeToKill).toBeGreaterThan(0);
    }
    expect(report.timeouts).toBe(
      report.matches.filter((m) => m.reason === "timeout").length,
    );
  }, 60000);

  it("shows a real build change as a measurable difference", async () => {
    // Same chassis and drive, one carries a weapon and one does not. The
    // point of the bench is that this difference is legible in numbers.
    const unarmed: BotDesign = {
      ...TEST_BOT_DESIGN,
      name: "Unarmed",
      parts: TEST_BOT_DESIGN.parts.filter((p) => p.iid !== "spike"),
      connections: TEST_BOT_DESIGN.connections.filter(
        (c) => c.childIid !== "spike",
      ),
    };
    const armedReport = await runBench(TEST_BOT_DESIGN, {
      roster: SHORT_ROSTER,
    });
    const unarmedReport = await runBench(unarmed, { roster: SHORT_ROSTER });
    const comparison = compareBench(unarmedReport, armedReport);

    expect(comparison.perOpponent).toHaveLength(SHORT_ROSTER.length);
    // Some measurable difference exists between the two builds.
    const anyDifference =
      comparison.winRateDelta !== 0 ||
      comparison.damageDealtDelta !== 0 ||
      comparison.perOpponent.some((d) => d.scoreMarginDelta !== 0);
    expect(anyDifference).toBe(true);
  }, 120000);
});

describe("compareBench", () => {
  it("reports the win rate delta and which opponents flipped", () => {
    const before = report({
      matches: [
        match({ opponentId: "a", opponentName: "A", outcome: "loss" }),
        match({ opponentId: "b", opponentName: "B", outcome: "win" }),
      ],
      winRate: 0.5,
      averageDamageDealt: 10,
      averageDamageTaken: 20,
    });
    const after = report({
      matches: [
        match({
          opponentId: "a",
          opponentName: "A",
          outcome: "win",
          scoreMargin: 5,
        }),
        match({ opponentId: "b", opponentName: "B", outcome: "draw" }),
      ],
      winRate: 0.5,
      averageDamageDealt: 25,
      averageDamageTaken: 12,
    });

    const comparison = compareBench(before, after);
    expect(comparison.winRateDelta).toBe(0);
    expect(comparison.damageDealtDelta).toBe(15);
    expect(comparison.damageTakenDelta).toBe(-8);
    expect(comparison.gained).toEqual(["A"]);
    expect(comparison.lost).toEqual(["B"]);
    expect(comparison.perOpponent[0]).toMatchObject({
      opponentId: "a",
      before: "loss",
      after: "win",
      changed: true,
      scoreMarginDelta: 10,
    });
  });

  it("ignores opponents that only one side of the comparison fought", () => {
    const before = report({
      matches: [match({ opponentId: "a", opponentName: "A" })],
    });
    const after = report({
      matches: [
        match({ opponentId: "a", opponentName: "A" }),
        match({ opponentId: "new", opponentName: "New" }),
      ],
    });
    expect(compareBench(before, after).perOpponent).toHaveLength(1);
  });
});
