/**
 * When reaching the surface should bank the trip.
 *
 * Pulled out of MinePanel so the ordering rule below is unit-testable: the
 * effect that owns it only tracks the previous miner row and calls this.
 */

export interface AutoBankInputs {
  /** Miner row the last time an arrival was evaluated. */
  previousRow: number;
  /** Miner row now. */
  minerRow: number;
  /** A collapse result is still on screen (death or abandon report). */
  tripReportOpen: boolean;
  /** A bank request is already in flight. */
  cashOutPending: boolean;
  worldLoaded: boolean;
  /** The restored trip put the miner back on the elevator at the surface. */
  elevatorBoarded: boolean;
  movesLength: number;
  bankedCredits: number;
  bankedPartsCount: number;
  pendingBunkerActive: boolean;
  /** The trip carved, built, or otherwise altered the world. */
  carvedThisTrip: boolean;
}

/**
 * - `bank`: submit the cash-out and consume the arrival.
 * - `skip`: nothing to bank; consume the arrival.
 * - `hold`: the miner is at the surface for a reason the bank must not act
 *   on yet. The caller must NOT advance its previous-row memory, or the
 *   arrival is lost and the trip never banks.
 */
export type AutoBankDecision = "bank" | "skip" | "hold";

/**
 * A collapse teleports the miner to (START_COL, row 0) at the instant of
 * death, while the canvas is still playing the fall back from its own
 * recorded fall window. Banking on that teleport ends the trip mid-fall:
 * `submitCashOut` resets `tick` to 0 and clears `lastResult`, the death
 * playback bridge drops the playback because the new tick carries no
 * collapse, and the frame loop retargets the bot at the live (already
 * surfaced) miner. The bot gets yanked back up out of its own fall and
 * the sell line lands over the falling bot instead of the wreck.
 *
 * So a live trip report holds the arrival instead of consuming it: the
 * bank fires once the player dismisses the report, when the sim state and
 * the rendered state agree again.
 */
export function autoBankDecision(inputs: AutoBankInputs): AutoBankDecision {
  if (inputs.tripReportOpen) return "hold";
  if (inputs.cashOutPending) return "skip";
  const arrivedAtSurface = inputs.previousRow > 0 && inputs.minerRow === 0;
  const restoredAtElevatorSurface =
    inputs.worldLoaded &&
    inputs.minerRow === 0 &&
    inputs.elevatorBoarded &&
    inputs.movesLength > 0;
  if (!arrivedAtSurface && !restoredAtElevatorSurface) return "skip";
  // Bank whenever the trip is worth persisting, which is not only when
  // the hold has something to sell. A carved shaft, a placed ladder, or
  // any other change to the world is progress the server must checkpoint
  // (REQ-026), and the bank route already accepts a zero-value trip for
  // exactly this reason. Gating on loot alone meant an ore-less digging
  // trip never reached the server: the carving lived only in the device's
  // move log, the stored world stayed frozen at the last loot-bearing
  // trip, and the two trip counters drifted apart from there.
  if (
    inputs.bankedCredits <= 0 &&
    inputs.bankedPartsCount <= 0 &&
    !inputs.pendingBunkerActive &&
    !inputs.carvedThisTrip
  ) {
    return "skip";
  }
  return "bank";
}
