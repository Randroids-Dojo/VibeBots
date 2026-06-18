import { describe, expect, it, vi } from "vitest";
import { logMineCashOutEvent } from "./monitoring";

describe("mine cash-out monitoring", () => {
  it("writes alert-grade JSON without exposing raw player ids", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logMineCashOutEvent({
      code: "consumables_not_owned",
      severity: "error",
      playerId: "player-1",
      tripIndex: 2,
      moveCount: 9,
      detail: "paid consumable overclaim",
      submitted: { dynamite: 1 },
      owned: { dynamite: 0 },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const raw = String(spy.mock.calls[0][0]);
    expect(raw).not.toContain("player-1");
    expect(JSON.parse(raw)).toMatchObject({
      source: "vibebots",
      component: "mine.cash_out",
      event: "mine.cash_out.consumables_not_owned",
      alert: true,
      severity: "error",
      code: "consumables_not_owned",
      tripIndex: 2,
      moveCount: 9,
      detail: "paid consumable overclaim",
      submitted: { dynamite: 1 },
      owned: { dynamite: 0 },
    });

    spy.mockRestore();
  });

  it("writes info JSON without alerting for successful cash-outs", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    logMineCashOutEvent({
      code: "cash_out_succeeded",
      severity: "info",
      playerId: "player-1",
      tripIndex: 82,
      moveCount: 12,
      seed: 2155004236,
      mineVersion: 29,
      credited: { credits: 4, parts: 0 },
      remaining: { ladder: 1342, plank: 226 },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const raw = String(spy.mock.calls[0][0]);
    expect(raw).not.toContain("player-1");
    expect(JSON.parse(raw)).toMatchObject({
      source: "vibebots",
      component: "mine.cash_out",
      event: "mine.cash_out.cash_out_succeeded",
      alert: false,
      severity: "info",
      code: "cash_out_succeeded",
      tripIndex: 82,
      moveCount: 12,
      seed: 2155004236,
      mineVersion: 29,
      credited: { credits: 4, parts: 0 },
      remaining: { ladder: 1342, plank: 226 },
    });

    spy.mockRestore();
  });
});
