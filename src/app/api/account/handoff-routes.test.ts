import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeAccountHandoff,
  createAccountHandoff,
} from "@/server/account-handoff";
import { claimPlayerForAccount } from "@/server/account-linking";
import {
  accountProviderReady,
  currentReadyAccountIdentity,
  requestAccountSessionProvider,
} from "@/server/account-session";
import { accountSaveSummary } from "@/server/account-summary";
import { storageConfigured } from "@/server/db";
import { logAccountLinkEvent } from "@/server/monitoring";
import {
  currentPlayerId,
  SaveSlotPreserveError,
  setActiveSaveSlotPlayer,
} from "@/server/player";
import { POST as finish } from "./handoff/finish/route";
import { POST as start } from "./handoff/start/route";

vi.mock("@/server/db", () => ({
  db: vi.fn(async () => "sql"),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/player", () => ({
  currentPlayerId: vi.fn(async () => "guest-player"),
  SaveSlotPreserveError: class SaveSlotPreserveError extends Error {
    constructor() {
      super("no empty save slot available to preserve device save");
      this.name = "SaveSlotPreserveError";
    }
  },
  setActiveSaveSlotPlayer: vi.fn(async (playerId: string) => ({
    activeSlot: 1,
    slots: { "1": playerId },
  })),
}));

vi.mock("@/server/account-session", () => ({
  accountProviderReady: vi.fn(() => true),
  currentReadyAccountIdentity: vi.fn(async () => null),
  requestAccountSessionProvider: vi.fn(() => ({
    identity: async () => null,
    status: () => ({
      provider: "clerk",
      ready: true,
      reason: null,
      issues: [],
    }),
  })),
}));

vi.mock("@/server/account-handoff", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/account-handoff")
  >("@/server/account-handoff");
  return {
    ...actual,
    createAccountHandoff: vi.fn(async (_sql, playerId, returnTo) => ({
      token: "handoff-1",
      playerId,
      returnTo,
      expiresAt: "2026-07-04T00:10:00.000Z",
    })),
    consumeAccountHandoff: vi.fn(async () => ({
      token: "handoff-1",
      playerId: "guest-player",
      returnTo: "/mine",
      expiresAt: "2026-07-04T00:10:00.000Z",
    })),
  };
});

vi.mock("@/server/account-linking", () => ({
  claimPlayerForAccount: vi.fn(async () => ({
    status: "claimed",
    playerId: "guest-player",
  })),
}));

vi.mock("@/server/account-summary", () => ({
  accountSaveSummary: vi.fn(async () => ({
    exists: true,
    createdAt: "2026-07-04T00:00:00.000Z",
    balance: 12,
    deepestDepth: 8,
    partsOwned: 3,
    designs: 1,
    stamps: 2,
  })),
}));

vi.mock("@/server/monitoring", () => ({
  logAccountLinkEvent: vi.fn(),
}));

const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedCurrentPlayerId = vi.mocked(currentPlayerId);
const mockedAccountProviderReady = vi.mocked(accountProviderReady);
const mockedCurrentReadyAccountIdentity = vi.mocked(
  currentReadyAccountIdentity,
);
const mockedRequestAccountSessionProvider = vi.mocked(
  requestAccountSessionProvider,
);
const mockedCreateAccountHandoff = vi.mocked(createAccountHandoff);
const mockedConsumeAccountHandoff = vi.mocked(consumeAccountHandoff);
const mockedClaimPlayerForAccount = vi.mocked(claimPlayerForAccount);
const mockedSetActiveSaveSlotPlayer = vi.mocked(setActiveSaveSlotPlayer);
const mockedAccountSaveSummary = vi.mocked(accountSaveSummary);
const mockedLogAccountLinkEvent = vi.mocked(logAccountLinkEvent);

const identity = {
  provider: "clerk",
  subject: "clerk-user-1",
  email: "player@example.com",
};

function jsonRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://vibe-bots.test/api/account/handoff", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function expectNoStore(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
}

