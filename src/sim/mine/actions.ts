import type { PortalBeaconId, PortalTargetId } from "./biomes";
import type { MineState } from "./cells";
import {
  MINE_BOTTOM_ROW,
  normalizeBeaconLabel,
  type SalvageablePlacement,
} from "./consumables";
import { ORE_BY_ID, ORES, type OreId } from "./ores";

export type Direction = "down" | "left" | "right" | "up";

/** Axis inverse per direction, for tap-cancels-tap input handling. */
export const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export type BaseMineAction =
  | Direction
  | BunkerScaffoldAction
  | "dynamite-1"
  | "dynamite-2"
  | "dynamite-3"
  | "dynamite-4"
  | "plank-left"
  | "plank-right"
  | "jump"
  | "recall"
  | "abandon"
  | "ride-down"
  | "ride-up"
  | "place-beacon"
  | "collect-ladder"
  | "warp-home"
  | "warp-down";

export const BUNKER_SCAFFOLD_ACTIONS = [
  "bunker-scaffold-down",
  "bunker-scaffold-left",
  "bunker-scaffold-right",
  "bunker-scaffold-up",
  "bunker-scaffold-stow",
] as const;
export type BunkerScaffoldAction = (typeof BUNKER_SCAFFOLD_ACTIONS)[number];

const BUNKER_SCAFFOLD_ACTION_SET: ReadonlySet<string> = new Set(
  BUNKER_SCAFFOLD_ACTIONS,
);

export function isBunkerScaffoldAction(
  action: string,
): action is BunkerScaffoldAction {
  return BUNKER_SCAFFOLD_ACTION_SET.has(action);
}

export function bunkerScaffoldDirection(
  action: BunkerScaffoldAction,
): Direction | null {
  if (action === "bunker-scaffold-stow") return null;
  return action.slice("bunker-scaffold-".length) as Direction;
}

export type CollectTarget = {
  type: SalvageablePlacement;
  col: number;
  row: number;
};

export function isSupportSalvageTarget(
  state: MineState,
  col: number,
  row: number,
): boolean {
  return (
    Math.abs(col - state.miner.col) <= 1 && Math.abs(row - state.miner.row) <= 1
  );
}

/**
 * The full trip action vocabulary (Q-006 default B): plain directions
 * dig and move; dynamite tokens select a tier; plank tokens act toward a
 * direction; collect tokens pick placed traversal supports back up by
 * coordinate.
 */
export type MineAction =
  | BaseMineAction
  | `collect:${string}`
  | `drop:${string}`
  | `activate-portal:${PortalBeaconId}`
  | `portal-warp:${PortalTargetId}`
  | `warp-down:${number},${number}`
  | `rename-beacon:${number},${number},${string}`;

export const MINE_ACTIONS = [
  "down",
  "up",
  "left",
  "right",
  ...BUNKER_SCAFFOLD_ACTIONS,
  "dynamite-1",
  "dynamite-2",
  "dynamite-3",
  "dynamite-4",
  "plank-left",
  "plank-right",
  "jump",
  "recall",
  "abandon",
  "ride-down",
  "ride-up",
  "place-beacon",
  "collect-ladder",
  "warp-home",
  "warp-down",
] as const satisfies readonly BaseMineAction[];

const BASE_MINE_ACTIONS: ReadonlySet<string> = new Set(MINE_ACTIONS);

export function collectAction(targets: readonly CollectTarget[]): MineAction {
  const parts = [...targets]
    .sort(
      (a, b) => a.row - b.row || a.col - b.col || a.type.localeCompare(b.type),
    )
    .map((target) => `${target.type}:${target.col},${target.row}`);
  return `collect:${parts.join(";")}`;
}

