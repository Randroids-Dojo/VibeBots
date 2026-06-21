import { beforeEach, describe, expect, it, vi } from "vitest";
import { logMineClientDiagnosticEvent } from "@/server/monitoring";
import { getOrCreatePlayerId } from "@/server/player";
import { POST } from "./route";

vi.mock("@/server/monitoring", () => ({
  logMineClientDiagnosticEvent: vi.fn(),
}));

vi.mock("@/server/player", () => ({
  getOrCreatePlayerId: vi.fn(async () => "player-1"),
}));

const mockedLogMineClientDiagnosticEvent = vi.mocked(
  logMineClientDiagnosticEvent,
);
const mockedGetOrCreatePlayerId = vi.mocked(getOrCreatePlayerId);

function diagnostic(overrides: Record<string, unknown> = {}) {
  return {
    code: "touch_surface_missing",
    appVersion: "0.1.123",
    appBuild: 253,
    mineVersion: 48,
    activeSlot: 2,
    minerRow: 0,
    hasActiveBunker: true,
    bunkerPanelOpen: true,
    activeBunkerRaid: false,
    collectMode: false,
    creditsOpen: false,
    mineSceneReady: true,
    movementTouchEnabled: true,
    displayMode: "standalone",
    viewport: {
      width: 390,
      height: 760,
      visualWidth: 390,
      visualHeight: 760,
      visualScale: 1,
    },
    target: {
      tag: "CANVAS",
      role: null,
      ariaLabel: null,
      hasTouchSurface: false,
    },
    detail: "movement touch surface missing while surface movement enabled",
    ...overrides,
  };
}

function submit(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/mine/diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("mine diagnostics API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetOrCreatePlayerId.mockResolvedValue("player-1");
  });

  it("logs a bounded mine client diagnostic for the active player", async () => {
    const res = await submit(diagnostic());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ logged: true });
    expect(mockedGetOrCreatePlayerId).toHaveBeenCalledOnce();
    expect(mockedLogMineClientDiagnosticEvent).toHaveBeenCalledWith({
      severity: "warn",
      playerId: "player-1",
      ...diagnostic(),
    });
  });

  it("rejects invalid diagnostics", async () => {
    const res = await submit(
      diagnostic({
        code: "raw_console_dump",
        detail: "x".repeat(500),
      }),
    );

    expect(res.status).toBe(400);
    expect(mockedLogMineClientDiagnosticEvent).not.toHaveBeenCalled();
  });

  it("still logs when the active player cannot be resolved", async () => {
    mockedGetOrCreatePlayerId.mockRejectedValue(new Error("AUTH_SECRET unset"));

    const res = await submit(diagnostic({ code: "touch_surface_not_topmost" }));

    expect(res.status).toBe(200);
    expect(mockedLogMineClientDiagnosticEvent).toHaveBeenCalledWith({
      severity: "warn",
      playerId: undefined,
      ...diagnostic({ code: "touch_surface_not_topmost" }),
    });
  });

  it("rejects invalid JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/mine/diagnostics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(res.status).toBe(400);
    expect(mockedLogMineClientDiagnosticEvent).not.toHaveBeenCalled();
  });
});
