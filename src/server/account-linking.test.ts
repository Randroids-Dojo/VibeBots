import { describe, expect, it, vi } from "vitest";
import {
  claimPlayerForAccount,
  findLinkedPlayerId,
  loadPlayerForAccount,
  normalizeAccountIdentity,
} from "./account-linking";

function makeSql(
  handler: (query: string, values: unknown[]) => Promise<unknown[]> | unknown[],
) {
  return vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) =>
    handler(strings.join(" "), values),
  );
}

describe("account linking helpers", () => {
  it("normalizes provider subjects before storage lookup", () => {
    expect(
      normalizeAccountIdentity({
        provider: " Clerk ",
        subject: " clerk-user-1 ",
        email: " player@example.com ",
      }),
    ).toEqual({
      provider: "clerk",
      subject: "clerk-user-1",
      email: "player@example.com",
    });
    expect(
      normalizeAccountIdentity({ provider: "clerk", subject: "   " }),
    ).toBeNull();
  });

  it("finds an existing player linked to the account subject", async () => {
    const sql = makeSql((query, values) => {
      expect(query).toContain("WHERE clerk_user_id =");
      expect(values).toEqual(["clerk-user-1"]);
      return [{ id: "player-1" }];
    });

    await expect(
      findLinkedPlayerId(sql as never, {
        provider: " Clerk ",
        subject: " clerk-user-1 ",
      }),
    ).resolves.toBe("player-1");
  });

  it("ignores non-Clerk provider identities for the Clerk-column adapter", async () => {
    const sql = makeSql(() => {
      throw new Error("invalid provider should not query account links");
    });

    await expect(
      findLinkedPlayerId(sql as never, {
        provider: "google",
        subject: "user-1",
      }),
    ).resolves.toBeNull();
    await expect(
      claimPlayerForAccount(
        sql as never,
        { provider: "google", subject: "user-1" },
        "player-1",
      ),
    ).resolves.toEqual({ status: "invalid-identity" });
  });

  it("claims an unlinked player row for the account", async () => {
    const sql = makeSql((query) => {
      if (query.includes("WHERE clerk_user_id =")) return [];
      if (query.includes("UPDATE players")) return [{ id: "player-1" }];
      return [];
    });

    await expect(
      claimPlayerForAccount(
        sql as never,
        { provider: "clerk", subject: "clerk-user-1" },
        "player-1",
      ),
    ).resolves.toEqual({ status: "claimed", playerId: "player-1" });
  });

  it("is idempotent when the account already points at the same player", async () => {
    const sql = makeSql((query) => {
      if (query.includes("WHERE clerk_user_id =")) return [{ id: "player-1" }];
      throw new Error("same-player claim should not update");
    });

    await expect(
      claimPlayerForAccount(
        sql as never,
        { provider: "clerk", subject: "clerk-user-1" },
        "player-1",
      ),
    ).resolves.toEqual({
      status: "already-linked",
      playerId: "player-1",
    });
  });

  it("reports conflict when the account already owns another save", async () => {
    const sql = makeSql((query) => {
      if (query.includes("WHERE clerk_user_id ="))
        return [{ id: "cloud-player" }];
      throw new Error("conflicted claim should not update");
    });

    await expect(
      claimPlayerForAccount(
        sql as never,
        { provider: "clerk", subject: "clerk-user-1" },
        "guest-player",
      ),
    ).resolves.toEqual({
      status: "conflict",
      playerId: "cloud-player",
    });
  });

  it("reports the target save is linked to another account", async () => {
    const sql = makeSql((query) => {
      if (query.includes("WHERE clerk_user_id =")) {
        return [];
      }
      if (query.includes("UPDATE players")) return [];
      if (query.includes("WHERE id =")) {
        return [{ id: "player-1", clerk_user_id: "other-account" }];
      }
      return [];
    });

    await expect(
      claimPlayerForAccount(
        sql as never,
        { provider: "clerk", subject: "clerk-user-1" },
        "player-1",
      ),
    ).resolves.toEqual({
      status: "target-linked-to-other-account",
      playerId: "player-1",
    });
  });

  it("treats a concurrently linked same-account row as already linked", async () => {
    const sql = makeSql((query) => {
      if (query.includes("WHERE clerk_user_id =")) {
        return [];
      }
      if (query.includes("UPDATE players")) return [];
      if (query.includes("WHERE id =")) {
        return [{ id: "player-1", clerk_user_id: "clerk-user-1" }];
      }
      return [];
    });

    await expect(
      claimPlayerForAccount(
        sql as never,
        { provider: "clerk", subject: "clerk-user-1" },
        "player-1",
      ),
    ).resolves.toEqual({ status: "already-linked", playerId: "player-1" });
  });

  it("reports conflict when a concurrent claim wins the unique account index", async () => {
    let updateAttempted = false;
    const sql = makeSql((query) => {
      if (query.includes("WHERE clerk_user_id =")) {
        return updateAttempted ? [{ id: "cloud-player" }] : [];
      }
      if (query.includes("UPDATE players")) {
        updateAttempted = true;
        const error = new Error(
          "duplicate key value violates unique constraint",
        );
        Object.assign(error, { code: "23505" });
        throw error;
      }
      return [];
    });

    await expect(
      claimPlayerForAccount(
        sql as never,
        { provider: "clerk", subject: "clerk-user-1" },
        "guest-player",
      ),
    ).resolves.toEqual({ status: "conflict", playerId: "cloud-player" });
  });

  it("rethrows non-unique storage errors during claim", async () => {
    const sql = makeSql((query) => {
      if (query.includes("WHERE clerk_user_id =")) {
        return [];
      }
      if (query.includes("UPDATE players")) {
        const error = new Error("storage unavailable");
        Object.assign(error, { code: "08006" });
        throw error;
      }
      return [];
    });

    await expect(
      claimPlayerForAccount(
        sql as never,
        { provider: "clerk", subject: "clerk-user-1" },
        "guest-player",
      ),
    ).rejects.toThrow("storage unavailable");
  });

  it("reports a missing player row", async () => {
    const sql = makeSql(() => []);

    await expect(
      claimPlayerForAccount(
        sql as never,
        { provider: "clerk", subject: "clerk-user-1" },
        "missing-player",
      ),
    ).resolves.toEqual({ status: "player-not-found" });
  });

  it("loads a linked Clerk player through an app-owned session writer", async () => {
    const sql = makeSql((query, values) => {
      expect(query).toContain("WHERE clerk_user_id =");
      expect(values).toEqual(["clerk-user-1"]);
      return [{ id: "cloud-player" }];
    });
    const session = {
      writeActivePlayer: vi.fn(async (playerId: string) => ({
        activeSlot: 2,
        playerId,
      })),
    };

    await expect(
      loadPlayerForAccount(
        sql as never,
        { provider: " Clerk ", subject: " clerk-user-1 " },
        session,
      ),
    ).resolves.toEqual({
      status: "loaded",
      playerId: "cloud-player",
      session: {
        activeSlot: 2,
        playerId: "cloud-player",
      },
    });
    expect(session.writeActivePlayer).toHaveBeenCalledWith("cloud-player");
  });

  it("does not write a session for unsupported load providers", async () => {
    const sql = makeSql(() => {
      throw new Error("invalid provider should not query account links");
    });
    const session = {
      writeActivePlayer: vi.fn(),
    };

    await expect(
      loadPlayerForAccount(
        sql as never,
        { provider: "google", subject: "user-1" },
        session,
      ),
    ).resolves.toEqual({ status: "not-found" });
    expect(session.writeActivePlayer).not.toHaveBeenCalled();
  });
});
