import { pendingBunkerBuildSchema } from "@/server/mine-trip-schema";
import type { BunkerFootprint, PendingBunkerBuild } from "@/sim/bunker";
import {
  applyAction,
  createMine,
  isMineAction,
  MINE_VERSION,
  type MineAction,
  type MineConsumables,
  type MineGear,
  type MineState,
  type MoveResult,
  normalizeGear,
  type WorldDiff,
} from "@/sim/mine";

const LEGACY_LOCAL_TRIP_KEY = "vibebots-mine-trip-v2";
const LOCAL_TRIP_SLOT_PREFIX = "vibebots-mine-trip-v2-slot-";

export const SAVE_SLOT_IDS = [1, 2, 3] as const;
export type SaveSlotId = (typeof SAVE_SLOT_IDS)[number];

export interface SavedTrip {
  mineVersion: number;
  seed: number;
  tripIndex: number;
  gear: MineGear;
  consumables: MineConsumables;
  baseDiff: WorldDiff;
  moves: MineAction[];
  pendingBunker?: PendingBunkerBuild | null;
  bunkerFootprint?: BunkerFootprint | null;
  terminalReplayConsumed?: boolean;
}

export function validSaveSlot(value: unknown): SaveSlotId | null {
  return SAVE_SLOT_IDS.find((slot) => slot === value) ?? null;
}

export function localTripKey(slot: SaveSlotId): string {
  return `${LOCAL_TRIP_SLOT_PREFIX}${slot}`;
}

function migrateLegacyTripToSlotOne(): void {
  try {
    const raw = localStorage.getItem(LEGACY_LOCAL_TRIP_KEY);
    if (!raw) return;
    if (!localStorage.getItem(localTripKey(1))) {
      localStorage.setItem(localTripKey(1), raw);
    }
    localStorage.removeItem(LEGACY_LOCAL_TRIP_KEY);
  } catch {
    // Storage full or blocked: leave the trip wherever the browser keeps it.
  }
}

/**
 * Validate and normalize a persisted or transmitted pending-bunker checkpoint
 * against the one shared bounded schema (F-112). Returns null for malformed
 * input (a null part, a non-object core, out-of-range cells, oversized
 * collections) instead of throwing the way the old hand-rolled normalizer did
 * when it dereferenced those shapes; valid legacy saves coerce (missing depth
 * lands on the tunnel plane, the spawn pocket is re-seeded). A null pending is
 * a valid "no checkpoint", so it passes through as null.
 */
export function normalizePendingBunker(
  pending: unknown,
): PendingBunkerBuild | null {
  if (pending == null) return null;
  const parsed = pendingBunkerBuildSchema.safeParse(pending);
  return parsed.success ? (parsed.data as PendingBunkerBuild) : null;
}

export function loadLocalTrip(slot: SaveSlotId): SavedTrip | null {
  try {
    if (slot === 1) migrateLegacyTripToSlotOne();
    const raw = localStorage.getItem(localTripKey(slot));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.seed !== "number" ||
      typeof parsed.tripIndex !== "number" ||
      parsed.mineVersion !== MINE_VERSION ||
      !Array.isArray(parsed.baseDiff) ||
      !Array.isArray(parsed.moves)
    ) {
      removeLocalTrip(slot);
      return null;
    }
    const saved = parsed as SavedTrip;
    if (
      !saved.moves.every(
        (move) => typeof move === "string" && isMineAction(move),
      )
    ) {
      removeLocalTrip(slot);
      return null;
    }
    const pendingPresent = saved.pendingBunker != null;
    const pendingBunker = normalizePendingBunker(saved.pendingBunker);
    if (pendingPresent && pendingBunker === null) {
      // A stored checkpoint whose bunker no longer validates is unusable, so
      // drop it and start fresh rather than resume a half-broken trip (F-112).
      removeLocalTrip(slot);
      return null;
    }
    return {
      ...saved,
      gear: normalizeGear(saved.gear),
      pendingBunker,
    };
  } catch {
    return null;
  }
}

