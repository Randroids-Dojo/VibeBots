import {
  type AccountClaimResult,
  type AccountIdentity,
  type AccountLinkStore,
  type AccountLoadResult,
  type AccountSessionWriter,
  claimAccountPlayer,
  loadLinkedAccountPlayer,
  normalizeAccountIdentity,
} from "@/lib/account-link-core";
import type { db } from "./db";

type Sql = Awaited<ReturnType<typeof db>>;

export {
  type AccountClaimResult,
  type AccountIdentity,
  type AccountLinkStore,
  type AccountLoadResult,
  type AccountSessionWriter,
  normalizeAccountIdentity,
};

interface LinkedPlayerRow {
  id: string;
}

interface PlayerAccountRow {
  id: string;
  clerk_user_id: string | null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function requireClerkIdentity(
  identity: AccountIdentity,
): AccountIdentity | null {
  const normalized = normalizeAccountIdentity(identity);
  if (normalized?.provider !== "clerk") return null;
  return normalized;
}

export function clerkPlayerAccountLinkStore(sql: Sql): AccountLinkStore {
  return {
    async findLinkedPlayer(identity) {
      const normalized = requireClerkIdentity(identity);
      if (!normalized) return null;
      const rows = (await sql`
        SELECT id
        FROM players
        WHERE clerk_user_id = ${normalized.subject}
        LIMIT 1`) as LinkedPlayerRow[];
      return rows[0]?.id ?? null;
    },
    async claimUnlinkedPlayer(identity, playerId) {
      const normalized = requireClerkIdentity(identity);
      if (!normalized) return { status: "invalid-identity" };
      let rows: LinkedPlayerRow[];
      try {
        rows = (await sql`
          UPDATE players
          SET clerk_user_id = ${normalized.subject}
          WHERE id = ${playerId}
            AND clerk_user_id IS NULL
          RETURNING id`) as LinkedPlayerRow[];
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const linkedPlayerId = await this.findLinkedPlayer(normalized);
        if (linkedPlayerId) {
          return {
            status: "linked-to-other-account",
            playerId: linkedPlayerId,
          };
        }
        throw error;
      }
      if (rows[0]) return { status: "claimed", playerId: rows[0].id };

      const playerRows = (await sql`
        SELECT id, clerk_user_id
        FROM players
        WHERE id = ${playerId}
        LIMIT 1`) as PlayerAccountRow[];
      const player = playerRows[0];
      if (!player) return { status: "player-not-found" };
      if (player.clerk_user_id === normalized.subject) {
        return { status: "already-linked", playerId };
      }
      return { status: "linked-to-other-account", playerId };
    },
  };
}

export async function findLinkedPlayerId(
  sql: Sql,
  identity: AccountIdentity,
): Promise<string | null> {
  return clerkPlayerAccountLinkStore(sql).findLinkedPlayer(identity);
}

export async function claimPlayerForAccount(
  sql: Sql,
  identity: AccountIdentity,
  playerId: string,
): Promise<AccountClaimResult> {
  return claimAccountPlayer(
    clerkPlayerAccountLinkStore(sql),
    identity,
    playerId,
  );
}

export async function loadPlayerForAccount<Session>(
  sql: Sql,
  identity: AccountIdentity,
  session: AccountSessionWriter<Session>,
): Promise<AccountLoadResult<Session>> {
  return loadLinkedAccountPlayer(
    clerkPlayerAccountLinkStore(sql),
    session,
    identity,
  );
}
