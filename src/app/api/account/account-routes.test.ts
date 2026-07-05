import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimPlayerForAccount,
  findLinkedPlayerId,
  loadPlayerForAccount,
} from "@/server/account-linking";
import {
  type AccountProviderStatus,
  type AccountSessionProvider,
  currentAccountSessionProvider,
  currentReadyAccountIdentity,
  requestAccountSessionProvider,
} from "@/server/account-session";
import { accountSaveSummary } from "@/server/account-summary";
import { db, storageConfigured } from "@/server/db";
import { logAccountLinkEvent } from "@/server/monitoring";
import {
  currentPlayerId,
  currentSaveSlotSession,
  setActiveSaveSlotPlayer,
} from "@/server/player";
import { POST as claim } from "./claim/route";
import { POST as load } from "./load/route";
import { GET as status } from "./status/route";

vi.mock("@/server/db", () => ({
  db: vi.fn(async () => "sql"),
  storageConfigured: vi.fn(() => true),
}));

vi.mock("@/server/account-session", () => ({
  currentAccountSessionProvider: vi.fn(),
  currentReadyAccountIdentity: vi.fn(async () => null),
  requestAccountSessionProvider: vi.fn(),
}));

vi.mock("@/server/account-linking", () => ({
  claimPlayerForAccount: vi.fn(),
  findLinkedPlayerId: vi.fn(),
  loadPlayerForAccount: vi.fn(),
}));

vi.mock("@/server/account-summary", () => ({
  accountSaveSummary: vi.fn(),
}));

vi.mock("@/server/player", () => ({
  currentPlayerId: vi.fn(async () => "guest-player"),
  currentSaveSlotSession: vi.fn(async () => ({
    activeSlot: 1,
    slots: { "1": "guest-player" },
  })),
  setActiveSaveSlotPlayer: vi.fn(async (playerId: string) => ({
    activeSlot: 1,
    slots: { "1": playerId },
  })),
}));

vi.mock("@/server/monitoring", () => ({
  logAccountLinkEvent: vi.fn(),
}));

const mockedStorageConfigured = vi.mocked(storageConfigured);
const mockedDb = vi.mocked(db);
const mockedCurrentAccountSessionProvider = vi.mocked(
  currentAccountSessionProvider,
);
const mockedCurrentReadyAccountIdentity = vi.mocked(
  currentReadyAccountIdentity,
);
const mockedRequestAccountSessionProvider = vi.mocked(
  requestAccountSessionProvider,
);
const mockedFindLinkedPlayerId = vi.mocked(findLinkedPlayerId);
const mockedClaimPlayerForAccount = vi.mocked(claimPlayerForAccount);
const mockedLoadPlayerForAccount = vi.mocked(loadPlayerForAccount);
const mockedAccountSaveSummary = vi.mocked(accountSaveSummary);
const mockedCurrentPlayerId = vi.mocked(currentPlayerId);
const mockedCurrentSaveSlotSession = vi.mocked(currentSaveSlotSession);
const mockedSetActiveSaveSlotPlayer = vi.mocked(setActiveSaveSlotPlayer);
const mockedLogAccountLinkEvent = vi.mocked(logAccountLinkEvent);

const identity = {
  provider: "clerk" as const,
  subject: "clerk-user-1",
  email: "player@example.com",
};

const pendingProviderStatus: AccountProviderStatus = {
  provider: "clerk",
  ready: false,
  reason: "sdk_not_wired",
  issues: [
    "sdk_not_wired",
    "publishable_key_missing",
    "secret_key_missing",
    "public_sign_in_url_missing",
    "public_sign_in_fallback_url_missing",
    "public_sign_up_fallback_url_missing",
  ],
};

const readyProviderStatus: AccountProviderStatus = {
  provider: "clerk",
  ready: true,
  reason: null,
  issues: [],
};

const publicSignInUrlMissingStatus: AccountProviderStatus = {
  provider: "clerk",
  ready: false,
  reason: "public_sign_in_url_missing",
  issues: ["public_sign_in_url_missing"],
};

function providerWithStatus(
  providerStatus: AccountProviderStatus,
): AccountSessionProvider {
  return {
    identity: async () => null,
    status: () => providerStatus,
  };
}

const guestSummary = {
  exists: true,
  createdAt: "2026-07-04T00:00:00.000Z",
  balance: 12,
  deepestDepth: 8,
  partsOwned: 3,
  designs: 1,
  stamps: 2,
};

const cloudSummary = {
  exists: true,
  createdAt: "2026-07-03T00:00:00.000Z",
  balance: 42,
  deepestDepth: 30,
  partsOwned: 9,
  designs: 4,
  stamps: 5,
};

