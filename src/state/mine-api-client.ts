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
  MINE_VERSION_MISMATCH_CODE,
  TRIP_ALREADY_CASHED_OUT_CODE,
} from "@/lib/mine-api-codes";
import type { AccountSaveSummary } from "@/server/account-summary";
import type { PendingBunkerBuild } from "@/sim/bunker";
import {
  isMineAction,
  MINE_VERSION,
  type MineConsumables,
  type MineGearSnapshot,
  type MineGearTrack,
  normalizeGear,
} from "@/sim/mine";
import {
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

const ACCOUNT_ERROR_MESSAGES = new Set([
  "account sign-in required",
  "guest save required",
  "guest save not found",
  "account already has a cloud save",
  "device save belongs to another account",
  "no empty save slot for device save",
  "linked account saves cannot be deleted from this device",
  "same-origin request required",
  "storage not configured",
]);

export function accountErrorMessageFromResponse(
  body: unknown,
  fallback: string,
): string {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" && ACCOUNT_ERROR_MESSAGES.has(error)
    ? error
    : fallback;
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

function isPendingBunkerBuild(value: unknown): value is PendingBunkerBuild {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.claimCol !== "number" ||
    typeof raw.claimRow !== "number" ||
    typeof raw.claimedAtMoveCount !== "number" ||
    !raw.bunker ||
    typeof raw.bunker !== "object" ||
    !raw.inventory ||
    typeof raw.inventory !== "object"
  ) {
    return false;
  }
  const bunker = raw.bunker as Record<string, unknown>;
  return (
    Boolean(bunker.footprint) &&
    typeof bunker.footprint === "object" &&
    Boolean(bunker.core) &&
    typeof bunker.core === "object" &&
    Array.isArray(bunker.parts)
  );
}

export function accountTripFromResponse(value: unknown): SavedTrip | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const trip = body.trip;
  if (!trip || typeof trip !== "object") return null;
  const raw = trip as Partial<Record<keyof SavedTrip, unknown>>;
  const pendingBunkerPresent =
    raw.pendingBunker !== null && raw.pendingBunker !== undefined;
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
    (pendingBunkerPresent && !isPendingBunkerBuild(raw.pendingBunker))
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
    pendingBunker: pendingBunkerPresent
      ? (raw.pendingBunker as PendingBunkerBuild)
      : null,
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

function responseCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const code = (body as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}

export function isMineVersionMismatch(body: unknown): boolean {
  return responseCode(body) === MINE_VERSION_MISMATCH_CODE;
}

export function isTripAlreadyCashedOut(body: unknown): boolean {
  return responseCode(body) === TRIP_ALREADY_CASHED_OUT_CODE;
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

export function claimRemoteAccountSave() {
  return mineApi<unknown>(
    "/api/account/claim",
    accountMutation({ method: "POST" }),
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

export function submitMineBank(body: {
  seed: number;
  tripIndex: number;
  moves: unknown;
  gear: unknown;
  consumables: unknown;
  pendingBunker?: unknown;
}) {
  return mineApi<unknown>(
    "/api/mine/bank",
    jsonPost({
      ...body,
      mineVersion: MINE_VERSION,
    }),
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

export function buyRemoteElevator() {
  return mineApi<unknown>("/api/elevator/upgrade", { method: "POST" });
}

export function teleportRemoteBase(cost: number) {
  return mineApi<unknown>("/api/mine/base-teleport", jsonPost({ cost }));
}
