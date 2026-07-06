import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  type AccountLinkAttempt,
  type AccountLinkStore,
  accountLinkedSaveStatus,
  claimAccountPlayer,
  loadLinkedAccountPlayer,
  normalizeAccountIdentity,
} from "./account-link-core";

function store(overrides: Partial<AccountLinkStore>): AccountLinkStore {
  return {
    findLinkedPlayer: vi.fn(async () => null),
    claimUnlinkedPlayer: vi.fn(
      async (_identity, playerId): Promise<AccountLinkAttempt> => ({
        status: "claimed",
        playerId,
      }),
    ),
    ...overrides,
  };
}

describe("account link core", () => {
  it("stays reusable without app, provider, or framework imports", () => {
    const source = readFileSync("src/lib/account-link-core.ts", "utf8");

    expect(source).not.toMatch(/^import\s/m);
    expect(source).not.toContain("clerk");
    expect(source).not.toContain("players");
    expect(source).not.toContain("@/");
  });

  it("normalizes provider tokens, subjects, and optional email", () => {
    expect(
      normalizeAccountIdentity({
        provider: " Google.OAuth ",
        subject: " user-1 ",
        email: " player@example.com ",
      }),
    ).toEqual({
      provider: "google.oauth",
      subject: "user-1",
      email: "player@example.com",
    });
    expect(
      normalizeAccountIdentity({ provider: "google", subject: "   " }),
    ).toBeNull();
    expect(
      normalizeAccountIdentity({ provider: "   ", subject: "user-1" }),
    ).toBeNull();
  });

  it("rejects malformed provider or subject values before storage sees them", () => {
    expect(
      normalizeAccountIdentity({ provider: "google auth", subject: "user-1" }),
    ).toBeNull();
    expect(
      normalizeAccountIdentity({ provider: "-google", subject: "user-1" }),
    ).toBeNull();
    expect(
      normalizeAccountIdentity({
        provider: "g".repeat(65),
        subject: "user-1",
      }),
    ).toBeNull();
    expect(
      normalizeAccountIdentity({
        provider: "google",
        subject: "u".repeat(257),
      }),
    ).toBeNull();
    expect(
      normalizeAccountIdentity({
        provider: "google",
        subject: "user-1\nuser-2",
      }),
    ).toBeNull();
    expect(
      normalizeAccountIdentity({
        provider: "google",
        subject: "user-1",
        email: `${"p".repeat(310)}@example.com`,
      }),
    ).toBeNull();
    expect(
      normalizeAccountIdentity({
        provider: "google",
        subject: "user-1",
        email: "player@example.com\ncc@example.com",
      }),
    ).toBeNull();
  });

  it("claims the requested player when no account link exists", async () => {
    const links = store({});

    await expect(
      claimAccountPlayer(
        links,
        { provider: "google", subject: "user-1" },
        "guest-player",
      ),
    ).resolves.toEqual({ status: "claimed", playerId: "guest-player" });
  });

  it("is idempotent when the account already points at the player", async () => {
    const links = store({
      findLinkedPlayer: vi.fn(async () => "guest-player"),
      claimUnlinkedPlayer: vi.fn(),
    });

    await expect(
      claimAccountPlayer(
        links,
        { provider: "google", subject: "user-1" },
        "guest-player",
      ),
    ).resolves.toEqual({
      status: "already-linked",
      playerId: "guest-player",
    });
    expect(links.claimUnlinkedPlayer).not.toHaveBeenCalled();
  });

  it("reports conflict when the account points at another player", async () => {
    const links = store({
      findLinkedPlayer: vi.fn(async () => "cloud-player"),
      claimUnlinkedPlayer: vi.fn(),
    });

    await expect(
      claimAccountPlayer(
        links,
        { provider: "google", subject: "user-1" },
        "guest-player",
      ),
    ).resolves.toEqual({
      status: "conflict",
      playerId: "cloud-player",
    });
    expect(links.claimUnlinkedPlayer).not.toHaveBeenCalled();
  });

  it("reports when the requested player belongs to another account", async () => {
    const links = store({
      claimUnlinkedPlayer: vi.fn(
        async (): Promise<AccountLinkAttempt> => ({
          status: "linked-to-other-account",
          playerId: "guest-player",
        }),
      ),
    });

    await expect(
      claimAccountPlayer(
        links,
        { provider: "google", subject: "user-1" },
        "guest-player",
      ),
    ).resolves.toEqual({
      status: "target-linked-to-other-account",
      playerId: "guest-player",
    });
  });

  it("passes through missing-player results", async () => {
    const links = store({
      claimUnlinkedPlayer: vi.fn(
        async (): Promise<AccountLinkAttempt> => ({
          status: "player-not-found",
        }),
      ),
    });

    await expect(
      claimAccountPlayer(
        links,
        { provider: "google", subject: "user-1" },
        "missing-player",
      ),
    ).resolves.toEqual({ status: "player-not-found" });
  });

  it("rejects invalid account identities before storage lookup", async () => {
    const links = store({
      findLinkedPlayer: vi.fn(),
      claimUnlinkedPlayer: vi.fn(),
    });

    await expect(
      claimAccountPlayer(
        links,
        { provider: "google auth", subject: "user-1" },
        "guest-player",
      ),
    ).resolves.toEqual({ status: "invalid-identity" });
    expect(links.findLinkedPlayer).not.toHaveBeenCalled();
    expect(links.claimUnlinkedPlayer).not.toHaveBeenCalled();
  });

  it("passes normalized identities to the app-owned store", async () => {
    const links = store({});

    await claimAccountPlayer(
      links,
      {
        provider: " Google.OAuth ",
        subject: " user-1 ",
        email: " player@example.com ",
      },
      "guest-player",
    );

    expect(links.findLinkedPlayer).toHaveBeenCalledWith({
      provider: "google.oauth",
      subject: "user-1",
      email: "player@example.com",
    });
    expect(links.claimUnlinkedPlayer).toHaveBeenCalledWith(
      {
        provider: "google.oauth",
        subject: "user-1",
        email: "player@example.com",
      },
      "guest-player",
    );
  });

  it("loads a linked account player through an app-owned session writer", async () => {
    const links = store({
      findLinkedPlayer: vi.fn(async () => "cloud-player"),
      claimUnlinkedPlayer: vi.fn(),
    });
    const session = {
      writeActivePlayer: vi.fn(async (playerId: string) => ({
        activeSlot: 2,
        playerId,
      })),
    };

    await expect(
      loadLinkedAccountPlayer(links, session, {
        provider: " Google.OAuth ",
        subject: " user-1 ",
      }),
    ).resolves.toEqual({
      status: "loaded",
      playerId: "cloud-player",
      session: {
        activeSlot: 2,
        playerId: "cloud-player",
      },
    });
    expect(links.findLinkedPlayer).toHaveBeenCalledWith({
      provider: "google.oauth",
      subject: "user-1",
      email: undefined,
    });
    expect(session.writeActivePlayer).toHaveBeenCalledWith("cloud-player");
  });

  it("does not write a session when no linked account player exists", async () => {
    const links = store({
      findLinkedPlayer: vi.fn(async () => null),
      claimUnlinkedPlayer: vi.fn(),
    });
    const session = {
      writeActivePlayer: vi.fn(),
    };

    await expect(
      loadLinkedAccountPlayer(links, session, {
        provider: "google",
        subject: "user-1",
      }),
    ).resolves.toEqual({ status: "not-found" });
    expect(session.writeActivePlayer).not.toHaveBeenCalled();
  });

  it("rejects invalid account identities before linked-player lookup", async () => {
    const links = store({
      findLinkedPlayer: vi.fn(),
      claimUnlinkedPlayer: vi.fn(),
    });
    const session = {
      writeActivePlayer: vi.fn(),
    };

    await expect(
      loadLinkedAccountPlayer(links, session, {
        provider: "google auth",
        subject: "user-1",
      }),
    ).resolves.toEqual({ status: "invalid-identity" });
    expect(links.findLinkedPlayer).not.toHaveBeenCalled();
    expect(session.writeActivePlayer).not.toHaveBeenCalled();
  });

  it("classifies signed-in saves without a linked account player", () => {
    expect(
      accountLinkedSaveStatus({
        activePlayerId: "guest-player",
        linkedPlayerId: null,
      }),
    ).toEqual({ status: "signed-in-unlinked" });
  });

  it("classifies an active player that already matches the account link", () => {
    expect(
      accountLinkedSaveStatus({
        activePlayerId: "cloud-player",
        linkedPlayerId: "cloud-player",
      }),
    ).toEqual({ status: "cloud-loaded", playerId: "cloud-player" });
  });

  it("classifies a linked account player that differs from the active player as a conflict", () => {
    expect(
      accountLinkedSaveStatus({
        activePlayerId: "guest-player",
        linkedPlayerId: "cloud-player",
      }),
    ).toEqual({ status: "conflict", playerId: "cloud-player" });
  });

  it("classifies a linked account player without an active player as a conflict until the app writes a session", () => {
    expect(
      accountLinkedSaveStatus({
        activePlayerId: null,
        linkedPlayerId: "cloud-player",
      }),
    ).toEqual({ status: "conflict", playerId: "cloud-player" });
  });
});
