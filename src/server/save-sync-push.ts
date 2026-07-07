import { after } from "next/server";
import { PUSH_ENDPOINT_HASH_HEADER } from "@/lib/api-codes";
import type { db } from "./db";
import { sendSaveSyncPushToOtherDevices } from "./web-push";

type Sql = Awaited<ReturnType<typeof db>>;

/** The sender's own endpoint hash from the request, or null when absent. */
export function pushEndpointHashFromRequest(request: Request): string | null {
  const hash = request.headers.get(PUSH_ENDPOINT_HASH_HEADER)?.trim() ?? "";
  return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

/**
 * Queues the save-sync wake-up for the player's other devices without
 * blocking the response. Push delivery is best-effort by design: failures
 * are swallowed because the in-app freshness probe remains the mechanism.
 */
export function queueSaveSyncPush(options: {
  sql: Sql;
  playerId: string;
  excludeEndpointHash: string | null;
}): void {
  const send = async () => {
    try {
      await sendSaveSyncPushToOtherDevices(options);
    } catch {
      // Best effort only.
    }
  };
  try {
    after(send);
  } catch {
    // Outside a request scope (tests, scripts): fire without the hook.
    void send();
  }
}
