import { describe, expect, it, vi } from "vitest";
import {
  clearPendingAccountHandoffs,
  consumeAccountHandoff,
  createAccountHandoff,
  pruneAccountHandoffs,
  safeAccountHandoffId,
  safeAccountReturnTo,
} from "./account-handoff";

function makeSql(
  handler: (query: string, values: unknown[]) => Promise<unknown[]> | unknown[],
) {
  return vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) =>
    handler(strings.join(" "), values),
  );
}

describe("account handoff helpers", () => {
  it("keeps return paths local to the app", () => {
    expect(safeAccountReturnTo("/mine?panel=account")).toBe(
      "/mine?panel=account",
    );
    expect(safeAccountReturnTo("https://evil.test")).toBe("/mine");
    expect(safeAccountReturnTo("//evil.test")).toBe("/mine");
    expect(safeAccountReturnTo("/mine\\evil")).toBe("/mine");
    expect(safeAccountReturnTo("")).toBe("/mine");
  });

  it("accepts only bounded handoff id tokens", () => {
    expect(safeAccountHandoffId(" handoff-1 ")).toBe("handoff-1");
    expect(safeAccountHandoffId("019f2db1-fd9a-74b0-a6bc-aabbd9c178bf")).toBe(
      "019f2db1-fd9a-74b0-a6bc-aabbd9c178bf",
    );
    expect(safeAccountHandoffId("")).toBeNull();
    expect(safeAccountHandoffId("handoff 1")).toBeNull();
    expect(safeAccountHandoffId("handoff/1")).toBeNull();
    expect(safeAccountHandoffId("h".repeat(129))).toBeNull();
    expect(safeAccountHandoffId(null)).toBeNull();
  });

  it("creates a short-lived handoff row for a player", async () => {
    let queryIndex = 0;
    const sql = makeSql((query, values) => {
      queryIndex += 1;
      if (queryIndex === 1) {
        expect(query).toContain("DELETE FROM account_handoffs");
        expect(query).toContain("consumed_at IS NOT NULL");
        expect(query).toContain("expires_at <= now()");
        return [];
      }
      if (queryIndex === 2) {
        expect(query).toContain("DELETE FROM account_handoffs");
        expect(query).toContain("player_id =");
        expect(query).toContain("consumed_at IS NULL");
        expect(values).toEqual(["player-1"]);
        return [];
      }
      expect(query).toContain("INSERT INTO account_handoffs");
      expect(values[1]).toBe("player-1");
      expect(values[2]).toBe("/mine");
      return [
        {
          token: values[0],
          player_id: "player-1",
          return_to: "/mine",
          expires_at: values[3],
        },
      ];
    });

    const handoff = await createAccountHandoff(
      sql as never,
      "player-1",
      "/mine",
    );

    expect(handoff.playerId).toBe("player-1");
    expect(handoff.returnTo).toBe("/mine");
    expect(handoff.token).toEqual(expect.any(String));
    expect(handoff.expiresAt).toEqual(expect.any(String));
    expect(queryIndex).toBe(3);
  });

  it("clears only pending handoff rows for the same player", async () => {
    const sql = makeSql((query, values) => {
      expect(query).toContain("DELETE FROM account_handoffs");
      expect(query).toContain("player_id =");
      expect(query).toContain("consumed_at IS NULL");
      expect(values).toEqual(["player-1"]);
      return [];
    });

    await clearPendingAccountHandoffs(sql as never, "player-1");
  });

  it("prunes expired or consumed handoff rows", async () => {
    const sql = makeSql((query) => {
      expect(query).toContain("DELETE FROM account_handoffs");
      expect(query).toContain("consumed_at IS NOT NULL");
      expect(query).toContain("expires_at <= now()");
      return [];
    });

    await pruneAccountHandoffs(sql as never);
  });

  it("consumes only unexpired unused handoff rows", async () => {
    const sql = makeSql((query, values) => {
      expect(query).toContain("UPDATE account_handoffs");
      expect(query).toContain("consumed_at IS NULL");
      expect(query).toContain("expires_at > now()");
      expect(values).toEqual(["handoff-1"]);
      return [
        {
          token: "handoff-1",
          player_id: "player-1",
          return_to: "/mine",
          expires_at: "2026-07-04T00:10:00.000Z",
        },
      ];
    });

    await expect(
      consumeAccountHandoff(sql as never, "handoff-1"),
    ).resolves.toEqual({
      token: "handoff-1",
      playerId: "player-1",
      returnTo: "/mine",
      expiresAt: "2026-07-04T00:10:00.000Z",
    });
  });
});