describe("/api/account/handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStorageConfigured.mockReturnValue(true);
    mockedAccountProviderReady.mockReturnValue(true);
    mockedRequestAccountSessionProvider.mockReturnValue({
      identity: async () => null,
      status: () => ({
        provider: "clerk",
        ready: true,
        reason: null,
        issues: [],
      }),
    });
    mockedCurrentPlayerId.mockResolvedValue("guest-player");
    mockedCurrentReadyAccountIdentity.mockResolvedValue(null);
    mockedConsumeAccountHandoff.mockResolvedValue({
      token: "handoff-1",
      playerId: "guest-player",
      returnTo: "/mine",
      expiresAt: "2026-07-04T00:10:00.000Z",
    });
    mockedClaimPlayerForAccount.mockResolvedValue({
      status: "claimed",
      playerId: "guest-player",
    });
  });

  it("starts a one-time account handoff for the current guest save", async () => {
    const res = await start(jsonRequest({ returnTo: "/mine?panel=account" }));

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(mockedCreateAccountHandoff).toHaveBeenCalledWith(
      "sql",
      "guest-player",
      "/mine?panel=account",
    );
    expect(await res.json()).toEqual({
      handoffId: "handoff-1",
      expiresAt: "2026-07-04T00:10:00.000Z",
      returnTo: "/mine?panel=account",
    });
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "handoff_started",
      severity: "info",
      playerId: "guest-player",
    });
  });

  it("sanitizes unsafe handoff return paths", async () => {
    const res = await start(jsonRequest({ returnTo: "https://evil.test" }));

    expect(res.status).toBe(200);
    expect(mockedCreateAccountHandoff).toHaveBeenCalledWith(
      "sql",
      "guest-player",
      "/mine",
    );
  });

  it("requires a current guest save before starting handoff", async () => {
    mockedCurrentPlayerId.mockResolvedValue(null);

    const res = await start(jsonRequest({ returnTo: "/mine" }));

    expect(res.status).toBe(409);
    expect(mockedCreateAccountHandoff).not.toHaveBeenCalled();
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "handoff_start_missing_player",
      severity: "warn",
    });
  });

  it("requires the account provider before starting handoff", async () => {
    mockedAccountProviderReady.mockReturnValue(false);

    const res = await start(jsonRequest({ returnTo: "/mine" }));

    expect(res.status).toBe(503);
    expectNoStore(res);
    expect(await res.json()).toEqual({
      error: "account provider not configured",
    });
    expect(mockedCurrentPlayerId).not.toHaveBeenCalled();
    expect(mockedCreateAccountHandoff).not.toHaveBeenCalled();
  });

  it("requires sign-in before consuming a handoff", async () => {
    const res = await finish(jsonRequest({ handoffId: "handoff-1" }));

    expect(res.status).toBe(401);
    expect(mockedConsumeAccountHandoff).not.toHaveBeenCalled();
  });

  it("rejects malformed handoff ids before storage lookup", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);

    const res = await finish(jsonRequest({ handoffId: "handoff/1" }));

    expect(res.status).toBe(400);
    expect(mockedConsumeAccountHandoff).not.toHaveBeenCalled();
    expect(mockedLogAccountLinkEvent).not.toHaveBeenCalled();
  });

  it("finishes a handoff by claiming the stored guest player", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);

    const res = await finish(jsonRequest({ handoffId: "handoff-1" }));

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(mockedConsumeAccountHandoff).toHaveBeenCalledWith(
      "sql",
      "handoff-1",
      "guest-player",
    );
    expect(mockedClaimPlayerForAccount).toHaveBeenCalledWith(
      "sql",
      identity,
      "guest-player",
    );
    expect(mockedSetActiveSaveSlotPlayer).toHaveBeenCalledWith("guest-player");
    expect(await res.json()).toMatchObject({
      mode: "cloud_loaded",
      result: "claimed",
      activeSlot: 1,
      returnTo: "/mine",
    });
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "handoff_succeeded",
      severity: "info",
      provider: "clerk",
      subject: "clerk-user-1",
      playerId: "guest-player",
      targetPlayerId: "guest-player",
      activeSlot: 1,
      result: "claimed",
    });
  });

  it("finishes a handoff when the account already owns the stored guest player", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedClaimPlayerForAccount.mockResolvedValue({
      status: "already-linked",
      playerId: "guest-player",
    });

    const res = await finish(jsonRequest({ handoffId: "handoff-1" }));

    expect(res.status).toBe(200);
    expect(mockedSetActiveSaveSlotPlayer).toHaveBeenCalledWith("guest-player");
    expect(await res.json()).toMatchObject({
      mode: "cloud_loaded",
      result: "already-linked",
      activeSlot: 1,
      returnTo: "/mine",
    });
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "handoff_already_linked",
      severity: "info",
      provider: "clerk",
      subject: "clerk-user-1",
      playerId: "guest-player",
      targetPlayerId: "guest-player",
      activeSlot: 1,
      result: "already-linked",
    });
  });

  it("requires the initiating guest save before consuming a handoff", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedCurrentPlayerId.mockResolvedValue(null);

    const res = await finish(jsonRequest({ handoffId: "handoff-1" }));

    expect(res.status).toBe(409);
    expect(mockedConsumeAccountHandoff).not.toHaveBeenCalled();
    expect(mockedClaimPlayerForAccount).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      error: "guest save required",
    });
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "handoff_missing_initiating_session",
      severity: "warn",
      provider: "clerk",
      subject: "clerk-user-1",
    });
  });

  it("returns conflict without switching slots when account already has a save", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedClaimPlayerForAccount.mockResolvedValue({
      status: "conflict",
      playerId: "cloud-player",
    });

    const res = await finish(jsonRequest({ handoffId: "handoff-1" }));

    expect(res.status).toBe(409);
    expectNoStore(res);
    expect(mockedSetActiveSaveSlotPlayer).not.toHaveBeenCalled();
    expect(mockedAccountSaveSummary).toHaveBeenCalledWith(
      "sql",
      "cloud-player",
    );
    expect(await res.json()).toMatchObject({
      mode: "conflict",
      returnTo: "/mine",
      accountSave: { balance: 12 },
    });
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "handoff_conflict",
      severity: "warn",
      provider: "clerk",
      subject: "clerk-user-1",
      playerId: "guest-player",
      targetPlayerId: "cloud-player",
      result: "conflict",
    });
  });

  it("rejects handoffs whose device save is already linked elsewhere", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedClaimPlayerForAccount.mockResolvedValue({
      status: "target-linked-to-other-account",
      playerId: "guest-player",
    });

    const res = await finish(jsonRequest({ handoffId: "handoff-1" }));

    expect(res.status).toBe(409);
    expect(mockedSetActiveSaveSlotPlayer).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      error: "device save belongs to another account",
      code: "device_save_linked_to_other_account",
      returnTo: "/mine",
    });
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "handoff_target_linked_to_other_account",
      severity: "warn",
      provider: "clerk",
      subject: "clerk-user-1",
      playerId: "guest-player",
      targetPlayerId: "guest-player",
      result: "target-linked-to-other-account",
    });
  });

  it("preserves the device save when loading a claimed cloud save would replace it", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedSetActiveSaveSlotPlayer.mockRejectedValue(
      new SaveSlotPreserveError(),
    );

    const res = await finish(jsonRequest({ handoffId: "handoff-1" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "no empty save slot for device save",
      code: "device_save_slot_full",
      returnTo: "/mine",
    });
  });

  it("rejects invalid account identity results during handoff finish", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedClaimPlayerForAccount.mockResolvedValue({
      status: "invalid-identity",
    });

    const res = await finish(jsonRequest({ handoffId: "handoff-1" }));

    expect(res.status).toBe(401);
    expectNoStore(res);
    expect(mockedSetActiveSaveSlotPlayer).not.toHaveBeenCalled();
    expect(mockedAccountSaveSummary).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      error: "account sign-in required",
    });
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "handoff_invalid_identity",
      severity: "warn",
      provider: "clerk",
      subject: "clerk-user-1",
      playerId: "guest-player",
      result: "invalid-identity",
    });
  });

  it("rejects expired or already consumed handoffs", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedConsumeAccountHandoff.mockResolvedValue(null);

    const res = await finish(jsonRequest({ handoffId: "handoff-1" }));

    expect(res.status).toBe(410);
    expect(mockedClaimPlayerForAccount).not.toHaveBeenCalled();
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "handoff_expired",
      severity: "info",
      provider: "clerk",
      subject: "clerk-user-1",
    });
  });

  it("blocks cross-site handoff starts before storage lookup", async () => {
    const res = await start(
      jsonRequest(
        { returnTo: "/mine" },
        {
          origin: "https://evil.test",
          "sec-fetch-site": "cross-site",
        },
      ),
    );

    expect(res.status).toBe(403);
    expectNoStore(res);
    expect(mockedCurrentPlayerId).not.toHaveBeenCalled();
    expect(mockedCreateAccountHandoff).not.toHaveBeenCalled();
  });

  it("blocks cross-site handoff finishes before account lookup", async () => {
    const res = await finish(
      jsonRequest(
        { handoffId: "handoff-1" },
        {
          origin: "https://evil.test",
          "sec-fetch-site": "cross-site",
        },
      ),
    );

    expect(res.status).toBe(403);
    expectNoStore(res);
    expect(mockedCurrentReadyAccountIdentity).not.toHaveBeenCalled();
    expect(mockedConsumeAccountHandoff).not.toHaveBeenCalled();
  });
});
