import { beforeEach, describe, expect, it, vi } from "vitest";
import { logAppClientErrorEvent } from "@/server/monitoring";
import { getOrCreatePlayerId } from "@/server/player";
import { POST } from "./route";

vi.mock("@/server/monitoring", () => ({
  logAppClientErrorEvent: vi.fn(),
}));

vi.mock("@/server/player", () => ({
  getOrCreatePlayerId: vi.fn(async () => "player-1"),
}));

const mockedLogAppClientErrorEvent = vi.mocked(logAppClientErrorEvent);
const mockedGetOrCreatePlayerId = vi.mocked(getOrCreatePlayerId);

function clientError(overrides: Record<string, unknown> = {}) {
  return {
    code: "react_error_boundary",
    source: "app",
    appVersion: "0.1.142",
    path: "/mine",
    message: "Cannot read properties of undefined",
    digest: "digest-1",
    stack: "Error: Cannot read properties of undefined",
    ...overrides,
  };
}

function submit(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/client-errors", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Vitest",
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("client error API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetOrCreatePlayerId.mockResolvedValue("player-1");
  });

  it("logs a bounded app error for the active player", async () => {
    const res = await submit(clientError());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ logged: true });
    expect(mockedGetOrCreatePlayerId).toHaveBeenCalledOnce();
    expect(mockedLogAppClientErrorEvent).toHaveBeenCalledWith({
      severity: "error",
      playerId: "player-1",
      userAgent: "Vitest",
      ...clientError(),
    });
  });

  it("rejects invalid error payloads", async () => {
    const res = await submit(
      clientError({
        code: "raw_console_dump",
        stack: "x".repeat(3_000),
      }),
    );

    expect(res.status).toBe(400);
    expect(mockedLogAppClientErrorEvent).not.toHaveBeenCalled();
  });

  it("still logs when the active player cannot be resolved", async () => {
    mockedGetOrCreatePlayerId.mockRejectedValue(new Error("AUTH_SECRET unset"));

    const res = await submit(clientError({ source: "global" }));

    expect(res.status).toBe(200);
    expect(mockedLogAppClientErrorEvent).toHaveBeenCalledWith({
      severity: "error",
      playerId: undefined,
      userAgent: "Vitest",
      ...clientError({ source: "global" }),
    });
  });

  it("rejects invalid JSON", async () => {
    const res = await POST(
      new Request("http://localhost/api/client-errors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(res.status).toBe(400);
    expect(mockedLogAppClientErrorEvent).not.toHaveBeenCalled();
  });
});
