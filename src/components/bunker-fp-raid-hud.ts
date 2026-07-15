import type { LiveRaidOutcome } from "@/sim/bunker-raid-live";

/**
 * Tiny external store carrying live-raid status from the fp rig's frame
 * loop to the DOM raid HUD (Rule 10: all text lives in the DOM). The rig
 * calls {@link setFpRaidHud} on each sim tick with scalars; a new snapshot
 * is created only when a field changed, so steady frames allocate nothing
 * and the HUD re-renders at tick cadence, not frame cadence.
 */

export interface FpRaidHudState {
  active: boolean;
  secondsLeft: number;
  clankersAlive: number;
  clankersTotal: number;
  breached: boolean;
  outcome: LiveRaidOutcome;
}

const IDLE: FpRaidHudState = {
  active: false,
  secondsLeft: 0,
  clankersAlive: 0,
  clankersTotal: 0,
  breached: false,
  outcome: "active",
};

let snapshot: FpRaidHudState = IDLE;
const listeners = new Set<() => void>();

export function setFpRaidHud(
  active: boolean,
  secondsLeft: number,
  clankersAlive: number,
  clankersTotal: number,
  breached: boolean,
  outcome: LiveRaidOutcome,
): void {
  if (
    snapshot.active === active &&
    snapshot.secondsLeft === secondsLeft &&
    snapshot.clankersAlive === clankersAlive &&
    snapshot.clankersTotal === clankersTotal &&
    snapshot.breached === breached &&
    snapshot.outcome === outcome
  ) {
    return;
  }
  snapshot = {
    active,
    secondsLeft,
    clankersAlive,
    clankersTotal,
    breached,
    outcome,
  };
  for (const listener of listeners) listener();
}

export function resetFpRaidHud(): void {
  if (snapshot === IDLE) return;
  snapshot = IDLE;
  for (const listener of listeners) listener();
}

export function subscribeFpRaidHud(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFpRaidHudSnapshot(): FpRaidHudState {
  return snapshot;
}
