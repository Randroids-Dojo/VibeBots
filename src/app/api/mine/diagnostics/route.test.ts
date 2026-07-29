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

  it("accepts the unbanked-carving report with its cash-out context", async () => {
    // The one save-loss shape the server cannot observe for itself: a
    // bank that was refused or never sent leaves no request behind, so
    // the client has to say so (F-220). The cash-out state and the size
    // of the stranded log are what make the report actionable.
    const report = {
      code: "surfaced_carving_unbanked",
      appVersion: "0.1.289",
      appBuild: 1,
      mineVersion: 58,
      activeSlot: 1,
      minerRow: 0,
      cashOutState: "unavailable",
      moveCount: 42,
    };

    const res = await submit(report);

    expect(res.status).toBe(200);
    expect(mockedLogMineClientDiagnosticEvent).toHaveBeenCalledWith({
      severity: "warn",
      playerId: "player-1",
      ...report,
    });
  });

  it("rejects an unbounded cash-out state on the unbanked report", async () => {
    // The field is forwarded straight into monitoring, so it stays an
    // enum rather than a free string: a client bug or a widened union
    // must not become an unbounded log dimension.
    const res = await submit({
      code: "surfaced_carving_unbanked",
      cashOutState: "something-unexpected",
    });

    expect(res.status).toBe(400);
    expect(mockedLogMineClientDiagnosticEvent).not.toHaveBeenCalled();
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
