import type { MatchScore } from "./combat";

/**
 * Deterministic reward tracks (Q-002): combat pays currency plus track
 * progress at known rates. No randomness anywhere; the same match result
 * always pays the same rewards. Track milestones that unlock parts live in
 * the economy slice; this module only computes the per-match earnings.
 */

export type MatchOutcome = "win" | "draw" | "loss";

export const OUTCOME_PAY: Record<
  MatchOutcome,
  { credits: number; trackXp: number }
> = {
  win: { credits: 100, trackXp: 50 },
  draw: { credits: 40, trackXp: 20 },
  loss: { credits: 25, trackXp: 10 },
};

/** Performance bonus: one credit per point of damage dealt, capped. */
export const CREDITS_DAMAGE_CAP = 100;
export const TRACK_XP_DAMAGE_CAP = 50;

export interface MatchRewards {
  outcome: MatchOutcome;
  credits: number;
  trackXp: number;
}

export function outcomeFor(winner: 0 | 1 | null, side: 0 | 1): MatchOutcome {
  if (winner === null) return "draw";
  return winner === side ? "win" : "loss";
}

export function computeRewards(
  outcome: MatchOutcome,
  score: MatchScore,
): MatchRewards {
  const base = OUTCOME_PAY[outcome];
  const dealt = score.damageDealt;
  return {
    outcome,
    credits: base.credits + Math.min(Math.floor(dealt), CREDITS_DAMAGE_CAP),
    trackXp:
      base.trackXp + Math.min(Math.floor(dealt / 2), TRACK_XP_DAMAGE_CAP),
  };
}
