import { loadPlayerForAccount } from "@/server/account-linking";
import { accountJson } from "@/server/account-response";
import {
  currentReadyAccountIdentity,
  requestAccountSessionProvider,
} from "@/server/account-session";
import { accountSaveSummary } from "@/server/account-summary";
import { db, storageConfigured } from "@/server/db";
import { logAccountLinkEvent } from "@/server/monitoring";
import { setActiveSaveSlotPlayer } from "@/server/player";
import { sameOriginMutationRequired } from "@/server/request-guards";

export const runtime = "nodejs";

function storageUnavailable(): Response {
  return accountJson({ error: "storage not configured" }, { status: 503 });
}

export async function POST(request: Request): Promise<Response> {
  const rejected = sameOriginMutationRequired(request);
  if (rejected) return rejected;
  if (!storageConfigured()) return storageUnavailable();
  const identity = await currentReadyAccountIdentity(
    requestAccountSessionProvider(request),
  );
  if (!identity) {
    return accountJson({ error: "account sign-in required" }, { status: 401 });
  }

  const sql = await db();
  const result = await loadPlayerForAccount(sql, identity, {
    writeActivePlayer: setActiveSaveSlotPlayer,
  });
  if (result.status === "invalid-identity") {
    return accountJson({ error: "account sign-in required" }, { status: 401 });
  }
  if (result.status === "not-found") {
    logAccountLinkEvent({
      code: "cloud_load_not_found",
      severity: "info",
      provider: identity.provider,
      subject: identity.subject,
    });
    return accountJson({ error: "cloud save not found" }, { status: 404 });
  }
  const accountSave = await accountSaveSummary(sql, result.playerId);
  logAccountLinkEvent({
    code: "cloud_load_succeeded",
    severity: "info",
    provider: identity.provider,
    subject: identity.subject,
    targetPlayerId: result.playerId,
    activeSlot: result.session.activeSlot,
  });
  return accountJson({
    mode: "cloud_loaded",
    activeSlot: result.session.activeSlot,
    accountSave,
  });
}
