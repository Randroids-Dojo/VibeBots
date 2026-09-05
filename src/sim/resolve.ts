import {
  ARENAS,
  type ArenaId,
  createArenaWorld,
  DEFAULT_ARENA_ID,
} from "./arena";
import {
  combatStateString,
  createMatch,
  freeMatch,
  type MatchStatus,
  stepMatch,
  teardownInputFrom,
} from "./combat";
import { SIM_VERSION } from "./constants";
import type { BotDesign } from "./design";
import { fnv1a64 } from "./hash";
import { computeRewards, type MatchRewards, outcomeFor } from "./rewards";
import { buildTeardown, type MatchTeardown } from "./telemetry";

/**
 * Runs a complete match to its end and fingerprints the result. This is
 * the official-result primitive (Q-003 hybrid authority): the browser
 * previews with the same code, the server's answer is the one that
 * counts, and matching hashes prove they saw the same fight.
 */

export interface ResolvedMatch {
  simVersion: number;
  /** The arena the fight ran in; part of what "the same fight" means. */
  arenaId: ArenaId;
  tick: number;
  status: MatchStatus;
  /** FNV-1a 64 over the final world snapshot plus the combat state. */
  hash: string;
  rewards: [MatchRewards, MatchRewards];
  /** The inspection sheet, when the caller asked for telemetry. */
  teardown: MatchTeardown | null;
}

export interface ResolveMatchOptions {
  /** Record impacts and return the post-match teardown sheet. */
  telemetry?: boolean;
  /** Starting arrangement index; 0 (default) is the historical spawn. */
  variation?: number;
  /** Which arena the fight runs in; the ring (default) is the historical floor. */
  arenaId?: ArenaId;
}

/** One hash for "the same fight": final snapshot plus combat state. */
export function matchResultHash(
  match: Parameters<typeof combatStateString>[0],
): string {
  const snapshotHash = fnv1a64(match.world.takeSnapshot());
  return fnv1a64(
    new TextEncoder().encode(`${snapshotHash}:${combatStateString(match)}`),
  );
}

export async function resolveMatch(
  designs: [BotDesign, BotDesign],
  timeLimitTicks?: number,
  options: ResolveMatchOptions = {},
): Promise<ResolvedMatch> {
  const arenaId = options.arenaId ?? DEFAULT_ARENA_ID;
  const world = await createArenaWorld(ARENAS[arenaId]);
  let match: ReturnType<typeof createMatch> | null = null;
  try {
    match = createMatch(world, designs, {
      timeLimitTicks,
      telemetry: options.telemetry,
      variation: options.variation,
    });
    while (!match.status.over) {
      stepMatch(match);
    }
    const status = match.status;
    if (!status.over) throw new Error("match loop ended without a result");
    const hash = matchResultHash(match);
    const rewards: [MatchRewards, MatchRewards] = [
      computeRewards(outcomeFor(status.winner, 0), status.scores[0]),
      computeRewards(outcomeFor(status.winner, 1), status.scores[1]),
    ];
    const teardownInput = teardownInputFrom(match);
    return {
      simVersion: SIM_VERSION,
      arenaId,
      tick: match.tick,
      status,
      hash,
      rewards,
      teardown: teardownInput ? buildTeardown(teardownInput) : null,
    };
  } finally {
    if (match) freeMatch(match);
    world.free();
  }
}
