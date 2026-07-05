import { claimPlayerForAccount } from "@/server/account-linking";
import { accountJson } from "@/server/account-response";
import {
  currentReadyAccountIdentity,
  requestAccountSessionProvider,
} from "@/server/account-session";
import { accountSaveSummary } from "@/server/account-summary";
import { db, storageConfigured } from "@/server/db";
import { logAccountLinkEvent } from "@/server/monitoring";
import { currentPlayerId } from "@/server/player";
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
  const playerId = await currentPlayerId();
  if (!playerId) {
    return accountJson({ error: "guest save required" }, { status: 409 });
  }

  const sql = await db();
  const result = await claimPlayerForAccount(sql, identity, playerId);
  if (result.status === "invalid-identity") {
    logAccountLinkEvent({
      code: "claim_invalid_identity",
      severity: "warn",
      provider: identity.provider,
      subject: identity.subject,
      playerId,
      result: result.status,
    });
    return accountJson({ error: "account sign-in required" }, { status: 401 });
  }
  if (result.status === "player-not-found") {
    logAccountLinkEvent({
      code: "claim_player_not_found",
      severity: "warn",
      provider: identity.provider,
      subject: identity.subject,
      playerId,
      result: result.status,
    });
    return accountJson({ error: "guest save not found" }, { status: 404 });
  }
  const save = await accountSaveSummary(sql, result.playerId);
  if (result.status === "conflict") {
    logAccountLinkEvent({
      code: "claim_conflict",
      severity: "warn",
      provider: identity.provider,
      subject: identity.subject,
      playerId,
      targetPlayerId: result.playerId,
      result: result.status,
    });
    return accountJson(
      {
        error: "account already has a cloud save",
        mode: "conflict",
        accountSave: save,
      },
      { status: 409 },
    );
  }
  logAccountLinkEvent({
    code:
      result.status === "already-linked"
        ? "claim_already_linked"
        : "claim_succeeded",
    severity: "info",
    provider: identity.provider,
    subject: identity.subject,
    playerId,
    targetPlayerId: result.playerId,
    result: result.status,
  });
  return accountJson({
    mode: "cloud_loaded",
    result: result.status,
    accountSave: save,
  });
}
