import type { PortalBeaconId } from "./biomes";
import type { MineConsumables } from "./consumables";
import type { DynamiteTier, MineGear } from "./gear";
import type { OreId } from "./ores";

export type CellKind =
  | "dirt"
  | "rock"
  | "ore"
  | "part-cache"
  | "boulder"
  | "gas"
  | "magma"
  | "metal"
  | "empty";

export interface MineCell {
  kind: CellKind;
  /** Set when kind is "ore". */
  ore?: OreId;
  /** Set when kind is "rock" (hard gate vs the pickaxe level). */
  rockTier?: number;
  /**
   * An undermined rock or boulder counting down to its fall (REQ-015):
   * actions remaining before it drops. Set when its support is dug out,
   * decremented each action, and the block falls when it reaches zero.
   * The teeter (escalating tremble) is the tell. Unset means stable.
   */
  fallIn?: number;
  /**
   * A deployed ladder (REQ-020), only meaningful on empty cells.
   * Climbing out of this cell is free once placed. Anything that
   * overwrites the cell (a falling boulder) smashes the ladder.
   */
  ladder?: boolean;
  /**
   * A deployed plank bridge (REQ-022), only meaningful on empty cells.
   * Stepping laterally into this cell over a void is free once placed.
   * Planks can also be pre-set on a diggable cell; when that cell is
   * mined, the bridge remains underfoot. A falling boulder smashes it
   * like a ladder.
   */
  plank?: boolean;
  /** Remaining pickaxe hits before a placed plank breaks for salvage. */
  plankHp?: number;
  /**
   * Swings remaining before this block breaks (REQ-013). Unset means
   * full health for its kind and the digger's pickaxe.
   */
  hp?: number;
  /**
   * Ore units still locked in this cell. Unset ore cells infer their full
   * deterministic reserve from the ore id and row.
   */
  oreRemaining?: number;
  /** A placed warp beacon stands here (REQ-029). */
  beacon?: boolean;
  /** Placement order for newest-first Warp Pad lists. */
  beaconOrder?: number;
  /** Optional short name shown in the Warp Pad list. */
  beaconLabel?: string;
  /** Active authored surface portal, separate from bought warp beacons. */
  portal?: PortalBeaconId;
  portalActive?: boolean;
  /**
   * Ore lying on the floor of an empty cell: chunks that overflowed a
   * dig or dynamite blast because the cargo hold was full. Scooped up by
   * walking over the cell once the hold has room (a partial take leaves
   * the rest as a smaller pile). A falling block buries it like a ladder.
   * Usually lives on empty cells; a partially mined ore cell can also hold
   * overflow until the deposit opens and the pile settles normally.
   */
  drop?: Partial<Record<OreId, number>>;
  /**
   * Subset of `drop` that the player manually dropped from the bag.
   * Walk-over pickup takes the rest of the pile first so a player can
   * make room without immediately reclaiming the same chunks.
   */
  dropDeferred?: Partial<Record<OreId, number>>;
  /**
   * The miner's carried bag after a collapse or abandoned dig. Walking
   * over the cell scoops it back into the miner's current haul.
   */
  bag?: DroppedBag;
  /** A rock that entered the falling-rock hazard system. Render-layer cue. */
  fallen?: boolean;
  /**
   * Set when fallIn came from the wide-span structural rule rather than
   * a direct undercut: a plank that shortens the span (or props the cell
   * below) clears the countdown. Direct undercut teeters never clear.
   */
  spanUnstable?: boolean;
  /**
   * Wisp cells an uncorked gas pocket may still leak into open tunnel
   * (one per action). Set when a fall vacates an adjacent cell; cleared
   * when spent or the pocket is vented.
   */
  gasSeepBudget?: number;
  /**
   * A leaked wisp, only meaningful on gas cells. Wisps add no drain in a
   * vent chain, can be walked through for a small battery cost, and fade
   * back to empty when gasFadeIn runs out.
   */
  gasSeeped?: boolean;
  /** Actions remaining before a seeped wisp fades back to empty. */
  gasFadeIn?: number;
}

export interface DroppedBag {
  ores: Partial<Record<OreId, number>>;
  salvageCredits: number;
  parts: string[];
}

export interface PendingDynamite {
  col: number;
  row: number;
  tier: DynamiteTier;
}

export interface MinerState {
  col: number;
  row: number; // 0 = surface walk row; digging starts at row 1
  energy: number;
  /** Carried ore counts by id; dropped on collapse, banked on the surface. */
  carried: Partial<Record<OreId, number>>;
  /** Salvage value from picked-up supports, lost like ore until surfaced. */
  carriedSalvageCredits: number;
  carriedParts: string[];
  bankedCredits: number;
  bankedParts: string[];
  /** Most recent surfaced haul before it was converted into wallet value. */
  lastSoldHaul?: SoldHaul;
  /** Deepest row reached this session, used for profile records and stamps. */
  maxDepth: number;
  /** Trips that ended underground with a dead battery or hazard death. */
  collapses: number;
  /** Last dropped cargo location for the render-layer locator. */
  lostCargo?: { value: number; parts: string[]; col: number; row: number };
}

export interface SoldHaul {
  ores: Partial<Record<OreId, number>>;
  salvageCredits: number;
  totalVibes: number;
}

export interface MineState {
  seed: number;
  /** Gear snapshot for the session; part of the replay input (Q-007). */
  gear: MineGear;
  /** Consumables remaining this session; part of the replay input. */
  consumables: MineConsumables;
  /** Consumables spent this session (server decrements at cash-out). */
  used: MineConsumables;
  /**
   * Free recovery stock granted this session by deaths (the top-up to
   * the recovery floor). Only ladders and planks are ever granted. The
   * cash-out decrement forgives this much of `used`, and carryover
   * strips the unspent part, so death rungs cost nothing and never bank.
   */
  granted: MineConsumables;
  /**
   * Player mutations over pure generation, keyed "col,row" (Q-010):
   * dug cells, crack damage, ladders, planks, fallen boulders. This
   * map IS the persistent world (REQ-026): everything not in it
   * regenerates identically from the seed on read.
   */
  cells: Map<string, MineCell>;
  /** A lit dynamite charge waiting for the miner to step clear. */
  pendingDynamite?: PendingDynamite;
  /** Jump Jets hold the miner one row up until the next successful action. */
  jumpHover?: boolean;
  /**
   * Observational survival counters (F-049). Never serialized into the
   * WorldDiff and never read by any rule, so they cannot change replay
   * outcomes; replayTrip reports them and the server folds them into
   * stamp progress at cash-out.
   */
  tripStats: TripStats;
  miner: MinerState;
}

export interface TripStats {
  /** Rescue events: a condemned span roof re-propped before it fell. */
  roofRescues: number;
  /** Span collapses that landed within two columns of a living miner. */
  collapsesSurvived: number;
}

/** Serialized world mutations: the save format for client and server. */
export type WorldDiff = Array<[number, number, MineCell]>;

export interface MineCoord {
  col: number;
  row: number;
}

export interface LadderFall {
  from: MineCoord;
  to: MineCoord;
}