function statusRequest(headers: HeadersInit = {}): Request {
  return new Request("https://vibe-bots.test/api/account/status", {
    method: "GET",
    headers,
  });
}

function sameOriginPost(path: string): Request {
  return new Request(`https://vibe-bots.test${path}`, {
    method: "POST",
    headers: {
      origin: "https://vibe-bots.test",
      "sec-fetch-site": "same-origin",
    },
  });
}

function accountStatus(headers?: HeadersInit): Promise<Response> {
  return status(
    statusRequest(
      headers ?? {
        "sec-fetch-site": "same-origin",
      },
    ),
  );
}

function expectNoStore(res: Response): void {
  expect(res.headers.get("Cache-Control")).toBe("no-store");
}

describe("/api/account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStorageConfigured.mockReturnValue(true);
    mockedCurrentAccountSessionProvider.mockReturnValue(
      providerWithStatus(pendingProviderStatus),
    );
    mockedRequestAccountSessionProvider.mockReturnValue(
      providerWithStatus(pendingProviderStatus),
    );
    mockedCurrentReadyAccountIdentity.mockResolvedValue(null);
    mockedFindLinkedPlayerId.mockResolvedValue(null);
    mockedClaimPlayerForAccount.mockResolvedValue({
      status: "claimed",
      playerId: "guest-player",
    });
    mockedLoadPlayerForAccount.mockResolvedValue({
      status: "not-found",
    });
    mockedAccountSaveSummary.mockImplementation(async (_sql, playerId) => {
      if (playerId === "cloud-player") return cloudSummary;
      if (playerId === "guest-player") return guestSummary;
      return null;
    });
    mockedCurrentPlayerId.mockResolvedValue("guest-player");
    mockedCurrentSaveSlotSession.mockResolvedValue({
      activeSlot: 1,
      slots: { "1": "guest-player" },
    });
  });

  it("reports guest account status with the current save summary", async () => {
    const res = await accountStatus();

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(mockedDb).toHaveBeenCalledOnce();
    expect(mockedAccountSaveSummary).toHaveBeenCalledWith(
      "sql",
      "guest-player",
    );
    expect(await res.json()).toEqual({
      mode: "guest",
      providerReady: false,
      providerStatus: {
        provider: "clerk",
        ready: false,
        reason: "sdk_not_wired",
        issues: [
          "sdk_not_wired",
          "publishable_key_missing",
          "secret_key_missing",
          "public_sign_in_url_missing",
          "public_sign_in_fallback_url_missing",
          "public_sign_up_fallback_url_missing",
        ],
      },
      activeSlot: 1,
      account: null,
      currentSave: guestSummary,
      accountSave: null,
    });
  });

  it("reports guest account status without storage summaries when no save exists", async () => {
    mockedCurrentPlayerId.mockResolvedValue(null);

    const res = await accountStatus();

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(mockedDb).not.toHaveBeenCalled();
    expect(mockedAccountSaveSummary).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({
      mode: "guest",
      currentSave: null,
      accountSave: null,
    });
  });

  it("treats a not-ready account provider as signed out", async () => {
    const provider = providerWithStatus(publicSignInUrlMissingStatus);
    mockedCurrentAccountSessionProvider.mockReturnValue(provider);
    mockedRequestAccountSessionProvider.mockReturnValue(provider);
    mockedCurrentReadyAccountIdentity.mockResolvedValue(null);

    const res = await accountStatus();

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(mockedCurrentReadyAccountIdentity).toHaveBeenCalledWith(
      provider,
      publicSignInUrlMissingStatus,
    );
    expect(mockedFindLinkedPlayerId).not.toHaveBeenCalled();
    expect(mockedSetActiveSaveSlotPlayer).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({
      mode: "guest",
      providerReady: false,
      providerStatus: {
        provider: "clerk",
        ready: false,
        reason: "public_sign_in_url_missing",
        issues: ["public_sign_in_url_missing"],
      },
      account: null,
      currentSave: guestSummary,
      accountSave: null,
    });
  });

  it("reports a signed-in account that has not claimed a save", async () => {
    const provider = providerWithStatus(readyProviderStatus);
    mockedCurrentAccountSessionProvider.mockReturnValue(provider);
    mockedRequestAccountSessionProvider.mockReturnValue(provider);
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);

    const res = await accountStatus();

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(mockedCurrentReadyAccountIdentity).toHaveBeenCalledWith(
      provider,
      readyProviderStatus,
    );
    expect(mockedFindLinkedPlayerId).toHaveBeenCalledWith("sql", identity);
    expect(await res.json()).toEqual({
      mode: "signed_in",
      providerReady: true,
      providerStatus: {
        provider: "clerk",
        ready: true,
        reason: null,
        issues: [],
      },
      activeSlot: 1,
      account: { provider: "clerk", email: "player@example.com" },
      currentSave: guestSummary,
      accountSave: null,
    });
  });

  it("reports a cloud-save conflict without overwriting the guest save", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedFindLinkedPlayerId.mockResolvedValue("cloud-player");

    const res = await accountStatus();

    expect(res.status).toBe(200);
    expect(mockedSetActiveSaveSlotPlayer).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({
      mode: "conflict",
      currentSave: guestSummary,
      accountSave: cloudSummary,
    });
  });

  it("reports cloud loaded when the account owns the active guest save", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedFindLinkedPlayerId.mockResolvedValue("guest-player");

    const res = await accountStatus();

    expect(res.status).toBe(200);
    expect(mockedSetActiveSaveSlotPlayer).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({
      mode: "cloud_loaded",
      currentSave: guestSummary,
      accountSave: guestSummary,
    });
  });

  it("loads the signed-in cloud save when this browser has no active save", async () => {
    mockedCurrentAccountSessionProvider.mockReturnValue(
      providerWithStatus(readyProviderStatus),
    );
    mockedRequestAccountSessionProvider.mockReturnValue(
      providerWithStatus(readyProviderStatus),
    );
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedCurrentSaveSlotSession.mockResolvedValue(null);
    mockedCurrentPlayerId.mockResolvedValue(null);
    mockedFindLinkedPlayerId.mockResolvedValue("cloud-player");

    const res = await accountStatus();

    expect(res.status).toBe(200);
    expect(mockedSetActiveSaveSlotPlayer).toHaveBeenCalledWith("cloud-player");
    expect(mockedAccountSaveSummary).toHaveBeenCalledWith(
      "sql",
      "cloud-player",
    );
    expect(await res.json()).toEqual({
      mode: "cloud_loaded",
      providerReady: true,
      providerStatus: {
        provider: "clerk",
        ready: true,
        reason: null,
        issues: [],
      },
      activeSlot: 1,
      account: { provider: "clerk", email: "player@example.com" },
      currentSave: cloudSummary,
      accountSave: cloudSummary,
    });
  });

  it("does not auto-load a cloud save from a cross-site status read", async () => {
    mockedCurrentAccountSessionProvider.mockReturnValue(
      providerWithStatus(readyProviderStatus),
    );
    mockedRequestAccountSessionProvider.mockReturnValue(
      providerWithStatus(readyProviderStatus),
    );
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedCurrentSaveSlotSession.mockResolvedValue(null);
    mockedCurrentPlayerId.mockResolvedValue(null);
    mockedFindLinkedPlayerId.mockResolvedValue("cloud-player");

    const res = await accountStatus({
      origin: "https://evil.test",
      "sec-fetch-site": "cross-site",
    });

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(mockedSetActiveSaveSlotPlayer).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      mode: "conflict",
      providerReady: true,
      providerStatus: {
        provider: "clerk",
        ready: true,
        reason: null,
        issues: [],
      },
      activeSlot: 1,
      account: { provider: "clerk", email: "player@example.com" },
      currentSave: null,
      accountSave: cloudSummary,
    });
  });

  it("requires sign-in before claiming a guest save", async () => {
    const res = await claim(sameOriginPost("/api/account/claim"));

    expect(res.status).toBe(401);
    expect(mockedClaimPlayerForAccount).not.toHaveBeenCalled();
  });

  it("claims the current guest save for a signed-in account", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);

    const res = await claim(sameOriginPost("/api/account/claim"));

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(mockedClaimPlayerForAccount).toHaveBeenCalledWith(
      "sql",
      identity,
      "guest-player",
    );
    expect(await res.json()).toEqual({
      mode: "cloud_loaded",
      result: "claimed",
      accountSave: guestSummary,
    });
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "claim_succeeded",
      severity: "info",
      provider: "clerk",
      subject: "clerk-user-1",
      playerId: "guest-player",
      targetPlayerId: "guest-player",
      result: "claimed",
    });
  });

  it("treats claiming an already-linked active save as loaded", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedClaimPlayerForAccount.mockResolvedValue({
      status: "already-linked",
      playerId: "guest-player",
    });

    const res = await claim(sameOriginPost("/api/account/claim"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: "cloud_loaded",
      result: "already-linked",
      accountSave: guestSummary,
    });
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "claim_already_linked",
      severity: "info",
      provider: "clerk",
      subject: "clerk-user-1",
      playerId: "guest-player",
      targetPlayerId: "guest-player",
      result: "already-linked",
    });
  });

  it("returns a conflict when claim finds an existing cloud save", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedClaimPlayerForAccount.mockResolvedValue({
      status: "conflict",
      playerId: "cloud-player",
    });

    const res = await claim(sameOriginPost("/api/account/claim"));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "account already has a cloud save",
      mode: "conflict",
      accountSave: cloudSummary,
    });
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "claim_conflict",
      severity: "warn",
      provider: "clerk",
      subject: "clerk-user-1",
      playerId: "guest-player",
      targetPlayerId: "cloud-player",
      result: "conflict",
    });
  });

  it("rejects invalid account identity results during claim", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedClaimPlayerForAccount.mockResolvedValue({
      status: "invalid-identity",
    });

    const res = await claim(sameOriginPost("/api/account/claim"));

    expect(res.status).toBe(401);
    expectNoStore(res);
    expect(mockedAccountSaveSummary).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      error: "account sign-in required",
    });
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "claim_invalid_identity",
      severity: "warn",
      provider: "clerk",
      subject: "clerk-user-1",
      playerId: "guest-player",
      result: "invalid-identity",
    });
  });

  it("loads the signed-in cloud save into the active slot", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedLoadPlayerForAccount.mockResolvedValue({
      status: "loaded",
      playerId: "cloud-player",
      session: {
        activeSlot: 1,
        slots: { "1": "cloud-player" },
      },
    });

    const res = await load(sameOriginPost("/api/account/load"));

    expect(res.status).toBe(200);
    expectNoStore(res);
    expect(mockedLoadPlayerForAccount).toHaveBeenCalledWith("sql", identity, {
      writeActivePlayer: mockedSetActiveSaveSlotPlayer,
    });
    expect(await res.json()).toEqual({
      mode: "cloud_loaded",
      activeSlot: 1,
      accountSave: cloudSummary,
    });
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "cloud_load_succeeded",
      severity: "info",
      provider: "clerk",
      subject: "clerk-user-1",
      targetPlayerId: "cloud-player",
      activeSlot: 1,
    });
  });

  it("does not load when the signed-in account has no cloud save", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);

    const res = await load(sameOriginPost("/api/account/load"));

    expect(res.status).toBe(404);
    expect(mockedSetActiveSaveSlotPlayer).not.toHaveBeenCalled();
    expect(mockedLogAccountLinkEvent).toHaveBeenCalledWith({
      code: "cloud_load_not_found",
      severity: "info",
      provider: "clerk",
      subject: "clerk-user-1",
    });
  });

  it("rejects invalid account identity results during cloud load", async () => {
    mockedCurrentReadyAccountIdentity.mockResolvedValue(identity);
    mockedLoadPlayerForAccount.mockResolvedValue({
      status: "invalid-identity",
    });

    const res = await load(sameOriginPost("/api/account/load"));

    expect(res.status).toBe(401);
    expectNoStore(res);
    expect(mockedAccountSaveSummary).not.toHaveBeenCalled();
    expect(mockedSetActiveSaveSlotPlayer).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      error: "account sign-in required",
    });
  });

  it("returns unavailable when storage is offline", async () => {
    mockedStorageConfigured.mockReturnValue(false);

    const res = await accountStatus();

    expect(res.status).toBe(503);
    expectNoStore(res);
  });

  it("blocks cross-site account claim mutations before storage lookup", async () => {
    const res = await claim(
      new Request("https://vibe-bots.test/api/account/claim", {
        method: "POST",
        headers: {
          origin: "https://evil.test",
          "sec-fetch-site": "cross-site",
        },
      }),
    );

    expect(res.status).toBe(403);
    expectNoStore(res);
    expect(mockedDb).not.toHaveBeenCalled();
    expect(mockedClaimPlayerForAccount).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      error: "same-origin request required",
    });
  });

  it("blocks cross-site account load mutations before storage lookup", async () => {
    const res = await load(
      new Request("https://vibe-bots.test/api/account/load", {
        method: "POST",
        headers: {
          origin: "https://evil.test",
          "sec-fetch-site": "cross-site",
        },
      }),
    );

    expect(res.status).toBe(403);
    expectNoStore(res);
    expect(mockedDb).not.toHaveBeenCalled();
    expect(mockedSetActiveSaveSlotPlayer).not.toHaveBeenCalled();
  });
});
