import type {
  AccountClaimResult,
  AccountIdentity,
} from "@/lib/account-link-core";
import { accountJson } from "./account-response";
import { type AccountSaveSummary, accountSaveSummary } from "./account-summary";
import type { db } from "./db";
import { logAccountLinkEvent } from "./monitoring";

type Sql = Awaited<ReturnType<typeof db>>;

export type AccountClaimSuccess = Extract<
  AccountClaimResult,
  { status: "claimed" | "already-linked" }
>;

/**
 * Maps the shared failure statuses of claimPlayerForAccount to their log
 * events and HTTP responses. Returns the account save summary instead when
 * the claim succeeded, leaving the route to run its own success steps
 * (session writes, success logging, response body).
 */
export async function claimFailureResponse(
  sql: Sql,
  result: AccountClaimResult,
  {
    codePrefix,
    identity,
    playerId,
    extraBody = {},
  }: {
    codePrefix: "claim" | "handoff";
    identity: AccountIdentity;
    playerId: string;
    extraBody?: Record<string, unknown>;
  },
): Promise<
  | { response: Response; result: null; save: null }
  | {
      response: null;
      result: AccountClaimSuccess;
      save: AccountSaveSummary | null;
    }
> {
  const logBase = {
    provider: identity.provider,
    subject: identity.subject,
    playerId,
  };
  if (result.status === "invalid-identity") {
    logAccountLinkEvent({
      code: `${codePrefix}_invalid_identity`,
      severity: "warn",
      ...logBase,
      result: result.status,
    });
    return {
      response: accountJson(
        { error: "account sign-in required", code: "sign_in_required" },
        { status: 401 },
      ),
      result: null,
      save: null,
    };
  }
  if (result.status === "player-not-found") {
    logAccountLinkEvent({
      code: `${codePrefix}_player_not_found`,
      severity: "warn",
      ...logBase,
      result: result.status,
    });
    return {
      response: accountJson(
        { error: "guest save not found", code: "guest_save_not_found" },
        { status: 404 },
      ),
      result: null,
      save: null,
    };
  }
  if (result.status === "target-linked-to-other-account") {
    logAccountLinkEvent({
      code: `${codePrefix}_target_linked_to_other_account`,
      severity: "warn",
      ...logBase,
      targetPlayerId: result.playerId,
      result: result.status,
    });
    return {
      response: accountJson(
        {
          error: "device save belongs to another account",
          code: "device_save_linked_to_other_account",
          ...extraBody,
        },
        { status: 409 },
      ),
      result: null,
      save: null,
    };
  }
  const save = await accountSaveSummary(sql, result.playerId);
  if (result.status === "conflict") {
    logAccountLinkEvent({
      code: `${codePrefix}_conflict`,
      severity: "warn",
      ...logBase,
      targetPlayerId: result.playerId,
      result: result.status,
    });
    return {
      response: accountJson(
        {
          error: "account already has a cloud save",
          code: "account_cloud_save_exists",
          mode: "conflict",
          ...extraBody,
          accountSave: save,
        },
        { status: 409 },
      ),
      result: null,
      save: null,
    };
  }
  return { response: null, result, save };
}
