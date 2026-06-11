import { describe, expect, it } from "vitest";
import type { MatchScore } from "./combat";
import {
  CREDITS_DAMAGE_CAP,
  computeRewards,
  OUTCOME_PAY,
  outcomeFor,
} from "./rewards";

function score(damageDealt: number): MatchScore {
  return {
    damageDealt,
    damageTaken: 0,
    partsRemaining: 4,
    partCount: 4,
    healthRemaining: 510,
    healthTotal: 510,
    pressureTicks: 0,
    mobileAtEnd: true,
    total: 0,
  };
}

describe("rewards", () => {
  it("maps winners and losers to outcomes per side", () => {
    expect(outcomeFor(0, 0)).toBe("win");
    expect(outcomeFor(0, 1)).toBe("loss");
    expect(outcomeFor(null, 0)).toBe("draw");
    expect(outcomeFor(null, 1)).toBe("draw");
  });

  it("pays the winner more than the loser for the same performance", () => {
    const win = computeRewards("win", score(30));
    const loss = computeRewards("loss", score(30));
    expect(win.credits).toBeGreaterThan(loss.credits);
    expect(win.credits).toBe(OUTCOME_PAY.win.credits + 30);
    expect(loss.credits).toBe(OUTCOME_PAY.loss.credits + 30);
  });

  it("caps the damage bonus", () => {
    const r = computeRewards("win", score(10000));
    expect(r.credits).toBe(OUTCOME_PAY.win.credits + CREDITS_DAMAGE_CAP);
  });

  it("is deterministic", () => {
    expect(computeRewards("loss", score(42.7))).toEqual(
      computeRewards("loss", score(42.7)),
    );
  });
});
