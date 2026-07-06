import type { AccountIdentity } from "@/lib/account-link-core";
import { claimFailureResponse } from "@/server/account-claim-response";
import { claimPlayerForAccount } from "@/server/account-linking";
import { accountJson, storageUnavailable } from "@/server/account-response";
import {
  currentReadyAccountIdentity,
  requestAccountSessionProvider,
} from "@/server/account-session";
import { db, storageConfigured } from "@/server/db";
import { logAccountLinkEvent } from "@/server/monitoring";
import { currentPlayerId } from "@/server/player";
import { sameOriginMutationRequired } from "@/server/request-guards";

export const runtime = "nodejs";

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

  try {
    return await claimForIdentity(identity, playerId);
  } catch {
    logAccountLinkEvent({
      code: "claim_failed",
      severity: "error",
      provider: identity.provider,
      subject: identity.subject,
      playerId,
    });
    return accountJson(
      { error: "account claim failed", code: "claim_failed" },
      { status: 503 },
    );
  }
}

async function claimForIdentity(
  identity: AccountIdentity,
  playerId: string,
): Promise<Response> {
  const sql = await db();
  const outcome = await claimFailureResponse(
    sql,
    await claimPlayerForAccount(sql, identity, playerId),
    { codePrefix: "claim", identity, playerId },
  );
  if (outcome.response) return outcome.response;
  logAccountLinkEvent({
    code:
      outcome.result.status === "already-linked"
        ? "claim_already_linked"
        : "claim_succeeded",
    severity: "info",
    provider: identity.provider,
    subject: identity.subject,
    playerId,
    targetPlayerId: outcome.result.playerId,
    result: outcome.result.status,
  });
  return accountJson({
    mode: "cloud_loaded",
    result: outcome.result.status,
    accountSave: outcome.save,
  });
}
