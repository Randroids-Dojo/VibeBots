import {
  createAccountHandoff,
  safeAccountReturnTo,
} from "@/server/account-handoff";
import { accountJson, storageUnavailable } from "@/server/account-response";
import { accountProviderReady } from "@/server/account-session";
import { db, storageConfigured } from "@/server/db";
import { logAccountLinkEvent } from "@/server/monitoring";
import { currentPlayerId } from "@/server/player";
import { sameOriginMutationRequired } from "@/server/request-guards";

export const runtime = "nodejs";

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function POST(request: Request): Promise<Response> {
  const rejected = sameOriginMutationRequired(request);
  if (rejected) return rejected;
  if (!storageConfigured()) return storageUnavailable();
  if (!accountProviderReady()) {
    return accountJson(
      { error: "account provider not configured" },
      { status: 503 },
    );
  }
  const playerId = await currentPlayerId();
  if (!playerId) {
    logAccountLinkEvent({
      code: "handoff_start_missing_player",
      severity: "warn",
    });
    return accountJson({ error: "guest save required" }, { status: 409 });
  }
  const body = await readBody(request);
  const returnTo = safeAccountReturnTo(body.returnTo);
  const handoff = await createAccountHandoff(await db(), playerId, returnTo);
  logAccountLinkEvent({
    code: "handoff_started",
    severity: "info",
    playerId,
  });
  return accountJson({
    handoffId: handoff.token,
    expiresAt: handoff.expiresAt,
    returnTo: handoff.returnTo,
  });
}