/**
 * Whether the slot holds a trip whose pending bunker is present but no longer
 * validates (F-112). The store shows a fresh-start notice for this corrupt
 * checkpoint specifically, while a routine version or shape mismatch stays
 * silent the way it always has. Check it before {@link loadLocalTrip}, which
 * drops the unusable blob.
 */
export function storedTripPendingBunkerIsCorrupt(slot: SaveSlotId): boolean {
  try {
    const raw = localStorage.getItem(localTripKey(slot));
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return (
      parsed?.pendingBunker != null &&
      normalizePendingBunker(parsed.pendingBunker) === null
    );
  } catch {
    return false;
  }
}

export function saveLocalTrip(slot: SaveSlotId, trip: SavedTrip): void {
  try {
    localStorage.setItem(localTripKey(slot), JSON.stringify(trip));
  } catch {
    // Storage full or blocked: the trip still lives in memory.
  }
}

export function removeLocalTrip(slot: SaveSlotId): void {
  try {
    localStorage.removeItem(localTripKey(slot));
  } catch {
    // Storage blocked: the server-side save is still deleted.
  }
}

const RAIL_RESYNC_BLOCK_PREFIX = "vibebots-rail-resync-blocked-slot-";

function railResyncBlockKey(slot: SaveSlotId): string {
  return `${RAIL_RESYNC_BLOCK_PREFIX}${slot}`;
}

/**
 * Whether a slot's rail-buy block is persisted (F-121). The block means the
 * local rail is known stale after a failed conflict resync; persisting it lets
 * the gate survive a page reload so an offline reload does not silently re-enable
 * a buy against the stale rail. It clears the moment an online load reconciles
 * fresh authority (see the store's loadWorld).
 */
export function loadRailResyncBlock(slot: SaveSlotId): boolean {
  try {
    return localStorage.getItem(railResyncBlockKey(slot)) === "1";
  } catch {
    return false;
  }
}

export function saveRailResyncBlock(slot: SaveSlotId, blocked: boolean): void {
  try {
    if (blocked) {
      localStorage.setItem(railResyncBlockKey(slot), "1");
    } else {
      localStorage.removeItem(railResyncBlockKey(slot));
    }
  } catch {
    // Storage blocked: the block still holds in memory for this session.
  }
}

export function replaySavedTrip(
  saved: SavedTrip,
  baseDiff: WorldDiff,
): {
  mine: MineState;
  moves: MineAction[];
  lastResult: MoveResult | null;
  pendingBunker: PendingBunkerBuild | null;
  terminalReplayCollapsed: boolean;
  terminalReplayConsumed: boolean;
  resumeElevatorDirection: "ride-up" | "ride-down" | null;
} {
  const resumed = createMine(
    saved.seed,
    saved.gear,
    saved.consumables,
    baseDiff,
  );
  const moves: MineAction[] = [];
  let terminalResult: MoveResult | null = null;
  const bunkerFootprint =
    saved.bunkerFootprint ?? saved.pendingBunker?.bunker.footprint ?? null;
  for (const action of saved.moves) {
    const result = applyAction(resumed, action, { bunkerFootprint });
    if (result.ok) {
      moves.push(action);
    }
    if (result.ok && result.collapsed) {
      terminalResult = result;
      break;
    }
  }
  const terminalReplayConsumed =
    terminalResult !== null && saved.terminalReplayConsumed === true;
  const resumeElevatorDirection =
    terminalResult === null && resumed.elevatorPhase === "riding-up"
      ? "ride-up"
      : terminalResult === null && resumed.elevatorPhase === "riding-down"
        ? "ride-down"
        : null;
  return {
    mine: resumed,
    moves,
    lastResult: null,
    pendingBunker: terminalResult ? null : (saved.pendingBunker ?? null),
    terminalReplayCollapsed: terminalResult !== null,
    terminalReplayConsumed,
    resumeElevatorDirection,
  };
}
