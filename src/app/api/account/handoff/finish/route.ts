import {
  consumeAccountHandoff,
  safeAccountHandoffId,
} from "@/server/account-handoff";
import { claimPlayerForAccount } from "@/server/account-linking";
import { accountJson } from "@/server/account-response";
import {
  currentReadyAccountIdentity,
  requestAccountSessionProvider,
} from "@/server/account-session";
import { accountSaveSummary } from "@/server/account-summary";
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

function storageUnavailable(): Response {
  return accountJson({ error: "storage not configured" }, { status: 503 });
}

async function handoffIdFromRequest(request: Request): Promise<string | null> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") return null;
    const handoffId = (body as Record<string, unknown>).handoffId;
    return safeAccountHandoffId(handoffId);
  } catch {
    return null;
  }
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
  const handoffId = await handoffIdFromRequest(request);
  if (!handoffId) {
    return accountJson({ error: "handoff id required" }, { status: 400 });
  }
  const activePlayerId = await currentPlayerId();
  if (!activePlayerId) {
    logAccountLinkEvent({
      code: "handoff_missing_initiating_session",
      severity: "warn",
      provider: identity.provider,
      subject: identity.subject,
    });
    return accountJson({ error: "guest save required" }, { status: 409 });
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
      { error: "handoff expired or already used" },
      { status: 410 },
    );
  }

  const result = await claimPlayerForAccount(sql, identity, handoff.playerId);
  if (result.status === "invalid-identity") {
    logAccountLinkEvent({
      code: "handoff_invalid_identity",
      severity: "warn",
      provider: identity.provider,
      subject: identity.subject,
      playerId: handoff.playerId,
      result: result.status,
    });
    return accountJson({ error: "account sign-in required" }, { status: 401 });
  }
  if (result.status === "player-not-found") {
    logAccountLinkEvent({
      code: "handoff_player_not_found",
      severity: "warn",
      provider: identity.provider,
      subject: identity.subject,
      playerId: handoff.playerId,
      result: result.status,
    });
    return accountJson({ error: "guest save not found" }, { status: 404 });
  }
  if (result.status === "target-linked-to-other-account") {
    logAccountLinkEvent({
      code: "handoff_target_linked_to_other_account",
      severity: "warn",
      provider: identity.provider,
      subject: identity.subject,
      playerId: handoff.playerId,
      targetPlayerId: result.playerId,
      result: result.status,
    });
    return accountJson(
      {
        error: "device save belongs to another account",
        code: "device_save_linked_to_other_account",
        returnTo: handoff.returnTo,
      },
      { status: 409 },
    );
  }
  const accountSave = await accountSaveSummary(sql, result.playerId);
  if (result.status === "conflict") {
    logAccountLinkEvent({
      code: "handoff_conflict",
      severity: "warn",
      provider: identity.provider,
      subject: identity.subject,
      playerId: handoff.playerId,
      targetPlayerId: result.playerId,
      result: result.status,
    });
    return accountJson(
      {
        error: "account already has a cloud save",
        mode: "conflict",
        returnTo: handoff.returnTo,
        accountSave,
      },
      { status: 409 },
    );
  }

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
