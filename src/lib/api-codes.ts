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
  "stale_trip_checkpoint",
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
