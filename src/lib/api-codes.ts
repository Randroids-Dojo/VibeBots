/**
 * Machine-readable error codes shared by the API routes and the client
 * (F-068). The server attaches them to error bodies; the client branches on
 * them instead of prose, so the human wording stays free to change (or
 * localize) without breaking flow logic.
 */

export const MINE_VERSION_MISMATCH_CODE = "mine_version_mismatch";

/** Another device banked this world's trip first (replay guard moved). */
export const TRIP_ALREADY_CASHED_OUT_CODE = "trip_already_cashed_out";

/** The uploaded trip checkpoint runs on an older world than the server's. */
export const STALE_TRIP_CHECKPOINT_CODE = "stale_trip_checkpoint";

/**
 * A banked bunker edit lost an optimistic-concurrency race: another device
 * changed the bunker first. The 409 body carries the authoritative view so the
 * client can adopt it and retry (F-122).
 */
export const BUNKER_REVISION_CONFLICT_CODE = "bunker-revision-conflict";

/**
 * A bunker edit was rejected because the persisted layout predates the
 * current placement model (F-117): the client must Start fresh before it
 * can build again. The client also detects this proactively from the
 * bunker's layout version, but the code lets a racing edit force the
 * Start fresh prompt (Q-022).
 */
export const BUNKER_LAYOUT_INCOMPATIBLE_CODE = "bunker-layout-incompatible";

/**
 * Stable low-cardinality reasons an elevator rail buy can be rejected with
 * (F-121). The old generic 409 folded insufficient balance, stale rail
 * ownership, and concurrent checkpoint loss into one prose string. Each reason
 * now carries a code plus the authoritative rail state so the client can adopt
 * the truth instead of leaving a stale screen, and so live monitoring can tell
 * an expected concurrency rejection from a persistence failure.
 */
export const ELEVATOR_REASON_CODES = [
  /** The mine world row is missing, so there is nothing to carve (409). */
  "elevator-mine-world-missing",
  /**
   * The request omitted `expectedDepth`, so the stale-rail guard could not run.
   * Every current client sends it; a request without it is a stale cached
   * client, rejected fail-fast before any read or charge (400).
   */
  "elevator-expected-depth-required",
  /** The first rail needs a chosen surface column before it can anchor (400). */
  "elevator-column-required",
  /**
   * The client's rail depth or shaft column no longer matches the server:
   * a stale or already-applied buy, or a concurrent winner advanced the rail
   * (409). Covers the expected-depth guard and the placed-column mismatch.
   */
  "elevator-stale-rail-state",
  /** The mine checkpoint moved under the buy (a trip banked first) (409). */
  "elevator-stale-checkpoint",
  /** The buyer cannot afford the next rail price (409). */
  "elevator-insufficient-balance",
  /** The rail already reaches the mine bottom (409). */
  "elevator-rail-at-bottom",
  /** A guarded write lost a race with no clearer cause; retryable (409). */
  "elevator-concurrent-loss",
  /**
   * The request id already produced a committed outcome, so this is a replay of
   * an already-applied buy (a lost-success retry that reused its request id).
   * The mutation is deduplicated (no second charge or row) and the client adopts
   * the authoritative state (409). See F-121's durable outbox.
   */
  "elevator-duplicate-request",
] as const;

export type ElevatorReasonCode = (typeof ELEVATOR_REASON_CODES)[number];

/**
 * Optional request header carrying a hex sha-256 of the sender's own push
 * endpoint, so save-sync pushes skip the device that caused the update.
 */
export const PUSH_ENDPOINT_HASH_HEADER = "x-vibebots-push-endpoint-hash";

/**
 * Every code an account-family error response can carry. One entry per
 * distinct failure the client may need to branch on or explain.
 */
export const ACCOUNT_ERROR_CODES = [
  /** No ready Clerk session on a route that requires one (401). */
  "sign_in_required",
  /** The request needs an active guest save cookie (409). */
  "guest_save_required",
  /** The active guest save row no longer exists (404). */
  "guest_save_not_found",
  /** The device save is already linked to a different account (409). */
  "device_save_linked_to_other_account",
  /** The account already has a cloud save; claiming needs a choice (409). */
  "account_cloud_save_exists",
  /** No empty slot to preserve the device save during cloud load (409). */
  "device_save_slot_full",
  /** The handoff finish body carried no usable handoff id (400). */
  "handoff_id_required",
  /** The one-time sign-in handoff expired or was already used (410). */
  "handoff_expired",
  /** Clerk is not configured on this deployment (503). */
  "provider_not_configured",
  /** The signed-in account has no cloud save to load (404). */
  "cloud_save_not_found",
  /** The database is not configured (503). */
  "storage_not_configured",
  /** Cross-site mutation blocked by the same-origin guard (403). */
  "same_origin_required",
  /** The claim transaction failed server-side (503). */
  "claim_failed",
  /** The uploaded trip checkpoint failed validation (400). */
  "invalid_trip_checkpoint",
  /** See STALE_TRIP_CHECKPOINT_CODE (409). */
  STALE_TRIP_CHECKPOINT_CODE,
  /** Deleting a linked account save from a device is blocked (409). */
  "linked_account_save_delete_blocked",
] as const;

export type AccountErrorCode = (typeof ACCOUNT_ERROR_CODES)[number];

/** The `code` field of an error body, or null when absent or not a string. */
export function apiErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const code = (body as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}

export function accountErrorCode(body: unknown): AccountErrorCode | null {
  const code = apiErrorCode(body);
  return code !== null &&
    (ACCOUNT_ERROR_CODES as readonly string[]).includes(code)
    ? (code as AccountErrorCode)
    : null;
}
