/**
 * Bumped whenever generation or rules change payouts for the same
 * (seed, moves). The client submits it with a cash-out so a session
 * played on old rules is rejected instead of silently re-priced.
 */
export const MINE_VERSION = 50;
export const MINE_BOTTOM_ROW = 1000;
export const BAG_STACK_LIMIT = 5;

/**
 * Consumables (REQ-016): bought on the surface, spent as logged actions
 * so the server replay can verify and decrement them. Each resolves one
 * dread: dynamite ("I can't get through"), recall rope ("I won't make
 * it back": banks the carry when the miner is inside rope range).
 */
export interface MineConsumables {
  dynamite: number;
  rope: number;
  ladder: number;
  plank: number;
  /** Warp beacon kits (REQ-029): placed beacon anchors. */
  beacon: number;
}

export const NO_CONSUMABLES: MineConsumables = {
  dynamite: 0,
  rope: 0,
  ladder: 0,
  plank: 0,
  beacon: 0,
};

export const CONSUMABLE_PRICES: Record<keyof MineConsumables, number> = {
  dynamite: 10,
  rope: 8,
  ladder: 2,
  plank: 2,
  beacon: 60,
};

const SUPPORT_SALVAGE_NUMERATOR = 1;
const SUPPORT_SALVAGE_DENOMINATOR = 2;
export const PLANK_HITS = 3;
/** Falling hazards keep a two-action rescue window after their warning. */
export const FALLING_ROCK_MIN_HITS = 2;
export const MAX_BEACONS = 2;
export const BEACON_LABEL_MAX_LENGTH = 12;

export type SalvageablePlacement = "ladder" | "plank" | "beacon";

export function supportSalvageValue(item: SalvageablePlacement): number {
  return Math.max(
    1,
    Math.floor(
      (CONSUMABLE_PRICES[item] * SUPPORT_SALVAGE_NUMERATOR) /
        SUPPORT_SALVAGE_DENOMINATOR,
    ),
  );
}

export function normalizeBeaconLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().slice(0, BEACON_LABEL_MAX_LENGTH);
}

/** Per-key sum, shared by the store's carryover and purchase merges. */
export function addConsumables(
  a: MineConsumables,
  b: MineConsumables,
): MineConsumables {
  return {
    dynamite: a.dynamite + b.dynamite,
    rope: a.rope + b.rope,
    ladder: a.ladder + b.ladder,
    plank: a.plank + b.plank,
    beacon: a.beacon + b.beacon,
  };
}

/**
 * Death-recovery floor for ladders. Trips no longer ship free ladders:
 * climbing is ladder-gated (REQ-020) and the rungs are bought at the
 * depot. The one free source is dying in the mine (battery out or crushed,
 * not giving up): a death tops the stock back up TO this floor so the
 * miner can climb out again. Free rungs granted this way do not bank
 * between trips (see carryoverConsumables) and are not charged at
 * cash-out (see MineState.granted and the bank route).
 */
export const LADDER_RECOVERY_FLOOR = 8;

/**
 * Death-recovery floor for planks (REQ-022): lateral steps over a void
 * are plank-gated. Same rule as ladders, smaller floor: bought at the
 * depot, refilled up to this count only when the miner dies.
 */
export const PLANK_RECOVERY_FLOOR = 4;

/**
 * The one-time starting kit a brand-new player is gifted at account
 * creation: the basic ladder and plank bundle so the very first descent
 * works without a shop visit. It is a gift once, not a per-trip grant:
 * once spent it is bought back at the depot or refilled by dying. The
 * server seeds it into a new player row; the client mirrors it for a
 * fresh storage-less session (guest/local dev) where there is no row.
 */
export const STARTING_CONSUMABLES: MineConsumables = {
  ...NO_CONSUMABLES,
  ladder: LADDER_RECOVERY_FLOOR,
  plank: PLANK_RECOVERY_FLOOR,
};

/** Robot battery charge burned per gas pocket vented (heat, not shrapnel). */
export const GAS_VENT_DRAIN = 8;
