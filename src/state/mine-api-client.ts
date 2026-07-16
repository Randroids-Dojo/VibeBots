import {
  safeAccountHandoffId,
  safeAccountReturnTo,
} from "@/lib/account-handoff-contract";
import {
  hasControlCharacter,
  MAX_EMAIL_LENGTH,
  MAX_PROVIDER_LENGTH,
  PROVIDER_TOKEN_RE,
} from "@/lib/account-link-core";
import {
  type AccountProviderIssue,
  type AccountProviderStatus,
  isAccountProviderIssue,
} from "@/lib/account-provider-status";
import {
  type AccountErrorCode,
  accountErrorCode,
  apiErrorCode,
  MINE_VERSION_MISMATCH_CODE,
  PUSH_ENDPOINT_HASH_HEADER,
  STALE_TRIP_CHECKPOINT_CODE,
  TRIP_ALREADY_CASHED_OUT_CODE,
} from "@/lib/api-codes";
import type { AccountSaveSummary } from "@/server/account-summary";
import {
  isMineAction,
  MINE_VERSION,
  type MineConsumables,
  type MineGearSnapshot,
  type MineGearTrack,
  normalizeGear,
} from "@/sim/mine";
import {
  normalizePendingBunker,
  type SavedTrip,
  type SaveSlotId,
  validSaveSlot,
} from "./mine-trip-persistence";

export interface SaveSlotSummary {
  slot: SaveSlotId;
  active: boolean;
  exists: boolean;
  createdAt: string | null;
  balance: number;
  deepestDepth: number;
  partsOwned: number;
  designs: number;
  stamps: number;
}

export type AccountStatusMode =
  | "guest"
  | "signed_in"
  | "cloud_loaded"
  | "conflict";

export type { AccountProviderIssue, AccountProviderStatus, AccountSaveSummary };

export interface AccountStatus {
  mode: AccountStatusMode;
  providerStatus: AccountProviderStatus;
  activeSlot: SaveSlotId;
  account: { provider: string; email: string | null } | null;
  currentSave: AccountSaveSummary | null;
  accountSave: AccountSaveSummary | null;
}

export interface AccountHandoffStart {
  handoffId: string;
  expiresAt: string;
  returnTo: string;
}

export interface AccountCloudLoadResult {
  mode: "cloud_loaded";
  activeSlot: SaveSlotId;
  accountSave: AccountSaveSummary;
}

export type MineApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: unknown }
  | { ok: false; status: null; body: null };

/**
 * Player-facing copy for every account error code (F-068). The server's
 * prose is free to change; flow logic and this map key off the code.
 */
const ACCOUNT_ERROR_COPY: Record<AccountErrorCode, string> = {
  sign_in_required: "account sign-in required",
  guest_save_required: "guest save required",
  guest_save_not_found: "guest save not found",
  device_save_linked_to_other_account: "device save belongs to another account",
  account_cloud_save_exists: "account already has a cloud save",
  device_save_slot_full: "no empty save slot for device save",
  handoff_id_required: "handoff id required",
  handoff_expired: "sign-in handoff expired",
  provider_not_configured: "account provider not configured",
  cloud_save_not_found: "cloud save not found",
  storage_not_configured: "storage not configured",
  same_origin_required: "same-origin request required",
  claim_failed: "account claim failed",
  invalid_trip_checkpoint: "invalid trip checkpoint",
  stale_trip_checkpoint: "trip checkpoint is stale",
  linked_account_save_delete_blocked:
    "linked account saves cannot be deleted from this device",
};

export function accountErrorMessageFromResponse(
  body: unknown,
  fallback: string,
): string {
  const code = accountErrorCode(body);
  return code ? ACCOUNT_ERROR_COPY[code] : fallback;
}

async function mineApi<T>(
  url: string,
  init?: RequestInit,
): Promise<MineApiResult<T>> {
  try {
    const res = init === undefined ? await fetch(url) : await fetch(url, init);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
      if (res.ok) return { ok: false, status: res.status, body };
    }
    if (!res.ok) return { ok: false, status: res.status, body };
    return { ok: true, status: res.status, body: body as T };
  } catch {
    return { ok: false, status: null, body: null };
  }
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * Hex sha-256 of this device's own push endpoint, so save-mutating requests
 * can tell the server which subscription not to wake. Null whenever push is
 * unavailable or not subscribed; the server then notifies every device.
 */
async function currentPushEndpointHash(): Promise<string | null> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return null;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return null;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(subscription.endpoint),
    );
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

