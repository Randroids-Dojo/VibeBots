import { claimFailureResponse } from "@/server/account-claim-response";
import {
  consumeAccountHandoff,
  safeAccountHandoffId,
} from "@/server/account-handoff";
import { claimPlayerForAccount } from "@/server/account-linking";
import {
  accountJson,
  guestSaveRequired,
  safeJsonBody,
  signInRequired,
  storageUnavailable,
} from "@/server/account-response";
import {
  currentReadyAccountIdentity,
  requestAccountSessionProvider,
} from "@/server/account-session";
import { db, storageConfigured } from "@/server/db";
import { logAccountLinkEvent } from "@/server/monitoring";
import {
  currentPlayerId,
  SaveSlotPreserveError,
  type SaveSlotSession,
  setActiveSaveSlotPlayer,
} from "@/server/player";
import { sameOriginMutationRequired } from "@/server/request-guards";

export const runtime = "nodejs";

async function handoffIdFromRequest(request: Request): Promise<string | null> {
  return safeAccountHandoffId((await safeJsonBody(request))?.handoffId);
}

export async function POST(request: Request): Promise<Response> {
  const rejected = sameOriginMutationRequired(request);
  if (rejected) return rejected;
  if (!storageConfigured()) return storageUnavailable();
  const identity = await currentReadyAccountIdentity(
    requestAccountSessionProvider(request),
  );
  if (!identity) {
    return signInRequired();
  }
  const handoffId = await handoffIdFromRequest(request);
  if (!handoffId) {
    return accountJson(
      { error: "handoff id required", code: "handoff_id_required" },
      { status: 400 },
    );
  }
  const activePlayerId = await currentPlayerId();
  if (!activePlayerId) {
    logAccountLinkEvent({
      code: "handoff_missing_initiating_session",
      severity: "warn",
      provider: identity.provider,
      subject: identity.subject,
    });
    return guestSaveRequired();
  }

  const sql = await db();
  const handoff = await consumeAccountHandoff(sql, handoffId, activePlayerId);
  if (!handoff) {
    logAccountLinkEvent({
      code: "handoff_expired",
      severity: "info",
      provider: identity.provider,
      subject: identity.subject,
    });
    return accountJson(
      { error: "handoff expired or already used", code: "handoff_expired" },
      { status: 410 },
    );
  }

  const outcome = await claimFailureResponse(
    sql,
    await claimPlayerForAccount(sql, identity, handoff.playerId),
    {
      codePrefix: "handoff",
      identity,
      playerId: handoff.playerId,
      extraBody: { returnTo: handoff.returnTo },
    },
  );
  if (outcome.response) return outcome.response;
  const { result, save: accountSave } = outcome;

  let session: SaveSlotSession;
  try {
    session = await setActiveSaveSlotPlayer(result.playerId);
  } catch (error) {
    if (error instanceof SaveSlotPreserveError) {
      return accountJson(
        {
          error: "no empty save slot for device save",
          code: "device_save_slot_full",
          returnTo: handoff.returnTo,
        },
        { status: 409 },
      );
    }
    throw error;
  }
  logAccountLinkEvent({
    code:
      result.status === "already-linked"
        ? "handoff_already_linked"
        : "handoff_succeeded",
    severity: "info",
    provider: identity.provider,
    subject: identity.subject,
    playerId: handoff.playerId,
    targetPlayerId: result.playerId,
    activeSlot: session.activeSlot,
    result: result.status,
  });
  return accountJson({
    mode: "cloud_loaded",
    result: result.status,
    activeSlot: session.activeSlot,
    returnTo: handoff.returnTo,
    accountSave,
  });
}
