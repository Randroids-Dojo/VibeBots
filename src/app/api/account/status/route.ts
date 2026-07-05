import { accountLinkedSaveStatus } from "@/lib/account-link-core";
import { findLinkedPlayerId } from "@/server/account-linking";
import { accountJson } from "@/server/account-response";
import {
  currentReadyAccountIdentity,
  requestAccountSessionProvider,
} from "@/server/account-session";
import { accountSaveSummary } from "@/server/account-summary";
import { db, storageConfigured } from "@/server/db";
import {
  currentPlayerId,
  currentSaveSlotSession,
  setActiveSaveSlotPlayer,
} from "@/server/player";
import { sameOriginBrowserRequestAllowed } from "@/server/request-guards";

export const runtime = "nodejs";

function storageUnavailable(): Response {
  return accountJson({ error: "storage not configured" }, { status: 503 });
}

export async function GET(request: Request): Promise<Response> {
  if (!storageConfigured()) return storageUnavailable();
  const provider = requestAccountSessionProvider(request);
  const providerStatus = provider.status();
  const [identity, session, playerId] = await Promise.all([
    currentReadyAccountIdentity(provider, providerStatus),
    currentSaveSlotSession(),
    currentPlayerId(),
  ]);
  let activeSlot = session?.activeSlot ?? 1;
  if (!identity) {
    const currentSave = playerId
      ? await accountSaveSummary(await db(), playerId)
      : null;
    return accountJson({
      mode: "guest",
      providerReady: providerStatus.ready,
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
  const [currentSave, accountSave] = await Promise.all([
    accountSaveSummary(sql, activePlayerId),
    accountSaveSummary(sql, accountPlayerId),
  ]);
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
    providerReady: providerStatus.ready,
    providerStatus,
    activeSlot,
    account: { provider: identity.provider, email: identity.email ?? null },
    currentSave,
    accountSave,
  });
}
