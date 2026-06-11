import type { MatchScore } from "./combat";

/**
 * Deterministic reward tracks (Q-002): combat pays currency plus track
 * progress at known rates. No randomness anywhere; the same match result
 * always pays the same rewards. Track milestones that unlock parts live in
 * the economy slice; this module only computes the per-match earnings.
 */

export const CREDITS_WIN = 100;
export const CREDITS_DRAW = 40;
export const CREDITS_LOSS = 25;
/** Performance bonus: one credit per point of damage dealt, capped. */
export const CREDITS_DAMAGE_CAP = 100;

export const TRACK_XP_WIN = 50;
export const TRACK_XP_DRAW = 20;
export const TRACK_XP_LOSS = 10;
export const TRACK_XP_DAMAGE_CAP = 50;

export type MatchOutcome = "win" | "draw" | "loss";

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
  winner: 0 | 1 | null,
  scores: [MatchScore, MatchScore],
  side: 0 | 1,
): MatchRewards {
  const outcome = outcomeFor(winner, side);
  const dealt = scores[side].damageDealt;
  const base =
    outcome === "win"
      ? CREDITS_WIN
      : outcome === "draw"
        ? CREDITS_DRAW
        : CREDITS_LOSS;
  const xpBase =
    outcome === "win"
      ? TRACK_XP_WIN
      : outcome === "draw"
        ? TRACK_XP_DRAW
        : TRACK_XP_LOSS;
  return {
    outcome,
    credits: base + Math.min(Math.floor(dealt), CREDITS_DAMAGE_CAP),
    trackXp: xpBase + Math.min(Math.floor(dealt / 2), TRACK_XP_DAMAGE_CAP),
  };
}
