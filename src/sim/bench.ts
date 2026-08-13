import type { MatchEndReason } from "./combat";
import {
  type BotDesign,
  CPU_BRAWLER_DESIGN,
  CPU_BULLDOZER_DESIGN,
  CPU_WHIRLIGIG_DESIGN,
} from "./design";
import { REPLICA_OPPONENTS } from "./opponents";
import { PART_CATALOG } from "./parts";
import { resolveMatch } from "./resolve";

/**
 * Bench testing: fight a design against the whole stock roster headlessly
 * and report what happened, so a build change can be measured instead of
 * guessed at.
 *
 * The sim is deterministic and runs far faster than the real-time arena
 * (about 200ms for a full 60-second match), so a roster pass costs about a
 * second. That turns building from taste into measurement: change one
 * wheel, run the bench, watch the win rate move.
 *
 * Determinism note: a bench run has no seed of its own. Every match is the
 * same deterministic fight resolveMatch would produce, so the same design
 * against the same roster always yields the identical report.
 */

export interface BenchOpponentSpec {
  id: string;
  name: string;
  design: BotDesign;
}

/** The stock roster: the three CPU archetypes plus the replica opponents. */
export const BENCH_ROSTER: readonly BenchOpponentSpec[] = [
  { id: "brawler", name: CPU_BRAWLER_DESIGN.name, design: CPU_BRAWLER_DESIGN },
  {
    id: "bulldozer",
    name: CPU_BULLDOZER_DESIGN.name,
    design: CPU_BULLDOZER_DESIGN,
  },
  {
    id: "whirligig",
    name: CPU_WHIRLIGIG_DESIGN.name,
    design: CPU_WHIRLIGIG_DESIGN,
  },
  ...REPLICA_OPPONENTS.map((opponent) => ({
    id: opponent.id,
    name: opponent.name,
    design: opponent.design,
  })),
];

export type BenchOutcome = "win" | "loss" | "draw";

export interface BenchMatch {
  opponentId: string;
  opponentName: string;
  outcome: BenchOutcome;
  reason: MatchEndReason;
  ticks: number;
  damageDealt: number;
  damageTaken: number;
  partsLost: number;
  /** Catalog part ids the tested design lost, for the most-lost aggregate. */
  lostPartIds: string[];
  /** Tested design's timeout score minus the opponent's. */
  scoreMargin: number;
}

export interface BenchWeakPart {
  partId: string;
  name: string;
  /** Matches in which at least one instance of this part was destroyed. */
  matches: number;
  /** Total instances destroyed across the run. */
  losses: number;
}

export interface BenchReport {
  designName: string;
  matches: BenchMatch[];
  wins: number;
  losses: number;
  draws: number;
  /** Wins as a fraction of matches fought, 0..1. */
  winRate: number;
  /** Wins that ended by disabling the opponent rather than on score. */
  decisiveWins: number;
  /** Matches that ran out the clock instead of reaching a disable. */
  timeouts: number;
  /** Median ticks over decisive wins, or null when there were none. */
  medianTimeToKill: number | null;
  averageDamageDealt: number;
  averageDamageTaken: number;
  /** Parts this design loses most often, worst first. */
  weakestParts: BenchWeakPart[];
}