async function withPushEndpointHash(init: RequestInit): Promise<RequestInit> {
  const hash = await currentPushEndpointHash();
  if (!hash) return init;
  return {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      [PUSH_ENDPOINT_HASH_HEADER]: hash,
    },
  };
}

function accountMutation(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      "x-vibebots-account-mutation": "1",
    },
  };
}

export function deleteSaveSlotConfirmation(slot: SaveSlotId): string {
  return `DELETE SLOT ${slot}`;
}

export function saveSlotSummariesFromResponse(value: unknown): {
  activeSlot: SaveSlotId;
  slots: SaveSlotSummary[];
} | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { activeSlot?: unknown; slots?: unknown };
  const activeSlot = validSaveSlot(body.activeSlot);
  if (!activeSlot || !Array.isArray(body.slots)) return null;
  const slots = body.slots.flatMap((candidate): SaveSlotSummary[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const raw = candidate as Partial<Record<keyof SaveSlotSummary, unknown>>;
    const slot = validSaveSlot(raw.slot);
    if (!slot) return [];
    return [
      {
        slot,
        active: raw.active === true,
        exists: raw.exists === true,
        createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
        balance: typeof raw.balance === "number" ? raw.balance : 0,
        deepestDepth:
          typeof raw.deepestDepth === "number" ? raw.deepestDepth : 0,
        partsOwned: typeof raw.partsOwned === "number" ? raw.partsOwned : 0,
        designs: typeof raw.designs === "number" ? raw.designs : 0,
        stamps: typeof raw.stamps === "number" ? raw.stamps : 0,
      },
    ];
  });
  return { activeSlot, slots };
}

function accountSaveSummaryFromResponse(
  value: unknown,
): AccountSaveSummary | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Record<keyof AccountSaveSummary, unknown>>;
  return {
    exists: raw.exists === true,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    balance: typeof raw.balance === "number" ? raw.balance : 0,
    deepestDepth: typeof raw.deepestDepth === "number" ? raw.deepestDepth : 0,
    partsOwned: typeof raw.partsOwned === "number" ? raw.partsOwned : 0,
    designs: typeof raw.designs === "number" ? raw.designs : 0,
    stamps: typeof raw.stamps === "number" ? raw.stamps : 0,
  };
}

function accountMetadataTextFromResponse(
  value: unknown,
  maxLength: number,
  pattern?: RegExp,
  lower = false,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const normalized = lower ? trimmed.toLowerCase() : trimmed;
  if (!normalized || normalized.length > maxLength) return null;
  if (hasControlCharacter(normalized)) return null;
  if (pattern && !pattern.test(normalized)) return null;
  return normalized;
}

function accountFromResponse(
  value: unknown,
): { provider: string; email: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const provider = accountMetadataTextFromResponse(
    raw.provider,
    MAX_PROVIDER_LENGTH,
    PROVIDER_TOKEN_RE,
    true,
  );
  if (!provider) return null;
  const emailPresent = raw.email !== null && raw.email !== undefined;
  const email = emailPresent
    ? accountMetadataTextFromResponse(raw.email, MAX_EMAIL_LENGTH)
    : null;
  if (emailPresent && email === null) return null;
  return {
    provider,
    email,
  };
}

function accountProviderStatusFromResponse(
  value: unknown,
): AccountProviderStatus {
  if (!value || typeof value !== "object") {
    return {
      provider: "clerk",
      ready: false,
      reason: null,
      issues: [],
    };
  }
  const raw = value as Record<string, unknown>;
  const provider = raw.provider === "clerk" ? "clerk" : null;
  const reason =
    typeof raw.reason === "string" && isAccountProviderIssue(raw.reason)
      ? raw.reason
      : null;
  const rawIssueValues = Array.isArray(raw.issues)
    ? raw.issues
    : typeof raw.reason === "string"
      ? [raw.reason]
      : [];
  const hasUnknownIssue = rawIssueValues.some(
    (issue) => typeof issue !== "string" || !isAccountProviderIssue(issue),
  );
  const issues = rawIssueValues.filter(isAccountProviderIssue);
  const normalizedIssues = issues.length ? issues : reason ? [reason] : [];
  const ready =
    provider === "clerk" &&
    raw.ready === true &&
    !reason &&
    !normalizedIssues.length &&
    !hasUnknownIssue;
  if (ready) {
    return {
      provider: "clerk",
      ready: true,
      reason: null,
      issues: [],
    };
  }
  return {
    provider: "clerk",
    ready: false,
    reason,
    issues: normalizedIssues,
  };
}

