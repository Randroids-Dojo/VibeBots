/**
 * "Can I get home?" in one derivation.
 *
 * The HUD used to answer this across three widgets in three corners: a
 * battery bar top left, a ladder count bottom right, and a blocked-route
 * string, leaving the player to do the subtraction. The sim already
 * computes the whole answer in one `returnHomeEstimate` call, so this
 * module turns those raw numbers into the readiness state one gauge
 * renders (docs/research/mine-hud-redesign-2026-07.html section 4.3).
 *
 * Pure presentation logic over sim output: no react, no three, no store.
 */

export type MineReturnRoute = "surface" | "clear" | "short" | "blocked";

/** Drives the gauge's colour. `warn` is the new "start heading back" band. */
export type MineReadinessLevel = "surface" | "clear" | "warn" | "danger";

export type MineReadinessInput = {
  /** Miner row. 0 is the surface, where nothing can strand the player. */
  depth: number;
  energy: number;
  maxEnergy: number;
  /** Charge the trip home costs, from the route estimate. */
  climbCost: number;
  /** False when the estimate found no clear path back. */
  routeReachable: boolean;
  laddersNeeded: number;
  laddersCarried: number;
};

export type MineReadiness = {
  routeState: MineReturnRoute;
  routeBlocked: boolean;
  batteryLow: boolean;
  ladderShort: boolean;
  /** Ladders still to buy or place, 0 when the player has enough. */
  ladderShortfall: number;
  /** 0..1 fill of the charge track. */
  chargeFraction: number;
  /** 0..1 position of the reserve tick, the charge the climb home needs. */
  reserveFraction: number;
  level: MineReadinessLevel;
};

/**
 * Danger threshold. Preserved exactly from the previous inline
 * `batteryLow` derivation so the shipped warning point does not move:
 * the climb home plus a 25% margin plus two charge of slack.
 */
export const BATTERY_LOW_MARGIN = 1.25;
export const BATTERY_LOW_SLACK = 2;

/**
 * Amber threshold. Wider margin on the same cost, so the gauge warns
 * while there is still budget to act instead of only once the trip home
 * is already at risk.
 */
export const BATTERY_WARN_MARGIN = 1.9;

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function batteryLowThreshold(climbCost: number): number {
  return climbCost * BATTERY_LOW_MARGIN + BATTERY_LOW_SLACK;
}

export function batteryWarnThreshold(climbCost: number): number {
  return climbCost * BATTERY_WARN_MARGIN + BATTERY_LOW_SLACK;
}

export function computeReadiness(input: MineReadinessInput): MineReadiness {
  const {
    depth,
    energy,
    maxEnergy,
    climbCost,
    routeReachable,
    laddersNeeded,
    laddersCarried,
  } = input;

  const underground = depth > 0;
  const routeBlocked = underground && !routeReachable;
  const ladderShortfall = Math.max(0, laddersNeeded - laddersCarried);
  const ladderShort = underground && routeReachable && ladderShortfall > 0;
  const batteryLow = underground && energy < batteryLowThreshold(climbCost);

  const routeState: MineReturnRoute = !underground
    ? "surface"
    : routeBlocked
      ? "blocked"
      : ladderShort
        ? "short"
        : "clear";

  const level: MineReadinessLevel = !underground
    ? "surface"
    : routeBlocked || batteryLow || ladderShort
      ? "danger"
      : energy < batteryWarnThreshold(climbCost)
        ? "warn"
        : "clear";

  return {
    routeState,
    routeBlocked,
    batteryLow,
    ladderShort,
    ladderShortfall,
    chargeFraction: clamp01(energy / maxEnergy),
    reserveFraction: clamp01(climbCost / maxEnergy),
    level,
  };
}
