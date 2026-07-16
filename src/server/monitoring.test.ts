import { describe, expect, it, vi } from "vitest";
import {
  logAccountLinkEvent,
  logAppClientErrorEvent,
  logElevatorOutcomeEvent,
  logMineCashOutEvent,
  logMineClientDiagnosticEvent,
} from "./monitoring";

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

describe("mine client diagnostic monitoring", () => {
  it("writes warn JSON without exposing raw player ids", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    logMineClientDiagnosticEvent({
      code: "touch_surface_missing",
      severity: "warn",
      playerId: "player-1",
      activeSlot: 2,
      minerRow: 0,
      hasActiveBunker: true,
      bunkerPanelOpen: true,
      movementTouchEnabled: true,
      detail: "movement touch surface missing while surface movement enabled",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const raw = String(spy.mock.calls[0][0]);
    expect(raw).not.toContain("player-1");
    expect(JSON.parse(raw)).toMatchObject({
      source: "vibebots",
      component: "mine.client_diagnostic",
      event: "mine.client_diagnostic.touch_surface_missing",
      alert: true,
      severity: "warn",
      code: "touch_surface_missing",
      activeSlot: 2,
      minerRow: 0,
      hasActiveBunker: true,
      bunkerPanelOpen: true,
      movementTouchEnabled: true,
    });

    spy.mockRestore();
  });
});

describe("app client error monitoring", () => {
  it("writes error JSON without exposing raw player ids", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logAppClientErrorEvent({
      code: "react_error_boundary",
      severity: "error",
      playerId: "player-1",
      source: "app",
      appVersion: "0.1.142",
      path: "/mine",
      message: "Cannot read properties of undefined",
      digest: "digest-1",
      stack: "Error: Cannot read properties of undefined",
      userAgent: "Vitest",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const raw = String(spy.mock.calls[0][0]);
    expect(raw).not.toContain("player-1");
    expect(JSON.parse(raw)).toMatchObject({
      source: "vibebots",
      component: "app.client_error",
      event: "app.client_error.react_error_boundary",
      alert: true,
      severity: "error",
      code: "react_error_boundary",
      errorSource: "app",
      appVersion: "0.1.142",
      path: "/mine",
      digest: "digest-1",
    });

    spy.mockRestore();
  });
});

describe("account link monitoring", () => {
  it("hashes account and player ids without logging profile data", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    logAccountLinkEvent({
      code: "claim_conflict",
      severity: "warn",
      provider: "clerk",
      subject: "clerk-user-1",
      playerId: "guest-player",
      targetPlayerId: "cloud-player",
      result: "conflict",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const raw = String(spy.mock.calls[0][0]);
    expect(raw).not.toContain("clerk-user-1");
    expect(raw).not.toContain("guest-player");
    expect(raw).not.toContain("cloud-player");
    const parsed = JSON.parse(raw);
    expect(parsed).toMatchObject({
      source: "vibebots",
      component: "account.link",
      event: "account.link.claim_conflict",
      alert: true,
      severity: "warn",
      code: "claim_conflict",
      provider: "clerk",
      result: "conflict",
    });
    expect(parsed.account).toMatch(/^[0-9a-f]{16}$/);
    expect(parsed.player).toMatch(/^[0-9a-f]{16}$/);
    expect(parsed.targetPlayer).toMatch(/^[0-9a-f]{16}$/);

    spy.mockRestore();
  });
});

describe("elevator mutation-outcome monitoring", () => {
  it("writes info JSON with no reason for an accepted mutation", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    logElevatorOutcomeEvent({
      operation: "extend",
      result: "accepted",
      reason: null,
      playerId: "player-1",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const raw = String(spy.mock.calls[0][0]);
    expect(raw).not.toContain("player-1");
    const parsed = JSON.parse(raw);
    expect(parsed).toMatchObject({
      source: "vibebots",
      component: "elevator.upgrade",
      event: "elevator.upgrade.accepted",
      alert: false,
      severity: "info",
      operation: "extend",
      result: "accepted",
    });
    expect(parsed).not.toHaveProperty("reason");
    expect(parsed.player).toMatch(/^[0-9a-f]{16}$/);

    spy.mockRestore();
  });

  it("writes non-alarming info JSON with the reason for a rejected mutation", () => {
    // A routine reject (insufficient balance, stale-rail guard, and the like) is
    // a normal product outcome, so it must not page: info severity, alert false.
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logElevatorOutcomeEvent({
      operation: "place",
      result: "rejected",
      reason: "elevator-stale-rail-state",
      playerId: "player-1",
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(infoSpy.mock.calls[0][0]));
    expect(parsed).toMatchObject({
      component: "elevator.upgrade",
      event: "elevator.upgrade.rejected",
      alert: false,
      severity: "info",
      operation: "place",
      result: "rejected",
      reason: "elevator-stale-rail-state",
    });

    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("logs a pre-auth reject with a reason but no operation or player", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    logElevatorOutcomeEvent({
      result: "rejected",
      reason: "elevator-expected-depth-required",
    });

    const parsed = JSON.parse(String(spy.mock.calls[0][0]));
    expect(parsed).toMatchObject({
      component: "elevator.upgrade",
      event: "elevator.upgrade.rejected",
      alert: false,
      severity: "info",
      result: "rejected",
      reason: "elevator-expected-depth-required",
    });
    expect(parsed).not.toHaveProperty("operation");
    expect(parsed).not.toHaveProperty("player");

    spy.mockRestore();
  });
});
