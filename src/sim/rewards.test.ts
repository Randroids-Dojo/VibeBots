import { describe, expect, it } from "vitest";
import type { MatchScore } from "./combat";
import {
  CREDITS_DAMAGE_CAP,
  CREDITS_LOSS,
  CREDITS_WIN,
  computeRewards,
} from "./rewards";

function score(damageDealt: number): MatchScore {
  return {
    damageDealt,
    damageTaken: 0,
    partsRemaining: 4,
    partCount: 4,
    pressureTicks: 0,
    distanceTraveled: 0,
    total: 0,
  };
}

describe("computeRewards", () => {
  it("pays the winner more than the loser for the same performance", () => {
    const scores: [MatchScore, MatchScore] = [score(30), score(30)];
    const win = computeRewards(0, scores, 0);
    const loss = computeRewards(0, scores, 1);
    expect(win.outcome).toBe("win");
    expect(loss.outcome).toBe("loss");
    expect(win.credits).toBeGreaterThan(loss.credits);
    expect(win.credits).toBe(CREDITS_WIN + 30);
    expect(loss.credits).toBe(CREDITS_LOSS + 30);
  });

  it("treats a null winner as a draw for both sides", () => {
    const scores: [MatchScore, MatchScore] = [score(0), score(0)];
    expect(computeRewards(null, scores, 0).outcome).toBe("draw");
    expect(computeRewards(null, scores, 1).outcome).toBe("draw");
  });

  it("caps the damage bonus", () => {
    const scores: [MatchScore, MatchScore] = [score(10000), score(0)];
    const r = computeRewards(0, scores, 0);
    expect(r.credits).toBe(CREDITS_WIN + CREDITS_DAMAGE_CAP);
  });

  it("is deterministic", () => {
    const scores: [MatchScore, MatchScore] = [score(42.7), score(13.2)];
    expect(computeRewards(1, scores, 0)).toEqual(computeRewards(1, scores, 0));
  });
});
