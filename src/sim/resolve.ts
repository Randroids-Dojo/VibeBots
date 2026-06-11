import { createArenaWorld } from "./arena";
import {
  combatStateString,
  createMatch,
  freeMatch,
  type MatchStatus,
  stepMatch,
} from "./combat";
import { SIM_VERSION } from "./constants";
import type { BotDesign } from "./design";
import { fnv1a64 } from "./hash";
import { computeRewards, type MatchRewards, outcomeFor } from "./rewards";

/**
 * Runs a complete match to its end and fingerprints the result. This is
 * the official-result primitive (Q-003 hybrid authority): the browser
 * previews with the same code, the server's answer is the one that
 * counts, and matching hashes prove they saw the same fight.
 */

export interface ResolvedMatch {
  simVersion: number;
  tick: number;
  status: MatchStatus;
  /** FNV-1a 64 over the final world snapshot plus the combat state. */
  hash: string;
  rewards: [MatchRewards, MatchRewards];
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
): Promise<ResolvedMatch> {
  const world = await createArenaWorld();
  const match = createMatch(world, designs, { timeLimitTicks });
  try {
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
    return {
      simVersion: SIM_VERSION,
      tick: match.tick,
      status,
      hash,
      rewards,
    };
  } finally {
    freeMatch(match);
    world.free();
  }
}