export function parseCollectAction(action: string): CollectTarget[] | null {
  if (!action.startsWith("collect:")) return null;
  const raw = action.slice("collect:".length);
  if (!raw) return null;
  const targets: CollectTarget[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(";")) {
    const match = /^(ladder|plank|beacon):(-?\d+),(-?\d+)$/.exec(part);
    if (!match) return null;
    const type = match[1] as SalvageablePlacement;
    const col = Number(match[2]);
    const row = Number(match[3]);
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row) || row < 0)
      return null;
    const key = `${type}:${col},${row}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ type, col, row });
  }
  return targets;
}

export function parseDropOreAction(
  action: string,
): Partial<Record<OreId, number>> | null {
  if (!action.startsWith("drop:")) return null;
  const raw = action.slice("drop:".length);
  if (!raw) return null;
  const pile: Partial<Record<OreId, number>> = {};
  for (const part of raw.split(";")) {
    const fields = part.split(":");
    if (fields.length !== 2) return null;
    const [id, countText] = fields;
    if (!id || !countText || !ORE_BY_ID.has(id as OreId)) return null;
    const count = Number(countText);
    if (!Number.isSafeInteger(count) || count <= 0) return null;
    pile[id as OreId] = (pile[id as OreId] ?? 0) + count;
  }
  return Object.values(pile).some((count) => (count ?? 0) > 0) ? pile : null;
}

export function parseActivatePortalAction(
  action: string,
): PortalBeaconId | null {
  const match = /^activate-portal:(winter|highTech)$/.exec(action);
  return match ? (match[1] as PortalBeaconId) : null;
}

export function parsePortalWarpAction(action: string): PortalTargetId | null {
  const match = /^portal-warp:(base|winter|highTech)$/.exec(action);
  return match ? (match[1] as PortalTargetId) : null;
}

export function activatePortalAction(id: PortalBeaconId): MineAction {
  return `activate-portal:${id}`;
}

export function portalWarpAction(target: PortalTargetId): MineAction {
  return `portal-warp:${target}`;
}

export function parseWarpDownAction(
  action: string,
): { col: number; row: number } | null {
  const match = /^warp-down:(-?\d+),(-?\d+)$/.exec(action);
  if (!match) return null;
  const col = Number(match[1]);
  const row = Number(match[2]);
  if (
    !Number.isSafeInteger(col) ||
    !Number.isSafeInteger(row) ||
    row < 1 ||
    row >= MINE_BOTTOM_ROW
  )
    return null;
  return { col, row };
}

export function parseRenameBeaconAction(
  action: string,
): { col: number; row: number; label: string } | null {
  const match = /^rename-beacon:(-?\d+),(-?\d+),(.*)$/.exec(action);
  if (!match) return null;
  const col = Number(match[1]);
  const row = Number(match[2]);
  if (
    !Number.isSafeInteger(col) ||
    !Number.isSafeInteger(row) ||
    row < 1 ||
    row >= MINE_BOTTOM_ROW
  )
    return null;
  try {
    return {
      col,
      row,
      label: normalizeBeaconLabel(decodeURIComponent(match[3] ?? "")),
    };
  } catch {
    return null;
  }
}

export function renameBeaconAction(
  target: { col: number; row: number },
  label: string,
): MineAction {
  return `rename-beacon:${target.col},${target.row},${encodeURIComponent(
    normalizeBeaconLabel(label),
  )}`;
}

export function dropOreAction(
  pile: Partial<Record<OreId, number>>,
): MineAction {
  const parts = ORES.map((ore) => {
    const count = pile[ore.id] ?? 0;
    return count > 0 ? `${ore.id}:${count}` : "";
  }).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("dropOreAction requires at least one ore");
  }
  return `drop:${parts.join(";")}`;
}

export function isMineAction(action: string): action is MineAction {
  return (
    BASE_MINE_ACTIONS.has(action) ||
    parseCollectAction(action) !== null ||
    parseDropOreAction(action) !== null ||
    parseActivatePortalAction(action) !== null ||
    parsePortalWarpAction(action) !== null ||
    parseWarpDownAction(action) !== null ||
    parseRenameBeaconAction(action) !== null
  );
}
