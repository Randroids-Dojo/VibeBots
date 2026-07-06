import { randomUUID } from "node:crypto";
import {
  safeAccountHandoffId,
  safeAccountReturnTo,
} from "@/lib/account-handoff-contract";
import type { db } from "./db";

type Sql = Awaited<ReturnType<typeof db>>;

const HANDOFF_TTL_MS = 10 * 60 * 1000;

export { safeAccountHandoffId, safeAccountReturnTo };

export interface AccountHandoff {
  token: string;
  playerId: string;
  returnTo: string;
  expiresAt: string;
}

interface AccountHandoffRow {
  token: string;
  player_id: string;
  return_to: string;
  expires_at: string;
}

function handoffFromRow(row: AccountHandoffRow): AccountHandoff {
  return {
    token: row.token,
    playerId: row.player_id,
    returnTo: row.return_to,
    expiresAt: row.expires_at,
  };
}

export async function createAccountHandoff(
  sql: Sql,
  playerId: string,
  returnTo: string,
): Promise<AccountHandoff> {
  // One roundtrip cleans up dead rows everywhere plus this player's pending
  // handoffs (a new sign-in supersedes any handoff still in flight).
  await sql`
    DELETE FROM account_handoffs
    WHERE consumed_at IS NOT NULL
       OR expires_at <= now()
       OR (player_id = ${playerId} AND consumed_at IS NULL)`;
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS).toISOString();
  const token = randomUUID();
  const rows = (await sql`
    INSERT INTO account_handoffs (token, player_id, return_to, expires_at)
    VALUES (${token}, ${playerId}, ${safeAccountReturnTo(returnTo)}, ${expiresAt})
    RETURNING token, player_id, return_to, expires_at`) as AccountHandoffRow[];
  return handoffFromRow(rows[0]);
}

export async function consumeAccountHandoff(
  sql: Sql,
  token: string,
  playerId: string,
): Promise<AccountHandoff | null> {
  const rows = (await sql`
    UPDATE account_handoffs
    SET consumed_at = now()
    WHERE token = ${token}
      AND player_id = ${playerId}
      AND consumed_at IS NULL
      AND expires_at > now()
    RETURNING token, player_id, return_to, expires_at`) as AccountHandoffRow[];
  return rows[0] ? handoffFromRow(rows[0]) : null;
}