export interface BenchOptions {
  roster?: readonly BenchOpponentSpec[];
  timeLimitTicks?: number;
  /**
   * Awaited after each match. A UI caller passes a yield here so the bench
   * does not hold the main thread for the whole run; the sim itself stays
   * free of host timers.
   */
  onMatch?: (
    match: BenchMatch,
    index: number,
    total: number,
  ) => void | Promise<void>;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** How many decimals the reported averages keep. Raw floats read as noise. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function runBench(
  design: BotDesign,
  options: BenchOptions = {},
): Promise<BenchReport> {
  const roster = options.roster ?? BENCH_ROSTER;
  const matches: BenchMatch[] = [];

  for (const [index, opponent] of roster.entries()) {
    // Telemetry is on so the report can name which parts were lost; the
    // per-match cost is trivial next to the 3600 physics steps.
    const resolved = await resolveMatch(
      [design, opponent.design],
      options.timeLimitTicks,
      { telemetry: true },
    );
    const status = resolved.status;
    if (!status.over) throw new Error("bench match returned without a result");

    const mine = resolved.teardown?.bots[0];
    const outcome: BenchOutcome =
      status.winner === 0 ? "win" : status.winner === 1 ? "loss" : "draw";
    const match: BenchMatch = {
      opponentId: opponent.id,
      opponentName: opponent.name,
      outcome,
      reason: status.reason,
      ticks: resolved.tick,
      damageDealt: status.scores[0].damageDealt,
      damageTaken: status.scores[0].damageTaken,
      partsLost: mine?.partsLost ?? 0,
      lostPartIds:
        mine?.parts
          .filter((part) => part.destroyed)
          .map((part) => part.partId) ?? [],
      scoreMargin: status.scores[0].total - status.scores[1].total,
    };
    matches.push(match);
    await options.onMatch?.(match, index, roster.length);
  }

  const wins = matches.filter((m) => m.outcome === "win").length;
  const losses = matches.filter((m) => m.outcome === "loss").length;
  const draws = matches.filter((m) => m.outcome === "draw").length;
  const killTicks = matches
    .filter((m) => m.outcome === "win" && m.reason === "disable")
    .map((m) => m.ticks);

  const byPart = new Map<string, { matches: number; losses: number }>();
  for (const match of matches) {
    const seenThisMatch = new Set<string>();
    for (const partId of match.lostPartIds) {
      const entry = byPart.get(partId) ?? { matches: 0, losses: 0 };
      entry.losses += 1;
      if (!seenThisMatch.has(partId)) {
        entry.matches += 1;
        seenThisMatch.add(partId);
      }
      byPart.set(partId, entry);
    }
  }
  const weakestParts: BenchWeakPart[] = [...byPart.entries()]
    .map(([partId, entry]) => ({
      partId,
      name: PART_CATALOG[partId]?.name ?? partId,
      matches: entry.matches,
      losses: entry.losses,
    }))
    // Worst first; ties break on part id so the list never reshuffles.
    .sort((a, b) => {
      if (b.losses !== a.losses) return b.losses - a.losses;
      return a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0;
    });

  const count = matches.length || 1;
  return {
    designName: design.name,
    matches,
    wins,
    losses,
    draws,
    winRate: matches.length > 0 ? wins / matches.length : 0,
    decisiveWins: killTicks.length,
    timeouts: matches.filter((m) => m.reason === "timeout").length,
    medianTimeToKill: median(killTicks),
    averageDamageDealt: round2(
      matches.reduce((sum, m) => sum + m.damageDealt, 0) / count,
    ),
    averageDamageTaken: round2(
      matches.reduce((sum, m) => sum + m.damageTaken, 0) / count,
    ),
    weakestParts,
  };
}

export interface BenchDelta {
  opponentId: string;
  opponentName: string;
  before: BenchOutcome;
  after: BenchOutcome;
  changed: boolean;
  scoreMarginDelta: number;
}

export interface BenchComparison {
  winRateDelta: number;
  damageDealtDelta: number;
  damageTakenDelta: number;
  /** Per-opponent, in the order the matches were fought. */
  perOpponent: BenchDelta[];
  /** Opponents the change flipped from not-a-win to a win. */
  gained: string[];
  /** Opponents the change flipped from a win to not-a-win. */
  lost: string[];
}

/**
 * The A/B half of the loop: what did this build change actually do? Pure,
 * so it can be unit tested without running any physics.
 */
export function compareBench(
  before: BenchReport,
  after: BenchReport,
): BenchComparison {
  const beforeByOpponent = new Map(
    before.matches.map((match) => [match.opponentId, match]),
  );
  const perOpponent: BenchDelta[] = [];
  const gained: string[] = [];
  const lost: string[] = [];

  for (const match of after.matches) {
    const previous = beforeByOpponent.get(match.opponentId);
    if (!previous) continue;
    perOpponent.push({
      opponentId: match.opponentId,
      opponentName: match.opponentName,
      before: previous.outcome,
      after: match.outcome,
      changed: previous.outcome !== match.outcome,
      scoreMarginDelta: round2(match.scoreMargin - previous.scoreMargin),
    });
    if (previous.outcome !== "win" && match.outcome === "win") {
      gained.push(match.opponentName);
    }
    if (previous.outcome === "win" && match.outcome !== "win") {
      lost.push(match.opponentName);
    }
  }

  return {
    winRateDelta: round2(after.winRate - before.winRate),
    damageDealtDelta: round2(
      after.averageDamageDealt - before.averageDamageDealt,
    ),
    damageTakenDelta: round2(
      after.averageDamageTaken - before.averageDamageTaken,
    ),
    perOpponent,
    gained,
    lost,
  };
}
