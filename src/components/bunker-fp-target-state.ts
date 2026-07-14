import type { BasePartId } from "@/sim/bunker";
import type { FpRayHitKind } from "./bunker-fp-raycast";

/**
 * Tiny external store carrying "what the crosshair points at" from the
 * fp rig's frame loop to the DOM target-label chip (Rule 10: all text
 * lives in the DOM, so the label cannot be drawn in-canvas). The rig
 * calls setFpTarget every frame with scalars; a new snapshot object is
 * only created when a field actually changed, so steady-state frames
 * allocate nothing and the HUD re-renders at look cadence only.
 */

export interface FpTargetInfo {
  kind: FpRayHitKind | "none";
  partId: BasePartId | null;
  durability: number;
}

const NO_TARGET: FpTargetInfo = { kind: "none", partId: null, durability: 0 };

let snapshot: FpTargetInfo = NO_TARGET;
const listeners = new Set<() => void>();

export function setFpTarget(
  kind: FpRayHitKind | "none",
  partId: BasePartId | null,
  durability: number,
): void {
  if (
    snapshot.kind === kind &&
    snapshot.partId === partId &&
    snapshot.durability === durability
  ) {
    return;
  }
  snapshot = kind === "none" ? NO_TARGET : { kind, partId, durability };
  for (const listener of listeners) listener();
}

export function resetFpTarget(): void {
  setFpTarget("none", null, 0);
}

export function subscribeFpTarget(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFpTargetSnapshot(): FpTargetInfo {
  return snapshot;
}

/**
 * Second mini store, same pattern: whether the player's current cell
 * has no passable lateral neighbor (boxed in by parts or rock). The
 * rig recomputes it at grid-rebuild and cell-change cadence, never per
 * frame; the HUD's escape hint chip subscribes.
 */

let boxedIn = false;
const boxedInListeners = new Set<() => void>();

export function setFpBoxedIn(value: boolean): void {
  if (boxedIn === value) return;
  boxedIn = value;
  for (const listener of boxedInListeners) listener();
}

export function resetFpBoxedIn(): void {
  setFpBoxedIn(false);
}

export function subscribeFpBoxedIn(listener: () => void): () => void {
  boxedInListeners.add(listener);
  return () => {
    boxedInListeners.delete(listener);
  };
}

export function getFpBoxedInSnapshot(): boolean {
  return boxedIn;
}