export function accountStatusFromResponse(
  value: unknown,
): AccountStatus | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const mode = body.mode;
  if (
    mode !== "guest" &&
    mode !== "signed_in" &&
    mode !== "cloud_loaded" &&
    mode !== "conflict"
  ) {
    return null;
  }
  const activeSlot = validSaveSlot(body.activeSlot) ?? 1;
  const account = accountFromResponse(body.account);
  const currentSave = accountSaveSummaryFromResponse(body.currentSave);
  const accountSave = accountSaveSummaryFromResponse(body.accountSave);
  if (mode !== "guest" && !account) return null;
  if (
    (mode === "cloud_loaded" || mode === "conflict") &&
    accountSave?.exists !== true
  ) {
    return null;
  }
  return {
    mode,
    providerStatus: accountProviderStatusFromResponse(body.providerStatus),
    activeSlot,
    account,
    currentSave,
    accountSave,
  };
}

export function accountHandoffStartFromResponse(
  value: unknown,
): AccountHandoffStart | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const handoffId =
    typeof body.handoffId === "string"
      ? safeAccountHandoffId(body.handoffId)
      : null;
  if (
    !handoffId ||
    typeof body.expiresAt !== "string" ||
    typeof body.returnTo !== "string"
  ) {
    return null;
  }
  return {
    handoffId,
    expiresAt: body.expiresAt,
    returnTo: safeAccountReturnTo(body.returnTo),
  };
}

export function accountCloudLoadFromResponse(
  value: unknown,
): AccountCloudLoadResult | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const activeSlot = validSaveSlot(body.activeSlot);
  const accountSave = accountSaveSummaryFromResponse(body.accountSave);
  if (body.mode !== "cloud_loaded" || !activeSlot || !accountSave?.exists) {
    return null;
  }
  return {
    mode: "cloud_loaded",
    activeSlot,
    accountSave,
  };
}

export function accountTripFromResponse(value: unknown): SavedTrip | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const trip = body.trip;
  if (!trip || typeof trip !== "object") return null;
  const raw = trip as Partial<Record<keyof SavedTrip, unknown>>;
  const pendingBunkerPresent =
    raw.pendingBunker !== null && raw.pendingBunker !== undefined;
  // One shared schema validates the checkpoint (F-112): a present-but-invalid
  // bunker rejects the whole trip instead of loading a half-broken state.
  const pendingBunker = normalizePendingBunker(raw.pendingBunker);
  if (
    raw.mineVersion !== MINE_VERSION ||
    typeof raw.seed !== "number" ||
    typeof raw.tripIndex !== "number" ||
    !raw.gear ||
    typeof raw.gear !== "object" ||
    !raw.consumables ||
    typeof raw.consumables !== "object" ||
    !Array.isArray(raw.baseDiff) ||
    !Array.isArray(raw.moves) ||
    !raw.moves.every(
      (move) => typeof move === "string" && isMineAction(move),
    ) ||
    (pendingBunkerPresent && pendingBunker === null)
  ) {
    return null;
  }
  return {
    mineVersion: MINE_VERSION,
    seed: raw.seed,
    tripIndex: raw.tripIndex,
    gear: normalizeGear(raw.gear as MineGearSnapshot),
    consumables: raw.consumables as SavedTrip["consumables"],
    baseDiff: raw.baseDiff as SavedTrip["baseDiff"],
    moves: raw.moves as SavedTrip["moves"],
    pendingBunker,
    terminalReplayConsumed:
      typeof raw.terminalReplayConsumed === "boolean"
        ? raw.terminalReplayConsumed
        : undefined,
  };
}

export function consumablesFromResponse(
  value: unknown,
): MineConsumables | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Record<keyof MineConsumables, unknown>>;
  if (
    typeof candidate.dynamite !== "number" ||
    typeof candidate.rope !== "number" ||
    typeof candidate.ladder !== "number" ||
    typeof candidate.plank !== "number" ||
    typeof candidate.beacon !== "number"
  ) {
    return null;
  }
  return {
    dynamite: candidate.dynamite,
    rope: candidate.rope,
    ladder: candidate.ladder,
    plank: candidate.plank,
    beacon: candidate.beacon,
  };
}

export function isMineVersionMismatch(body: unknown): boolean {
  return apiErrorCode(body) === MINE_VERSION_MISMATCH_CODE;
}

export function isTripAlreadyCashedOut(body: unknown): boolean {
  return apiErrorCode(body) === TRIP_ALREADY_CASHED_OUT_CODE;
}

export function isStaleTripCheckpoint(body: unknown): boolean {
  return apiErrorCode(body) === STALE_TRIP_CHECKPOINT_CODE;
}

