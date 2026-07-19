import type { ElevatorMutation } from "@/server/monitoring";
import { logElevatorOutcomeEvent } from "@/server/monitoring";
import type { db } from "./db";

type Sql = Awaited<ReturnType<typeof db>>;

/**
 * Durable, deduplicated elevator-upgrade outcome delivery (F-121).
 *
 * The accepted-buy CTE inserts one `elevator_upgrade_outcomes` row per request
 * id, atomic with the charge (transactional outbox). This module owns the two
 * things that happen outside that transaction: emitting the structured
 * monitoring event to the log sink and marking the row delivered.
 *
 * Delivery is emit-then-mark, so it is at-least-once: a crash or sink outage
 * between the two never loses an outcome (the drain redelivers), and a repeated
 * delivery is deduplicated downstream by the request id carried on every line.
 * The durable row itself is exactly-once (the unique request id). Every helper
 * is best-effort: observability must never fail or roll back a committed buy.
 */

/** How old an undelivered row must be before the drain adopts it (seconds). */
const DRAIN_GRACE_SECONDS = 30;

/** How many stranded outcomes one opportunistic drain pass delivers. */
const DRAIN_BATCH_LIMIT = 20;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a client-supplied request id is a well-formed UUID. A non-UUID would
 * fail the `uuid` column insert, so the route mints a server-side id instead
 * (durable telemetry, no cross-request dedup) rather than rejecting the buy.
 */
export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Whether this request id already produced a committed outcome. A true result
 * means the buy is a replay of an already-applied request (a lost-success retry
 * that reused its id), so the route deduplicates it instead of re-charging.
 */
export async function elevatorOutcomeExists(
  sql: Sql,
  requestId: string,
): Promise<boolean> {
  const rows = (await sql`
    SELECT 1 FROM elevator_upgrade_outcomes
    WHERE request_id = ${requestId}
    LIMIT 1`) as Array<unknown>;
  return rows.length > 0;
}

/**
 * Emit the structured accepted outcome for a just-committed buy, then mark its
 * outbox row delivered. Best-effort: any sink or DB error is swallowed so the
 * committed buy still returns 200 and the row stays for the drain to redeliver.
 */
export async function deliverElevatorOutcome(
  sql: Sql,
  outcome: { requestId: string; playerId: string; operation: ElevatorMutation },
): Promise<void> {
  try {
    logElevatorOutcomeEvent({
      playerId: outcome.playerId,
      operation: outcome.operation,
      result: "accepted",
      reason: null,
      requestId: outcome.requestId,
    });
    await sql`
      UPDATE elevator_upgrade_outcomes
      SET delivered_at = now()
      WHERE request_id = ${outcome.requestId}
        AND delivered_at IS NULL`;
  } catch {
    // Swallow: delivery can never break gameplay; the drain redelivers.
  }
}

interface PendingOutcomeRow {
  request_id: string;
  player_id: string;
  operation: ElevatorMutation;
  result: string;
  reason: string | null;
}

/**
 * Redeliver outcomes that committed but were never delivered (a crash between
 * commit and delivery, or a sink outage). Emits each stranded row older than the
 * grace window, then marks the batch delivered. Best-effort and bounded; run
 * opportunistically on request traffic since the project has no cron. Returns
 * how many rows it delivered (0 on any error), for tests and observability.
 */
export async function drainPendingElevatorOutcomes(sql: Sql): Promise<number> {
  try {
    const rows = (await sql`
      SELECT request_id, player_id, operation, result, reason
      FROM elevator_upgrade_outcomes
      WHERE delivered_at IS NULL
        AND created_at < now() - (${DRAIN_GRACE_SECONDS} * interval '1 second')
      ORDER BY created_at
      LIMIT ${DRAIN_BATCH_LIMIT}`) as PendingOutcomeRow[];
    if (rows.length === 0) return 0;
    for (const row of rows) {
      logElevatorOutcomeEvent({
        playerId: row.player_id,
        operation: row.operation,
        result: row.result === "rejected" ? "rejected" : "accepted",
        reason: null,
        requestId: row.request_id,
      });
    }
    const ids = rows.map((row) => row.request_id);
    // Emit-then-mark: a concurrent drain may re-emit (deduplicated downstream by
    // request id) but no outcome is ever lost. The mark is idempotent.
    await sql`
      UPDATE elevator_upgrade_outcomes
      SET delivered_at = now()
      WHERE request_id = ANY(${ids}::uuid[])
        AND delivered_at IS NULL`;
    return rows.length;
  } catch {
    // Swallow: the drain is a best-effort backstop, never a request blocker.
    return 0;
  }
}
