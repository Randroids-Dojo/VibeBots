import {
  BUNKER_CLAIM_DEPTH,
  type BunkerFootprint,
  type DugBunkerCell,
  type PendingBunkerBuild,
} from "@/sim/bunker";
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

/** Saved trips survive deploys (MINE_VERSION does not bump for the depth
 * axis), so pre-depth pendingBunker saves resume against the new sim.
 * Anything without a valid depth lands on the tunnel plane (depth 0). */
function normalizedTripDepth(value: unknown): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < BUNKER_CLAIM_DEPTH
    ? value
    : 0;
}

function normalizedTripDug(value: unknown): DugBunkerCell[] {
  if (!Array.isArray(value)) return [];
  return value.filter((cell): cell is DugBunkerCell => {
    if (!cell || typeof cell !== "object") return false;
    const candidate = cell as Record<string, unknown>;
    return (
      typeof candidate.col === "number" &&
      Number.isInteger(candidate.col) &&
      typeof candidate.row === "number" &&
      Number.isInteger(candidate.row) &&
      typeof candidate.depth === "number" &&
      Number.isInteger(candidate.depth) &&
      candidate.depth >= 1 &&
      candidate.depth < BUNKER_CLAIM_DEPTH
    );
  });
}

export function normalizePendingBunker(
  pending: PendingBunkerBuild | null | undefined,
): PendingBunkerBuild | null {
  if (!pending?.bunker) return pending ?? null;
  const bunker = pending.bunker;
  return {
    ...pending,
    bunker: {
      ...bunker,
      core: bunker.core
        ? { ...bunker.core, depth: normalizedTripDepth(bunker.core.depth) }
        : bunker.core,
      parts: (bunker.parts ?? []).map((part) => ({
        ...part,
        depth: normalizedTripDepth(part.depth),
      })),
      dug: normalizedTripDug(bunker.dug),
    },
  };
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
    return {
      ...saved,
      gear: normalizeGear(saved.gear),
      pendingBunker: normalizePendingBunker(saved.pendingBunker),
    };
  } catch {
    return null;
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
    if (result.ok) moves.push(action);
    if (result.ok && result.collapsed) {
      terminalResult = result;
      break;
    }
  }
  const terminalReplayConsumed =
    terminalResult !== null && saved.terminalReplayConsumed === true;
  return {
    mine: resumed,
    moves,
    lastResult: null,
    pendingBunker: terminalResult ? null : (saved.pendingBunker ?? null),
    terminalReplayCollapsed: terminalResult !== null,
    terminalReplayConsumed,
  };
}
