import {
  type AccountLoadResult,
  loadPlayerForAccount,
} from "@/server/account-linking";
import { accountJson, storageUnavailable } from "@/server/account-response";
import {
  currentReadyAccountIdentity,
  requestAccountSessionProvider,
} from "@/server/account-session";
import { accountSaveSummary } from "@/server/account-summary";
import { db, storageConfigured } from "@/server/db";
import { logAccountLinkEvent } from "@/server/monitoring";
import {
  SaveSlotPreserveError,
  type SaveSlotSession,
  setActiveSaveSlotPlayer,
} from "@/server/player";
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
    return accountJson(
      { error: "account sign-in required", code: "sign_in_required" },
      { status: 401 },
    );
  }

  const sql = await db();
  let result: AccountLoadResult<SaveSlotSession>;
  try {
    result = await loadPlayerForAccount(sql, identity, {
      writeActivePlayer: setActiveSaveSlotPlayer,
    });
  } catch (error) {
    if (error instanceof SaveSlotPreserveError) {
      return accountJson(
        {
          error: "no empty save slot for device save",
          code: "device_save_slot_full",
        },
        { status: 409 },
      );
    }
    throw error;
  }
  if (result.status === "invalid-identity") {
    logAccountLinkEvent({
      code: "cloud_load_invalid_identity",
      severity: "warn",
      provider: identity.provider,
      subject: identity.subject,
    });
    return accountJson(
      { error: "account sign-in required", code: "sign_in_required" },
      { status: 401 },
    );
  }
  if (result.status === "not-found") {
    logAccountLinkEvent({
      code: "cloud_load_not_found",
      severity: "info",
      provider: identity.provider,
      subject: identity.subject,
    });
    return accountJson(
      { error: "cloud save not found", code: "cloud_save_not_found" },
      { status: 404 },
    );
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
