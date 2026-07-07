/**
 * Machine-readable error codes shared by the mine API routes and the
 * client. The server attaches them to error bodies; the client branches on
 * them instead of prose (which stays free to change).
 */

export const MINE_VERSION_MISMATCH_CODE = "mine_version_mismatch";

/** Another device banked this world's trip first (replay guard moved). */
export const TRIP_ALREADY_CASHED_OUT_CODE = "trip_already_cashed_out";
