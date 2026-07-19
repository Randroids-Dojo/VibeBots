import { beforeEach, describe, expect, it, vi } from "vitest";
import { logElevatorOutcomeEvent } from "@/server/monitoring";
import {
  deliverElevatorOutcome,
  drainPendingElevatorOutcomes,
  elevatorOutcomeExists,
  isValidRequestId,
} from "./elevator-outbox";

vi.mock("@/server/monitoring", () => ({
  logElevatorOutcomeEvent: vi.fn(),
}));

const mockedLog = vi.mocked(logElevatorOutcomeEvent);

const UUID = "11111111-2222-4333-8444-555555555555";

type Sql = Parameters<typeof deliverElevatorOutcome>[0];

/** A mock neon tagged-template client routing by matched query text. */
function mockSql(handler: (query: string, values: unknown[]) => unknown): {
  sql: Sql;
  queries: string[];
  values: unknown[][];
} {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const sql = vi.fn(
    async (strings: TemplateStringsArray, ...args: unknown[]) => {
      const query = strings.join(" ");
      queries.push(query);
      values.push(args);
      return handler(query, args);
    },
  );
  return { sql: sql as unknown as Sql, queries, values };
}

describe("isValidRequestId", () => {
  it("accepts a well-formed UUID", () => {
    expect(isValidRequestId(UUID)).toBe(true);
    expect(isValidRequestId("A1B2C3D4-E5F6-4789-8ABC-DEF012345678")).toBe(true);
  });

  it("rejects non-UUID strings and non-strings", () => {
    expect(isValidRequestId("not-a-uuid")).toBe(false);
    expect(isValidRequestId("")).toBe(false);
    expect(isValidRequestId(`${UUID}extra`)).toBe(false);
    expect(isValidRequestId(undefined)).toBe(false);
    expect(isValidRequestId(null)).toBe(false);
    expect(isValidRequestId(42)).toBe(false);
    expect(isValidRequestId({ requestId: UUID })).toBe(false);
  });
});

describe("elevatorOutcomeExists", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is true when a row exists for the request id", async () => {
    const { sql, values } = mockSql(() => [{ "?column?": 1 }]);
    await expect(elevatorOutcomeExists(sql, UUID)).resolves.toBe(true);
    // The request id is the query parameter.
    expect(values[0]).toEqual([UUID]);
  });

  it("is false when no row exists", async () => {
    const { sql } = mockSql(() => []);
    await expect(elevatorOutcomeExists(sql, UUID)).resolves.toBe(false);
  });
});

describe("deliverElevatorOutcome", () => {
  beforeEach(() => vi.clearAllMocks());

  it("emits the accepted outcome with the request id, then marks delivered", async () => {
    const { sql, queries, values } = mockSql(() => []);
    await deliverElevatorOutcome(sql, {
      requestId: UUID,
      playerId: "player-1",
      operation: "extend",
    });
    expect(mockedLog).toHaveBeenCalledTimes(1);
    expect(mockedLog).toHaveBeenCalledWith({
      playerId: "player-1",
      operation: "extend",
      result: "accepted",
      reason: null,
      requestId: UUID,
    });
    expect(queries[0]).toContain("UPDATE elevator_upgrade_outcomes");
    expect(queries[0]).toContain("SET delivered_at = now()");
    expect(queries[0]).toContain("delivered_at IS NULL");
    expect(values[0]).toEqual([UUID]);
  });

  it("swallows a throwing sink without marking or throwing", async () => {
    mockedLog.mockImplementationOnce(() => {
      throw new Error("sink down");
    });
    const { sql, queries } = mockSql(() => []);
    await expect(
      deliverElevatorOutcome(sql, {
        requestId: UUID,
        playerId: "player-1",
        operation: "place",
      }),
    ).resolves.toBeUndefined();
    // The emit threw before the mark, so no UPDATE ran; the drain redelivers.
    expect(queries).toHaveLength(0);
  });

  it("swallows a failed mark so the buy still returns", async () => {
    const { sql } = mockSql(() => {
      throw new Error("db down");
    });
    await expect(
      deliverElevatorOutcome(sql, {
        requestId: UUID,
        playerId: "player-1",
        operation: "extend",
      }),
    ).resolves.toBeUndefined();
    expect(mockedLog).toHaveBeenCalledTimes(1);
  });
});

describe("drainPendingElevatorOutcomes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delivers nothing and runs no mark when the outbox is drained", async () => {
    const { sql, queries } = mockSql(() => []);
    await expect(drainPendingElevatorOutcomes(sql)).resolves.toBe(0);
    expect(mockedLog).not.toHaveBeenCalled();
    // Only the SELECT ran; no batch UPDATE for an empty set.
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("delivered_at IS NULL");
  });

  it("emits every stranded row with its id, then marks the batch delivered", async () => {
    const rows = [
      {
        request_id: UUID,
        player_id: "player-1",
        operation: "extend",
        result: "accepted",
        reason: null,
      },
      {
        request_id: "99999999-8888-4777-8666-555555555555",
        player_id: "player-2",
        operation: "place",
        result: "accepted",
        reason: null,
      },
    ];
    const { sql, queries, values } = mockSql((query) =>
      query.includes("SELECT request_id") ? rows : [],
    );
    await expect(drainPendingElevatorOutcomes(sql)).resolves.toBe(2);
    expect(mockedLog).toHaveBeenCalledTimes(2);
    expect(mockedLog).toHaveBeenNthCalledWith(1, {
      playerId: "player-1",
      operation: "extend",
      result: "accepted",
      reason: null,
      requestId: UUID,
    });
    // The batch mark carries every drained id (emit-then-mark, at-least-once).
    const markQuery = queries.find((q) => q.includes("SET delivered_at"));
    expect(markQuery).toBeDefined();
    const markValues = values[queries.indexOf(markQuery as string)];
    expect(markValues[0]).toEqual([rows[0].request_id, rows[1].request_id]);
  });

  it("swallows a query error and reports zero delivered", async () => {
    const { sql } = mockSql(() => {
      throw new Error("db down");
    });
    await expect(drainPendingElevatorOutcomes(sql)).resolves.toBe(0);
  });
});
