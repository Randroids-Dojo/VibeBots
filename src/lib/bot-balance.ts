import type { BalanceReport } from "@/sim/balance";

/**
 * The one part of the balance model that cannot live in src/sim: turning
 * the stability margin into a lean angle needs Math.atan2, and the purity
 * gate bans transcendentals because they differ across JS engines. The
 * geometry it reads from (centre of mass, footprint, margin) is sim code in
 * src/sim/balance.ts.
 */

/** Below this lean the bot goes over on any decent shove. */
export const TIPPY_DEGREES = 30;

/**
 * How far the bot can lean before its centre of mass crosses the footprint
 * edge, in degrees. 0 means it is already on the edge. A taller bot tips at
 * a shallower lean for the same footprint, which is why the tower core
 * feels different to drive.
 */
export function tipOverDegrees(balance: BalanceReport): number {
  if (balance.stabilityMargin <= 0 || balance.centerOfMassHeight <= 0) return 0;
  return (
    (Math.atan2(balance.stabilityMargin, balance.centerOfMassHeight) * 180) /
    Math.PI
  );
}

/** True when the bot stands, but only barely. */
export function isTippy(balance: BalanceReport): boolean {
  return balance.balanced && tipOverDegrees(balance) < TIPPY_DEGREES;
}