export interface MineWorldVersion {
  seed: number;
  tripCount: number;
}

export function worldVersionFromResponse(
  value: unknown,
): MineWorldVersion | null {
  if (!value || typeof value !== "object") return null;
  const world = (value as { world?: unknown }).world;
  if (!world || typeof world !== "object") return null;
  const raw = world as Partial<Record<keyof MineWorldVersion, unknown>>;
  if (typeof raw.seed !== "number" || typeof raw.tripCount !== "number") {
    return null;
  }
  return { seed: raw.seed, tripCount: raw.tripCount };
}

export function cashOutErrorMessage(body: unknown): string {
  if (isMineVersionMismatch(body)) {
    return "Mine updated. Your save is restored; start a fresh trip.";
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
  }
  return "cash out failed";
}

export function loadMineWorld() {
  return mineApi<unknown>("/api/mine/world");
}

export function loadMineWorldVersion() {
  return mineApi<unknown>("/api/mine/world/version");
}

export function loadMineGear() {
  return mineApi<unknown>("/api/gear");
}

export function loadSaveSlotSummaries() {
  return mineApi<unknown>("/api/save-slots");
}

export function loadAccountStatus() {
  return mineApi<unknown>("/api/account/status");
}

export async function claimRemoteAccountSave() {
  return mineApi<unknown>(
    "/api/account/claim",
    await withPushEndpointHash(accountMutation({ method: "POST" })),
  );
}

export function startRemoteAccountHandoff(returnTo = "/mine") {
  return mineApi<unknown>(
    "/api/account/handoff/start",
    accountMutation(jsonPost({ returnTo })),
  );
}

export function finishRemoteAccountHandoff(handoffId: string) {
  const safeHandoffId = safeAccountHandoffId(handoffId);
  if (!safeHandoffId) {
    return Promise.resolve({
      ok: false,
      status: 400,
      body: { error: "handoff id required" },
    } as const satisfies MineApiResult<unknown>);
  }
  return mineApi<unknown>(
    "/api/account/handoff/finish",
    accountMutation(jsonPost({ handoffId: safeHandoffId })),
  );
}

export function loadRemoteAccountSave() {
  return mineApi<unknown>(
    "/api/account/load",
    accountMutation({ method: "POST" }),
  );
}

export function loadRemoteAccountTrip() {
  return mineApi<unknown>("/api/account/trip");
}

export function storeRemoteAccountTrip(trip: SavedTrip) {
  return mineApi<unknown>(
    "/api/account/trip",
    accountMutation({
      ...jsonPost({ trip }),
      method: "PUT",
    }),
  );
}

export function clearRemoteAccountTrip() {
  return mineApi<unknown>(
    "/api/account/trip",
    accountMutation({ method: "DELETE" }),
  );
}

export function switchRemoteSaveSlot(
  slot: SaveSlotId,
  options: { create?: boolean } = {},
) {
  return mineApi<unknown>(
    "/api/save-slots",
    jsonPost({ slot, create: options.create === true }),
  );
}

export function deleteRemoteSaveSlot(slot: SaveSlotId) {
  return mineApi<unknown>("/api/save-slots", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      slot,
      confirm: deleteSaveSlotConfirmation(slot),
    }),
  });
}

export async function submitMineBank(body: {
  seed: number;
  tripIndex: number;
  moves: unknown;
  gear: unknown;
  consumables: unknown;
  pendingBunker?: unknown;
}) {
  return mineApi<unknown>(
    "/api/mine/bank",
    await withPushEndpointHash(
      jsonPost({
        ...body,
        mineVersion: MINE_VERSION,
      }),
    ),
  );
}

export function buyRemoteConsumable(
  item: keyof MineConsumables,
  quantity: number,
) {
  return mineApi<unknown>("/api/consumables/buy", jsonPost({ item, quantity }));
}

export function buyRemoteGearUpgrade(track: MineGearTrack) {
  return mineApi<unknown>("/api/gear/upgrade", jsonPost({ track }));
}

export async function buyRemoteElevator(
  column?: number,
  expectedDepth?: number,
) {
  const payload: { column?: number; expectedDepth?: number } = {};
  if (column !== undefined) payload.column = column;
  if (expectedDepth !== undefined) payload.expectedDepth = expectedDepth;
  return mineApi<unknown>(
    "/api/elevator/upgrade",
    await withPushEndpointHash(jsonPost(payload)),
  );
}

export function teleportRemoteBase(cost: number) {
  return mineApi<unknown>("/api/mine/base-teleport", jsonPost({ cost }));
}
