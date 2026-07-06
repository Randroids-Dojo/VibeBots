import { accountLinkedSaveStatus } from "@/lib/account-link-core";
import { findLinkedPlayerId } from "@/server/account-linking";
import { accountJson, storageUnavailable } from "@/server/account-response";
import {
  currentReadyAccountIdentity,
  requestAccountSessionProvider,
} from "@/server/account-session";
import { accountSaveSummary } from "@/server/account-summary";
import { db, storageConfigured } from "@/server/db";
import {
  activeSaveSlotPlayerId,
  currentSaveSlotSession,
  setActiveSaveSlotPlayer,
} from "@/server/player";
import { sameOriginBrowserRequestAllowed } from "@/server/request-guards";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!storageConfigured()) return storageUnavailable();
  // The status dialog is the only account surface that shows the email, so
  // this is the only route that pays the Clerk user lookup for it.
  const provider = requestAccountSessionProvider(
    request,
    undefined,
    undefined,
    { withEmail: true },
  );
  const providerStatus = provider.status();
  const [identity, session] = await Promise.all([
    currentReadyAccountIdentity(provider, providerStatus),
    currentSaveSlotSession(),
  ]);
  const playerId = activeSaveSlotPlayerId(session);
  let activeSlot = session?.activeSlot ?? 1;
  if (!identity) {
    const currentSave = playerId
      ? await accountSaveSummary(await db(), playerId)
      : null;
    return accountJson({
      mode: "guest",
      providerStatus,
      activeSlot,
      account: null,
      currentSave,
      accountSave: null,
    });
  }

  const sql = await db();
  const accountPlayerId = await findLinkedPlayerId(sql, identity);
  let activePlayerId = playerId;
  if (
    accountPlayerId &&
    !activePlayerId &&
    sameOriginBrowserRequestAllowed(request)
  ) {
    const nextSession = await setActiveSaveSlotPlayer(accountPlayerId);
    activeSlot = nextSession.activeSlot;
    activePlayerId = accountPlayerId;
  }
  // In the cloud_loaded state the active and account players are the same id,
  // so avoid issuing the identical aggregate query twice.
  const sameSummaryPlayer = activePlayerId === accountPlayerId;
  const [currentSave, otherSave] = await Promise.all([
    accountSaveSummary(sql, activePlayerId),
    sameSummaryPlayer
      ? Promise.resolve(null)
      : accountSaveSummary(sql, accountPlayerId),
  ]);
  const accountSave = sameSummaryPlayer ? currentSave : otherSave;
  const linkedStatus = accountLinkedSaveStatus({
    activePlayerId,
    linkedPlayerId: accountPlayerId,
  });
  const mode =
    linkedStatus.status === "cloud-loaded"
      ? "cloud_loaded"
      : linkedStatus.status === "conflict"
        ? "conflict"
        : "signed_in";

  return accountJson({
    mode,
    providerStatus,
    activeSlot,
    account: { provider: identity.provider, email: identity.email ?? null },
    currentSave,
    accountSave,
  });
}
