import {
  type CollectTarget,
  type Direction,
  isSupportSalvageTarget,
  type MineAction,
  parseActivatePortalAction,
  parseCollectAction,
  parseDropOreAction,
  parsePortalWarpAction,
  parseRenameBeaconAction,
  parseWarpDownAction,
} from "./actions";
import {
  authoredPortalAt,
  BIOME_PORTALS,
  type BiomePortalDef,
  type PortalBeaconId,
  type PortalTargetId,
  portalDef,
  WARP_PAD_COL,
} from "./biomes";
import type {
  CellKind,
  LadderFall,
  MineCell,
  MineCoord,
  MinerState,
  MineState,
  PendingDynamite,
  SoldHaul,
  WorldDiff,
} from "./cells";
import {
  FALLING_ROCK_MIN_HITS,
  GAS_VENT_DRAIN,
  LADDER_RECOVERY_FLOOR,
  MINE_BOTTOM_ROW,
  type MineConsumables,
  NO_CONSUMABLES,
  normalizeBeaconLabel,
  PLANK_HITS,
  PLANK_RECOVERY_FLOOR,
  type SalvageablePlacement,
  supportSalvageValue,
} from "./consumables";
import {
  canDigRock,
  hitsFor,
  MOVE_COST,
  oreSwingCostFor,
  rockTierAt,
  START_COL,
  swingCostFor,
} from "./digging";
import {
  DEFAULT_GEAR,
  type DynamiteTier,
  dynamiteOreHarvestUnits,
  dynamiteTier,
  ELEVATOR_COL,
  lightRadius,
  type MineGear,
  maxEnergy,
  recallRopeRange,
  safeFallRows,
  warpRange,
} from "./gear";
import {
  bagValue,
  carriedValue,
  dropBagAt,
  dropOreToSurface,
  droppedBagFromMiner,
  fillHold,
  mergeOrePiles,
  orePileCount,
  pickupAtMiner,
} from "./inventory";
import {
  ORES,
  type OreId,
  oreReserveAt,
  oreSwingYield,
  oreUnitsAt,
} from "./ores";
import { cellRandom } from "./random";
import {
  combinedLadderFalls,
  ladderFallsOrUndefined,
  settleUnsupportedDrops,
  settleUnsupportedLadders,
} from "./supports";
import {
  cellAt,
  cellKey,
  cellMut,
  createMine,
  exportDiff,
  FALL_DELAY_ACTIONS,
  GAS_SEEP_BUDGET,
  GAS_SEEPED_FADE_ACTIONS,
  GAS_WISP_DISPERSE_DRAIN,
  HAZARD_FREE_ROWS,
  SPAN_COLLAPSE_DELAY_ACTIONS,
  SPAN_COLLAPSE_WIDTH,
  setCell,
} from "./world";

/**
 * The mining loop (REQ-006/REQ-007/REQ-011/REQ-012): a deterministic 2D
 * vertical grid. Pure logic; rendering draws these cells as low-poly 3D
 * blocks from a side camera (Q-004 resolution). Same seed, same mine,
 * same finds: mining rewards stay verifiable like everything else.
 *
 * Core tension: every action costs energy. Banking happens only on the
 * surface; running dry underground drops the carried bag where you fell.
 */

function salvageSupport(state: MineState, item: SalvageablePlacement): number {
  const value = supportSalvageValue(item);
  state.miner.carriedSalvageCredits += value;
  return value;
}

/**
 * Rare robot parts discoverable underground (REQ-007). Deeper bands
 * roll richer tables (REQ-030): the bot-building reward keeps paying
 * the deeper the push.
 */
const CACHE_PART_TIERS: ReadonlyArray<{
  minRow: number;
  ids: readonly string[];
}> = [
  { minRow: 40, ids: ["core-cube", "core-cube", "drive-wheel", "ram-spike"] },
  { minRow: 0, ids: ["drive-wheel", "ram-spike", "frame-plate"] },
];

function cachePartIdsAt(row: number): readonly string[] {
  for (const tier of CACHE_PART_TIERS) {
    if (row >= tier.minRow) return tier.ids;
  }
  return CACHE_PART_TIERS[CACHE_PART_TIERS.length - 1].ids;
}

function target(
  state: MineState,
  dir: Direction,
): { col: number; row: number } {
  const { col, row } = state.miner;
  switch (dir) {
    case "down":
      return { col, row: row + 1 };
    case "up":
      return { col, row: row - 1 };
    case "left":
      return { col: col - 1, row };
    case "right":
      return { col: col + 1, row };
  }
}

function isPendingDynamiteAt(
  state: MineState,
  col: number,
  row: number,
): boolean {
  return (
    state.pendingDynamite?.col === col && state.pendingDynamite.row === row
  );
}

function hasDynamiteGap(state: MineState, charge: PendingDynamite): boolean {
  return (
    Math.abs(state.miner.col - charge.col) +
      Math.abs(state.miner.row - charge.row) >=
    1
  );
}

export type MoveResult =
  | {
      ok: true;
      dug: CellKind | null;
      /** Cell cleared by a dig action. */
      dugAt?: MineCoord;
      /** Set when dug was an ore cell. */
      dugOre: OreId | null;
      /** Ore units mined on the final cell-clearing swing. */
      dugOreCount?: number;
      /** Ore units mined by this swing before cargo overflow. */
      oreHarvested?: {
        ore: OreId;
        units: number;
        dropped?: number;
        remaining: number;
      };
      found: string | null;
      collapsed: boolean;
      /** A falling boulder ended the trip (carry lost). */
      crushed?: boolean;
      /** This action started at least one falling-rock countdown. */
      fallingRockTriggered?: boolean;
      /** The rock or boulder cells that newly started a fall countdown. */
      fallingRockWarnings?: MineCoord[];
      /** Placed ladders that settled after a support changed. */
      ladderFalls?: LadderFall[];
      /** Gas pockets vented by this action (robot battery charge burned). */
      vented?: number;
      /** Cells destroyed by a dynamite blast. */
      blasted?: number;
      /** Ore chunks a dynamite blast collected into the hold. */
      collected?: number;
      /** Ore chunks left on the floor because the hold was full. */
      dropped?: number;
      /** The bag had no compatible stack space for one or more chunks. */
      bagFull?: boolean;
      /** Parts a dynamite blast cracked out of caches in range. */
      foundParts?: string[];
      /** A dynamite charge was placed and is waiting for space. */
      dynamitePlanted?: PendingDynamite;
      /** Center cell of a delayed dynamite explosion. */
      exploded?: PendingDynamite;
      /** Ore chunks scooped by walking over a floor drop. */
      pickedUp?: number;
      /** Dropped bag contents scooped by walking over the collapse cell. */
      pickedUpBag?: { value: number; parts: number };
      /** Ore chunks manually dropped from the carried bag. */
      droppedFromBag?: number;
      /** A recall rope ended the trip from below (carry banked). */
      recalled?: boolean;
      /** Jump Jets lifted the miner one row without placing support. */
      jumped?: MineCoord;
      /** The trip was voluntarily abandoned (carry forfeited). */
      abandoned?: boolean;
      /** This climb consumed and placed a new ladder (REQ-020). */
      laddered?: boolean;
      /** This step consumed and placed a new plank bridge (legacy). */
      planked?: boolean;
      /** Unsupported movement dropped the miner down empty cells. */
      fell?: number;
      /** The unsupported fall exceeded the gear's safe fall distance. */
      fallFatal?: boolean;
      /** A planted ladder was salvaged from the current cell. */
      collectedLadder?: boolean;
      /** This action placed a plank in the facing cell. */
      plankPlaced?: { col: number; row: number };
      /** Placed supports and beacons salvaged from the world. */
      supportCollected?: Partial<Record<SalvageablePlacement, number>>;
      /** Vibe value added to carried salvage by support pickup. */
      supportSalvageValue?: number;
      /** The swing damaged but did not break the block (REQ-013). */
      cracked?: { kind: CellKind; remaining: number };
      /** The swing damaged but did not break a placed plank. */
      plankCracked?: { remaining: number };
      /** What a collapse/crush cost, for the near-miss reveal (REQ-019). */
      lost?: { value: number; parts: string[]; col: number; row: number };
    }
  | {
      ok: false;
      reason:
        | "blocked"
        | "edge"
        | "rock"
        | "hold-full"
        | "no-dynamite"
        | "no-rope"
        | "no-ladder"
        | "no-plank"
        | "no-elevator"
        | "no-beacon"
        | "out-of-range"
        | "rope-range"
        | "surface";
      /** Pickaxe level needed to cut the blocked resource. */
      requiredPickaxeLevel?: number;
    };

/** Blast-destructible kinds (caches are reinforced; jackpots survive). */
const BLASTABLE: ReadonlySet<CellKind> = new Set([
  "dirt",
  "ore",
  "rock",
  "boulder",
]);

/**
 * Detonates every gas cell 4-adjacent to (col, row), chaining through
 * gas caught in each plus-shaped blast. Returns the number of pockets
 * vented. Destroyed cells (including their loot) become empty.
 */
function ventGasAround(
  state: MineState,
  col: number,
  row: number,
  emptied: Array<{ col: number; row: number }>,
): number {
  const queue: Array<{ col: number; row: number }> = [];
  for (const [dc, dr] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ] as const) {
    const cell = cellAt(state, col + dc, row + dr);
    if (cell?.kind === "gas" || cell?.kind === "magma")
      queue.push({ col: col + dc, row: row + dr });
  }
  let vented = 0;
  while (queue.length > 0) {
    const g = queue.pop();
    if (!g) break;
    const gasCell = cellAt(state, g.col, g.row);
    if (gasCell?.kind !== "gas" && gasCell?.kind !== "magma") continue;
    setCell(state, g.col, g.row, { kind: "empty" });
    emptied.push({ col: g.col, row: g.row });
    // Magma burns triple: it counts as three gas-equivalent vents.
    // Seeped wisps are thin: the chain clears them for free.
    vented += gasCell.kind === "magma" ? 3 : gasCell.gasSeeped ? 0 : 1;
    for (const [dc, dr] of [
      [0, 0],
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as const) {
      const nc = g.col + dc;
      const nr = g.row + dr;
      if (nr < 1 || nr >= MINE_BOTTOM_ROW) continue;
      const n = cellAt(state, nc, nr);
      if (!n) continue;
      if (n.kind === "gas" || n.kind === "magma")
        queue.push({ col: nc, row: nr });
      else if (BLASTABLE.has(n.kind)) {
        setCell(state, nc, nr, { kind: "empty" });
        emptied.push({ col: nc, row: nr });
      }
    }
  }
  return vented;
}

/**
 * Advances every teetering block's countdown by one action; any that
 * reach zero drop until they rest on something solid (REQ-015). The result
 * carries the resting cell when a dropping block passed through or landed on
 * the miner, so the dropped bag can sit on top of the fallen block.
 * Bottom-up per column keeps stacked blocks deterministic.
 */
function tickFalls(
  state: MineState,
  emptied: Array<{ col: number; row: number }>,
): { crushed: boolean; crushRest?: MineCoord } {
  const miner = state.miner;
  let crushed = false;
  let crushRest: MineCoord | undefined;
  // Only override cells teeter (pristine cells never do), so the scan is
  // bounded by the teeter count. Decrement every countdown; the ones
  // that reach zero fall this action. Sort bottom-up, then by column, so
  // stacked blocks settle deterministically regardless of insertion order.
  const dropping: Array<MineCoord & { cell: MineCell }> = [];
  const droppingKeys = new Set<string>();
  for (const [key, cell] of state.cells) {
    if (cell.fallIn === undefined) continue;
    cell.fallIn -= 1;
    if (cell.fallIn > 0) continue;
    const [col, row] = key.split(",").map(Number);
    dropping.push({ col, row, cell });
    droppingKeys.add(key);
  }
  dropping.sort((a, b) => b.row - a.row || a.col - b.col);
  let spanFallNearMiner = false;
  for (const { col, row, cell } of dropping) {
    let rest = row;
    while (true) {
      const below = cellAt(state, col, rest + 1);
      const belowKey = cellKey(col, rest + 1);
      // Seeped wisps are thin air to a falling block: it smashes through
      // and the landing overwrites whichever wisp it rests in.
      const passable =
        below?.kind === "empty" ||
        (below?.kind === "gas" && below.gasSeeped === true);
      if (!passable && !droppingKeys.has(belowKey)) break;
      rest++;
    }
    const crushedByThisBlock =
      miner.col === col && miner.row >= row && miner.row <= rest;
    setCell(state, col, row, { kind: "empty" });
    emptied.push({ col, row });
    // The block relocates intact. The teeter resets and crack damage is
    // shaken off, while the current row defines the pickaxe gate.
    const placed: MineCell = { kind: cell.kind };
    if (cell.kind === "rock") placed.rockTier = rockTierAt(rest);
    if (cell.kind === "rock" || cell.kind === "boulder") placed.fallen = true;
    // A fallen ore cell keeps its deposit: the reserve locks to the
    // origin row so the drop neither mints nor destroys ore.
    if (cell.kind === "ore" && cell.ore) {
      placed.ore = cell.ore;
      placed.oreRemaining = cell.oreRemaining ?? oreReserveAt(cell.ore, row);
      if (cell.drop) placed.drop = cell.drop;
    }
    setCell(state, col, rest, placed);
    if (crushedByThisBlock) {
      crushed = true;
      crushRest ??= { col, row: rest };
    }
    // "Beside you" means beside: within two columns AND within two rows
    // of the fall's path, so recalling home mid-countdown cannot farm
    // the survival stamp from the surface.
    if (
      cell.spanUnstable &&
      Math.abs(miner.col - col) <= 2 &&
      miner.row >= row - 2 &&
      miner.row <= rest + 2
    ) {
      spanFallNearMiner = true;
    }
  }
  // A condemned roof crashing down beside a miner who walks away is the
  // survival moment F-049 stamps; a crush is not surviving it.
  if (spanFallNearMiner && !crushed) state.tripStats.collapsesSurvived += 1;
  return { crushed, crushRest };
}

function isMinerSupported(state: MineState): boolean {
  const miner = state.miner;
  if (miner.row === 0) return true;
  const here = cellAt(state, miner.col, miner.row);
  const below = cellAt(state, miner.col, miner.row + 1);
  return !!(
    here?.ladder ||
    here?.plank ||
    below?.ladder ||
    (below && below.kind !== "empty")
  );
}

function settleMiner(state: MineState): number {
  const miner = state.miner;
  let fell = 0;
  while (!isMinerSupported(state)) {
    const below = cellAt(state, miner.col, miner.row + 1);
    if (below?.kind !== "empty") break;
    miner.row++;
    fell++;
  }
  if (miner.row > miner.maxDepth) miner.maxDepth = miner.row;
  return fell;
}

function isFatalMinerFall(state: MineState, fell: number): boolean {
  return fell > safeFallRows(state.gear);
}

function minerLostCargo(
  miner: MinerState,
  location: MineCoord = miner,
): {
  value: number;
  parts: string[];
  col: number;
  row: number;
} {
  const bag = droppedBagFromMiner(miner);
  return {
    value: bag ? bagValue(bag) : 0,
    parts: bag ? [...bag.parts] : [],
    col: location.col,
    row: location.row,
  };
}

/**
 * Rock and boulders whose support vanished start a fall countdown
 * (REQ-015): they teeter for FALL_DELAY_ACTIONS actions, then drop.
 * Localized: only cells directly above this action's emptied cells can
 * have lost support. Blocks in the hazard-free top rows never fall, so
 * the first lesson stays gentle.
 */
function markUnstable(
  state: MineState,
  emptied: Array<{ col: number; row: number }>,
): MineCoord[] {
  const warnings: MineCoord[] = [];
  for (const { col, row } of emptied) {
    if (cellAt(state, col, row)?.kind !== "empty") continue;
    for (let blockRow = row - 1; blockRow > HAZARD_FREE_ROWS; blockRow--) {
      const above = cellAt(state, col, blockRow);
      if (!above || (above.kind !== "rock" && above.kind !== "boulder")) break;
      if (above.fallIn === undefined) {
        cellMut(state, col, blockRow).fallIn = FALL_DELAY_ACTIONS;
        warnings.push({ col, row: blockRow });
      }
    }
  }
  return warnings;
}

/** Planks prop the roof directly above them; solid cells end a span. */
function isOpenSpanCell(cell: MineCell | null): boolean {
  return cell?.kind === "empty" && !cell.plank;
}

/** Wisps rise first, then drift sideways, then settle down. */
const SEEP_NEIGHBOR_ORDER = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
] as const;

/**
 * Gas propagation: a fall that vacates a cell beside a gas pocket
 * uncorks it (digging beside gas still vents instantly, so falls are
 * the only exposure that leaves a pocket sitting open). The pocket
 * gains a seep budget and starts leaking wisps.
 */
function markGasExposure(
  state: MineState,
  fallEmptied: Array<{ col: number; row: number }>,
): void {
  for (const { col, row } of fallEmptied) {
    if (cellAt(state, col, row)?.kind !== "empty") continue;
    for (const [dc, dr] of SEEP_NEIGHBOR_ORDER) {
      const cell = cellAt(state, col + dc, row + dr);
      if (cell?.kind !== "gas" || cell.gasSeeped) continue;
      const pocket = cellMut(state, col + dc, row + dr);
      if (pocket.gasSeepBudget === undefined) {
        pocket.gasSeepBudget = GAS_SEEP_BUDGET;
      }
    }
  }
}

/**
 * One propagation step per finalized action: seeped wisps age toward
 * fading back to clear air, and every uncorked pocket leaks one wisp
 * into adjacent open tunnel. Wisps never enter cells holding supports,
 * beacons, portals, drops, or bags (placements double as gas breaks)
 * and never the miner's cell, so a leak cannot trap or bury anything.
 * Processing is sorted by position, never by map insertion order, so a
 * live session and a diff-restored replay agree.
 */
function tickGasSeep(state: MineState): void {
  const miner = state.miner;
  const fading: MineCoord[] = [];
  const sources: MineCoord[] = [];
  for (const [key, cell] of state.cells) {
    if (cell.kind !== "gas") continue;
    if (cell.gasSeeped) {
      if (cell.gasFadeIn !== undefined) {
        const [col, row] = key.split(",").map(Number);
        fading.push({ col, row });
      }
    } else if ((cell.gasSeepBudget ?? 0) > 0) {
      const [col, row] = key.split(",").map(Number);
      sources.push({ col, row });
    }
  }
  fading.sort((a, b) => a.row - b.row || a.col - b.col);
  sources.sort((a, b) => a.row - b.row || a.col - b.col);
  for (const { col, row } of fading) {
    const wisp = cellMut(state, col, row);
    wisp.gasFadeIn = (wisp.gasFadeIn ?? 1) - 1;
    if (wisp.gasFadeIn <= 0) setCell(state, col, row, { kind: "empty" });
  }
  for (const { col, row } of sources) {
    const pocket = cellMut(state, col, row);
    for (const [dc, dr] of SEEP_NEIGHBOR_ORDER) {
      const nc = col + dc;
      const nr = row + dr;
      if (nr < 1 || nr >= MINE_BOTTOM_ROW) continue;
      if (miner.col === nc && miner.row === nr) continue;
      const open = cellAt(state, nc, nr);
      if (
        open?.kind !== "empty" ||
        open.ladder ||
        open.plank ||
        open.beacon ||
        open.portal ||
        open.drop ||
        open.bag
      ) {
        continue;
      }
      setCell(state, nc, nr, {
        kind: "gas",
        gasSeeped: true,
        gasFadeIn: GAS_SEEPED_FADE_ACTIONS,
      });
      pocket.gasSeepBudget = (pocket.gasSeepBudget ?? 1) - 1;
      break;
    }
    if ((pocket.gasSeepBudget ?? 0) <= 0) pocket.gasSeepBudget = undefined;
  }
}

/** Ceiling kinds a wide-span collapse can bring down. */
const SPAN_FALL_KINDS: ReadonlySet<CellKind> = new Set([
  "dirt",
  "ore",
  "rock",
  "boulder",
]);

/**
 * Structural integrity: a contiguous unpropped empty span
 * SPAN_COLLAPSE_WIDTH cells wide destabilizes its ceiling, dirt and ore
 * included, on the longer SPAN_COLLAPSE_DELAY_ACTIONS countdown. Cells
 * destabilized here carry `spanUnstable`, so shortening the span with a
 * plank rescues exactly the roof this rule condemned and never cancels
 * a direct undercut teeter. Reconciles both ways: widening marks,
 * propping clears.
 */
function refreshSpanInstability(
  state: MineState,
  changed: MineCoord[],
): MineCoord[] {
  const warnings: MineCoord[] = [];
  const seen = new Set<string>();
  // Cleared condemned ceilings across the pass. One shortened span can
  // clear its whole marked run, so the pass counts as ONE rescue event
  // no matter how many cells it saved (F-049).
  let rescuedCells = 0;
  const reconcile = (col: number, row: number) => {
    const key = cellKey(col, row);
    if (seen.has(key)) return;
    seen.add(key);
    let unstable = false;
    if (isOpenSpanCell(cellAt(state, col, row))) {
      let span = 1;
      for (let c = col - 1; isOpenSpanCell(cellAt(state, c, row)); c--) span++;
      for (let c = col + 1; isOpenSpanCell(cellAt(state, c, row)); c++) span++;
      unstable = span >= SPAN_COLLAPSE_WIDTH;
    }
    const ceiling = cellAt(state, col, row - 1);
    if (!ceiling) return;
    if (unstable && SPAN_FALL_KINDS.has(ceiling.kind)) {
      if (ceiling.fallIn === undefined) {
        const marked = cellMut(state, col, row - 1);
        marked.fallIn = SPAN_COLLAPSE_DELAY_ACTIONS;
        marked.spanUnstable = true;
        warnings.push({ col, row: row - 1 });
      }
    } else if (ceiling.spanUnstable) {
      const rescued = cellMut(state, col, row - 1);
      rescued.fallIn = undefined;
      rescued.spanUnstable = undefined;
      rescuedCells += 1;
    }
  };
  for (const { col, row } of changed) {
    // Ceilings in the hazard-free rows never destabilize; skipping the
    // row here also keeps the walk off the endless empty surface row.
    if (row - 1 <= HAZARD_FREE_ROWS) continue;
    // The changed cell shifts span math for the whole contiguous run it
    // joined or split, so every open cell of that run reconciles.
    reconcile(col, row);
    for (let c = col - 1; isOpenSpanCell(cellAt(state, c, row)); c--)
      reconcile(c, row);
    for (let c = col + 1; isOpenSpanCell(cellAt(state, c, row)); c++)
      reconcile(c, row);
  }
  if (rescuedCells > 0) state.tripStats.roofRescues += 1;
  return warnings;
}

function isFallingRock(cell: MineCell): boolean {
  return (
    (cell.kind === "rock" || cell.kind === "boulder") &&
    (cell.fallIn !== undefined || cell.fallen === true)
  );
}

function rockTierForDig(cell: MineCell, row: number): number {
  return isFallingRock(cell)
    ? rockTierAt(row)
    : (cell.rockTier ?? rockTierAt(row));
}

function digKindFor(cell: MineCell): CellKind {
  return isFallingRock(cell) ? "rock" : cell.kind;
}

function hitsForDig(cell: MineCell, gear: MineGear): number {
  const base = hitsFor(digKindFor(cell), gear);
  return isFallingRock(cell) ? Math.max(FALLING_ROCK_MIN_HITS, base) : base;
}

function settleAfterEmptied(
  state: MineState,
  emptied: Array<{ col: number; row: number }>,
  fallEmptied: Array<{ col: number; row: number }> = [],
  changedSupports: MineCoord[] = [],
  spanChanged: MineCoord[] = [],
): {
  fallingRockTriggered: boolean;
  fallingRockWarnings: MineCoord[];
  ladderFalls: LadderFall[];
} {
  const allEmptied = [...emptied, ...fallEmptied];
  const fallingRockWarnings = markUnstable(state, allEmptied);
  // Fall-emptied cells feed the direct undercut rule above but never the
  // span rule: a collapse settles the cavity it carved instead of
  // unzipping the overburden row by row. Only player-carved width (digs,
  // blasts, vents) and plank changes re-measure spans.
  fallingRockWarnings.push(
    ...refreshSpanInstability(state, [...emptied, ...spanChanged]),
  );
  const ladderFalls = settleUnsupportedLadders(state, [
    ...allEmptied,
    ...changedSupports,
  ]);
  settleUnsupportedDrops(state);
  // Gas runs after span accounting so wisps never masquerade as props:
  // falls uncork adjacent pockets, then every leak advances one step.
  markGasExposure(state, fallEmptied);
  tickGasSeep(state);
  return {
    fallingRockTriggered: fallingRockWarnings.length > 0,
    fallingRockWarnings,
    ladderFalls,
  };
}

function warningCellsOrUndefined(
  warnings: MineCoord[],
): MineCoord[] | undefined {
  return warnings.length > 0 ? warnings : undefined;
}

function combineWarningCells(
  a?: MineCoord[],
  b?: MineCoord[],
): MineCoord[] | undefined {
  if (!a?.length) return b?.length ? b : undefined;
  if (!b?.length) return a;
  return [...a, ...b];
}

/**
 * Dig toward or move into the adjacent cell. Dirt/ore/cache cells are
 * dug (cost + loot); empty cells are walked into; rock needs the
 * pickaxe tier for its depth (REQ-013) and costs more energy to cut;
 * a full cargo hold spills dug ore onto the nearest surface (REQ-014);
 * moving up
 * works only through already-dug cells AND needs a ladder in the cell
 * being climbed from (REQ-020): one is consumed and placed on first
 * climb, then the shaft climbs free until something smashes it.
 */
export function step(state: MineState, dir: Direction): MoveResult {
  const miner = state.miner;
  if (dir === "down" && cellAt(state, miner.col, miner.row)?.plank)
    return breakCurrentPlank(state);
  const t = target(state, dir);
  if (isPendingDynamiteAt(state, t.col, t.row))
    return { ok: false, reason: "blocked" };
  let cell = cellAt(state, t.col, t.row);
  if (!cell) return { ok: false, reason: "edge" };
  // A seeped wisp disperses when the miner shoulders through: the step
  // continues into clear air with an extra puff of battery drain. Real
  // pockets still block and only vent through a dig or blast.
  if (cell.kind === "gas" && cell.gasSeeped) {
    setCell(state, t.col, t.row, { kind: "empty" });
    cell = cellAt(state, t.col, t.row) ?? { kind: "empty" };
    miner.energy = Math.max(0, miner.energy - GAS_WISP_DISPERSE_DRAIN);
  }
  const isRockLike = cell.kind === "rock" || isFallingRock(cell);
  if (isRockLike) {
    const rockTier = rockTierForDig(cell, t.row);
    if (!canDigRock(state.gear, rockTier))
      return {
        ok: false,
        reason: "rock",
        requiredPickaxeLevel: rockTier + 1,
      };
  }
  if (
    cell.kind === "metal" ||
    (cell.kind === "boulder" && !isFallingRock(cell)) ||
    cell.kind === "gas" ||
    cell.kind === "magma"
  )
    return { ok: false, reason: "blocked" };
  const isOverheadDig = dir === "up" && cell.kind !== "empty";
  if (cell.kind === "ore" && cell.ore) {
    clearJumpHover(state);
    const ore = cell.ore;
    const struck = cellMut(state, t.col, t.row);
    const current = struck.oreRemaining ?? oreReserveAt(ore, t.row);
    const units = oreSwingYield(
      state.seed,
      state.gear,
      ore,
      t.row,
      t.col,
      current,
    );
    const spent = Math.max(1, units);
    const remaining = current - spent;
    const { dropped: spilled, leftover } =
      units > 0
        ? fillHold(state, { [ore]: units })
        : { dropped: 0, leftover: {} };
    const dropped = spilled;
    const emptied: Array<{ col: number; row: number }> = [];
    if (remaining > 0) {
      struck.oreRemaining = remaining;
      delete struck.hp;
      if (spilled > 0) struck.drop = mergeOrePiles(struck.drop, leftover);
    } else {
      const emptyCell: MineCell = cell.plank
        ? { kind: "empty", plank: true }
        : { kind: "empty" };
      const preservedDrop = mergeOrePiles(struck.drop, leftover);
      if (orePileCount(preservedDrop) > 0) emptyCell.drop = preservedDrop;
      setCell(state, t.col, t.row, emptyCell);
      emptied.push({ col: t.col, row: t.row });
    }
    const vented =
      remaining <= 0 ? ventGasAround(state, t.col, t.row, emptied) : 0;
    miner.energy = Math.max(
      0,
      miner.energy - oreSwingCostFor(ore, state.gear) - vented * GAS_VENT_DRAIN,
    );
    if (remaining <= 0 && !isOverheadDig) {
      miner.col = t.col;
      miner.row = t.row;
      if (miner.row > miner.maxDepth) miner.maxDepth = miner.row;
    }
    const fallEmptied: Array<{ col: number; row: number }> = [];
    const fallTick = tickFalls(state, fallEmptied);
    const settled = settleAfterEmptied(state, emptied, fallEmptied);
    const fell = settleMiner(state);
    const fellTooFar = isFatalMinerFall(state, fell);
    const oreHarvested = {
      ore,
      units,
      dropped: dropped > 0 ? dropped : undefined,
      remaining: Math.max(0, remaining),
    };
    if (
      fallTick.crushed ||
      fellTooFar ||
      (miner.row > 0 && miner.energy <= 0)
    ) {
      const lost = minerLostCargo(miner, fallTick.crushRest);
      collapse(state, true, lost);
      return {
        ok: true,
        dug: remaining <= 0 ? "ore" : null,
        dugAt: remaining <= 0 ? { col: t.col, row: t.row } : undefined,
        dugOre: remaining <= 0 ? ore : null,
        dugOreCount: remaining <= 0 ? units : undefined,
        oreHarvested: units > 0 ? oreHarvested : undefined,
        found: null,
        collapsed: true,
        crushed: fallTick.crushed || fellTooFar,
        fallingRockTriggered: settled.fallingRockTriggered || undefined,
        fallingRockWarnings: warningCellsOrUndefined(
          settled.fallingRockWarnings,
        ),
        ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
        vented,
        dropped: dropped > 0 ? dropped : undefined,
        bagFull: dropped > 0 ? true : undefined,
        fell: fell || undefined,
        fallFatal: fellTooFar || undefined,
        lost,
      };
    }
    return maybeExplodePendingDynamite(state, {
      ok: true,
      dug: remaining <= 0 ? "ore" : null,
      dugAt: remaining <= 0 ? { col: t.col, row: t.row } : undefined,
      dugOre: remaining <= 0 ? ore : null,
      dugOreCount: remaining <= 0 ? units : undefined,
      oreHarvested: units > 0 ? oreHarvested : undefined,
      found: null,
      collapsed: false,
      crushed: fallTick.crushed,
      fallingRockTriggered: settled.fallingRockTriggered || undefined,
      fallingRockWarnings: warningCellsOrUndefined(settled.fallingRockWarnings),
      ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
      vented,
      dropped: dropped > 0 ? dropped : undefined,
      bagFull: dropped > 0 ? true : undefined,
      fell: fell || undefined,
      cracked:
        remaining > 0
          ? { kind: "ore", remaining: Math.max(0, remaining) }
          : undefined,
    });
  }
  // Multi-hit digging (REQ-013): a solid cell soaks swings before it
  // breaks; only the breaking swing moves the miner and yields loot.
  // Every swing is its own logged action and burns battery charge, so a
  // dig can still collapse the trip mid-block.
  if (cell.kind !== "empty") {
    clearJumpHover(state);
    const struck = cellMut(state, t.col, t.row);
    const kindForDig = digKindFor(struck);
    const remaining = (struck.hp ?? hitsForDig(struck, state.gear)) - 1;
    if (remaining > 0) {
      struck.hp = remaining;
      miner.energy = Math.max(
        0,
        miner.energy - swingCostFor(kindForDig, state.gear),
      );
      // A swing is a full action: teetering blocks count down and drop,
      // and the battery can still run out mid-block.
      const fallEmptiedMid: Array<{ col: number; row: number }> = [];
      const fallTickMid = tickFalls(state, fallEmptiedMid);
      const settledMid = settleAfterEmptied(state, [], fallEmptiedMid);
      const fellMid = settleMiner(state);
      const fellTooFarMid = isFatalMinerFall(state, fellMid);
      if (
        fallTickMid.crushed ||
        fellTooFarMid ||
        (miner.row > 0 && miner.energy <= 0)
      ) {
        const lost = minerLostCargo(miner, fallTickMid.crushRest);
        collapse(state, true, lost);
        return {
          ok: true,
          dug: null,
          dugOre: null,
          found: null,
          collapsed: true,
          crushed: fallTickMid.crushed || fellTooFarMid,
          fallingRockTriggered: settledMid.fallingRockTriggered || undefined,
          fallingRockWarnings: warningCellsOrUndefined(
            settledMid.fallingRockWarnings,
          ),
          ladderFalls: ladderFallsOrUndefined(settledMid.ladderFalls),
          fell: fellMid || undefined,
          fallFatal: fellTooFarMid || undefined,
          lost,
        };
      }
      return maybeExplodePendingDynamite(state, {
        ok: true,
        dug: null,
        dugOre: null,
        found: null,
        collapsed: false,
        fallingRockTriggered: settledMid.fallingRockTriggered || undefined,
        fallingRockWarnings: warningCellsOrUndefined(
          settledMid.fallingRockWarnings,
        ),
        ladderFalls: ladderFallsOrUndefined(settledMid.ladderFalls),
        fell: fellMid || undefined,
        cracked: { kind: kindForDig, remaining },
      });
    }
  }
  let laddered = false;
  if (dir === "up" && cell.kind === "empty" && miner.row >= 1) {
    const here = cellMut(state, miner.col, miner.row);
    if (!here.ladder) {
      if (state.consumables.ladder <= 0)
        return { ok: false, reason: "no-ladder" };
      if (isOnElevatorRail(state)) return { ok: false, reason: "blocked" };
      state.consumables.ladder--;
      state.used.ladder++;
      here.ladder = true;
      laddered = true;
    }
  }
  clearJumpHover(state);
  // Lateral steps never auto-spend planks anymore (REQ-022). A placed
  // plank or ladder support prevents falling; otherwise the move is still
  // legal and deterministic gravity drops the miner after the move.

  let dug: CellKind | null = null;
  let dugOre: OreId | null = null;
  let dugOreCount: number | undefined;
  let found: string | null = null;
  let cost = MOVE_COST;
  let vented = 0;
  let dropped = 0;
  const emptied: Array<{ col: number; row: number }> = [];
  if (cell.kind !== "empty") {
    const kindForDig = digKindFor(cell);
    dug = kindForDig;
    cost = swingCostFor(kindForDig, state.gear);
    let overflowPile: Partial<Record<OreId, number>> | undefined;
    if (cell.kind === "ore" && cell.ore) {
      const units = oreUnitsAt(t.row);
      const { dropped: spilled, leftover } = fillHold(state, {
        [cell.ore]: units,
      });
      dugOre = cell.ore;
      dugOreCount = units;
      if (spilled > 0) overflowPile = leftover;
    }
    if (cell.kind === "part-cache") {
      found = rollCachePart(state, t.col, t.row);
      miner.carriedParts.push(found);
    }
    setCell(
      state,
      t.col,
      t.row,
      cell.plank ? { kind: "empty", plank: true } : { kind: "empty" },
    );
    emptied.push({ col: t.col, row: t.row });
    if (overflowPile) {
      dropped += dropOreToSurface(state, t.col, t.row, overflowPile);
    }
    // Digging next to a pocket vents it: the burn taxes the robot battery.
    vented = ventGasAround(state, t.col, t.row, emptied);
  }

  const planked = false;

  miner.energy = Math.max(0, miner.energy - cost - vented * GAS_VENT_DRAIN);
  if (!isOverheadDig) {
    miner.col = t.col;
    miner.row = t.row;
    if (miner.row > miner.maxDepth) miner.maxDepth = miner.row;
  }

  const fallEmptied: Array<{ col: number; row: number }> = [];
  const fallTick = tickFalls(state, fallEmptied);
  const settled = settleAfterEmptied(state, emptied, fallEmptied);
  const fell = settleMiner(state);
  const fellTooFar = isFatalMinerFall(state, fell);
  const { pickedUp, pickedUpBag } = pickupAtMiner(state);

  let collapsed = false;
  let lost: { value: number; parts: string[]; col: number; row: number };
  if (fallTick.crushed || fellTooFar || (miner.row > 0 && miner.energy <= 0)) {
    lost = minerLostCargo(miner, fallTick.crushRest);
    collapse(state, true, lost);
    collapsed = true;
    return {
      ok: true,
      dug,
      dugAt: dug ? { col: t.col, row: t.row } : undefined,
      dugOre,
      dugOreCount,
      found,
      collapsed,
      crushed: fallTick.crushed || fellTooFar,
      fallingRockTriggered: settled.fallingRockTriggered || undefined,
      fallingRockWarnings: warningCellsOrUndefined(settled.fallingRockWarnings),
      ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
      vented,
      dropped: dropped > 0 ? dropped : undefined,
      bagFull: dropped > 0 ? true : undefined,
      laddered,
      planked,
      fell: fell || undefined,
      fallFatal: fellTooFar || undefined,
      lost,
    };
  }
  if (miner.row === 0) {
    bank(miner, state.gear);
  }
  return maybeExplodePendingDynamite(state, {
    ok: true,
    dug,
    dugAt: dug ? { col: t.col, row: t.row } : undefined,
    dugOre,
    dugOreCount,
    found,
    collapsed,
    crushed: fallTick.crushed,
    fallingRockTriggered: settled.fallingRockTriggered || undefined,
    fallingRockWarnings: warningCellsOrUndefined(settled.fallingRockWarnings),
    ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
    vented,
    dropped: dropped > 0 ? dropped : undefined,
    bagFull: dropped > 0 ? true : undefined,
    laddered,
    planked,
    fell: fell || undefined,
    pickedUp,
    pickedUpBag,
  });
}

function isOnElevatorRail(state: MineState): boolean {
  const rail = Math.min(state.gear.elevator, MINE_BOTTOM_ROW - 1);
  return (
    rail > 0 &&
    state.miner.col === ELEVATOR_COL &&
    state.miner.row >= 0 &&
    state.miner.row <= rail
  );
}

export function canPlacePlank(
  state: MineState,
  dir: "left" | "right",
): boolean {
  return plankPlacementTarget(state, dir).ok;
}

type MoveFailureReason = Extract<MoveResult, { ok: false }>["reason"];

function clearJumpHover(state: MineState): void {
  state.jumpHover = false;
}

export function canJump(state: MineState): boolean {
  if (state.jumpHover) return false;
  if (isOnElevatorRail(state)) return false;
  const miner = state.miner;
  if (miner.row < 1) return false;
  const t = { col: miner.col, row: miner.row - 1 };
  if (isPendingDynamiteAt(state, t.col, t.row)) return false;
  const cell = cellAt(state, t.col, t.row);
  return cell?.kind === "empty";
}

/**
 * True when the miner is standing on a plank bridge and a `down` action
 * would break it to drop through (the desktop Shift + Down control, F-059).
 * The `down` step already routes a plank underfoot to breakCurrentPlank; a
 * plain down elsewhere digs, so this predicate lets the input layer offer
 * a plank-drop that never accidentally mines.
 */
export function canDropThroughPlank(state: MineState): boolean {
  const miner = state.miner;
  if (miner.row < 1) return false;
  return cellAt(state, miner.col, miner.row)?.plank === true;
}

function jumpJets(state: MineState): MoveResult {
  if (!canJump(state)) return { ok: false, reason: "blocked" };
  const miner = state.miner;
  miner.energy = Math.max(0, miner.energy - MOVE_COST);
  miner.row--;
  state.jumpHover = true;
  const jumped = { col: miner.col, row: miner.row };
  const fallEmptied: Array<{ col: number; row: number }> = [];
  const fallTick = tickFalls(state, fallEmptied);
  const settled = settleAfterEmptied(state, [], fallEmptied);
  if (fallTick.crushed || (miner.row > 0 && miner.energy <= 0)) {
    const lost = minerLostCargo(miner, fallTick.crushRest);
    state.jumpHover = false;
    collapse(state, true, lost);
    return {
      ok: true,
      dug: null,
      dugOre: null,
      found: null,
      collapsed: true,
      crushed: fallTick.crushed,
      fallingRockTriggered: settled.fallingRockTriggered || undefined,
      fallingRockWarnings: warningCellsOrUndefined(settled.fallingRockWarnings),
      ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
      jumped,
      lost,
    };
  }
  if (miner.row === 0) {
    bank(miner, state.gear);
  }
  return maybeExplodePendingDynamite(state, {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: false,
    fallingRockTriggered: settled.fallingRockTriggered || undefined,
    fallingRockWarnings: warningCellsOrUndefined(settled.fallingRockWarnings),
    ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
    jumped,
  });
}

function plankPlacementTarget(
  state: MineState,
  dir: "left" | "right",
):
  | { ok: true; col: number; row: number }
  | { ok: false; reason: MoveFailureReason } {
  if (state.consumables.plank <= 0) return { ok: false, reason: "no-plank" };
  if (isOnElevatorRail(state)) return { ok: false, reason: "blocked" };
  const t = target(state, dir);
  if (t.row < 1) return { ok: false, reason: "surface" };
  const cell = cellAt(state, t.col, t.row);
  if (cell?.kind === "metal") return { ok: false, reason: "blocked" };
  const below = cellAt(state, t.col, t.row + 1);
  if (!cell || !below) return { ok: false, reason: "edge" };
  // Planks bridge voids AND prop roofs: solid ground below is fine, the
  // brace still splits a wide span and steadies the ceiling above it.
  if (cell.ladder || cell.plank) return { ok: false, reason: "blocked" };
  if (cell.kind === "boulder" || cell.kind === "gas" || cell.kind === "magma")
    return { ok: false, reason: "blocked" };
  return { ok: true, col: t.col, row: t.row };
}

function finishStationaryAction(
  state: MineState,
  base: Extract<MoveResult, { ok: true }>,
  changedSupports: MineCoord[] = [],
  spanChanged: MineCoord[] = [],
): MoveResult {
  clearJumpHover(state);
  const fallEmptied: Array<{ col: number; row: number }> = [];
  const fallTick = tickFalls(state, fallEmptied);
  const settled = settleAfterEmptied(
    state,
    [],
    fallEmptied,
    changedSupports,
    spanChanged,
  );
  const fell = settleMiner(state);
  const fellTooFar = isFatalMinerFall(state, fell);
  if (fallTick.crushed || fellTooFar) {
    const lost = minerLostCargo(state.miner, fallTick.crushRest);
    collapse(state, true, lost);
    return {
      ...base,
      collapsed: true,
      crushed: true,
      fallingRockTriggered:
        base.fallingRockTriggered || settled.fallingRockTriggered || undefined,
      fallingRockWarnings: combineWarningCells(
        base.fallingRockWarnings,
        settled.fallingRockWarnings,
      ),
      ladderFalls: combinedLadderFalls(base.ladderFalls, settled.ladderFalls),
      fell: fell || undefined,
      fallFatal: fellTooFar || undefined,
      lost,
    };
  }
  return maybeExplodePendingDynamite(state, {
    ...base,
    fallingRockTriggered:
      base.fallingRockTriggered || settled.fallingRockTriggered || undefined,
    fallingRockWarnings: combineWarningCells(
      base.fallingRockWarnings,
      settled.fallingRockWarnings,
    ),
    ladderFalls: combinedLadderFalls(base.ladderFalls, settled.ladderFalls),
    fell: fell || base.fell,
  });
}

function placePlank(state: MineState, dir: "left" | "right"): MoveResult {
  const placement = plankPlacementTarget(state, dir);
  if (!placement.ok) return placement;
  state.consumables.plank--;
  state.used.plank++;
  cellMut(state, placement.col, placement.row).plank = true;
  return finishStationaryAction(
    state,
    {
      ok: true,
      dug: null,
      dugOre: null,
      found: null,
      collapsed: false,
      plankPlaced: { col: placement.col, row: placement.row },
    },
    [],
    [{ col: placement.col, row: placement.row }],
  );
}

function breakCurrentPlank(state: MineState): MoveResult {
  const miner = state.miner;
  const cell = cellAt(state, miner.col, miner.row);
  if (!cell?.plank) return { ok: false, reason: "blocked" };
  miner.energy = Math.max(0, miner.energy - MOVE_COST);
  const current = cellMut(state, miner.col, miner.row);
  const remaining = (current.plankHp ?? PLANK_HITS) - 1;
  if (remaining > 0) {
    current.plankHp = remaining;
    const base = {
      ok: true,
      dug: null,
      dugOre: null,
      found: null,
      collapsed: false,
      plankCracked: { remaining },
    } satisfies Extract<MoveResult, { ok: true }>;
    if (miner.row > 0 && miner.energy <= 0) {
      const lost = minerLostCargo(miner);
      collapse(state, true, lost);
      return {
        ...base,
        collapsed: true,
        lost,
      };
    }
    return finishStationaryAction(state, base);
  }
  current.plank = undefined;
  current.plankHp = undefined;
  const salvageValue = salvageSupport(state, "plank");
  const base = {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: false,
    supportCollected: { plank: 1 },
    supportSalvageValue: salvageValue,
  } satisfies Extract<MoveResult, { ok: true }>;
  if (miner.row > 0 && miner.energy <= 0) {
    const lost = minerLostCargo(miner);
    collapse(state, true, lost);
    return {
      ...base,
      collapsed: true,
      lost,
    };
  }
  // Removing the prop can merge two safe spans into one wide one.
  return finishStationaryAction(
    state,
    base,
    [],
    [{ col: miner.col, row: miner.row }],
  );
}

export function collectablePlacements(state: MineState): CollectTarget[] {
  const items: CollectTarget[] = [];
  for (const [key, cell] of state.cells) {
    if (!cell.ladder && !cell.plank && !cell.beacon) continue;
    const [col, row] = key.split(",").map(Number);
    if (!isVisible(state, col, row) || !isSupportSalvageTarget(state, col, row))
      continue;
    if (cell.ladder) items.push({ type: "ladder", col, row });
    if (cell.plank) items.push({ type: "plank", col, row });
    if (cell.beacon) items.push({ type: "beacon", col, row });
  }
  items.sort(
    (a, b) => a.row - b.row || a.col - b.col || a.type.localeCompare(b.type),
  );
  return items;
}

function collectPlaced(state: MineState, action: MineAction): MoveResult {
  const targets = parseCollectAction(action);
  if (!targets || targets.length === 0) return { ok: false, reason: "blocked" };
  for (const item of targets) {
    const cell = cellAt(state, item.col, item.row);
    if (
      !cell ||
      !isVisible(state, item.col, item.row) ||
      !isSupportSalvageTarget(state, item.col, item.row) ||
      !cell[item.type]
    )
      return { ok: false, reason: "blocked" };
  }
  const collected: Partial<Record<SalvageablePlacement, number>> = {};
  const changedSupports: MineCoord[] = [];
  const spanChanged: MineCoord[] = [];
  let salvageValue = 0;
  for (const item of targets) {
    const cell = cellMut(state, item.col, item.row);
    cell[item.type] = undefined;
    if (item.type === "ladder")
      changedSupports.push({ col: item.col, row: item.row });
    if (item.type === "plank")
      spanChanged.push({ col: item.col, row: item.row });
    if (item.type === "beacon") {
      cell.beaconOrder = undefined;
      cell.beaconLabel = undefined;
    }
    const value = salvageSupport(state, item.type);
    salvageValue += value;
    collected[item.type] = (collected[item.type] ?? 0) + 1;
  }
  return finishStationaryAction(
    state,
    {
      ok: true,
      dug: null,
      dugOre: null,
      found: null,
      collapsed: false,
      supportCollected: collected,
      supportSalvageValue: salvageValue,
    },
    changedSupports,
    spanChanged,
  );
}

/** The part a cache at (col,row) yields; deterministic from the seed. */
function rollCachePart(state: MineState, col: number, row: number): string {
  const table = cachePartIdsAt(row);
  const pick = cellRandom(state.seed, row, col, 1);
  return table[Math.floor(pick * table.length)];
}

const DYNAMITE_TIER_OFFSETS: Record<
  Exclude<DynamiteTier, 4>,
  ReadonlyArray<readonly [number, number]>
> = {
  1: [
    [0, 0],
    [0, -1],
    [-1, 0],
    [1, 0],
    [0, 1],
  ],
  2: [
    [0, 0],
    [0, -1],
    [0, -2],
    [-1, 0],
    [-2, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ],
  3: [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [0, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ],
};

export function dynamiteBlastCells(
  state: MineState,
  center: MineCoord,
  tier: DynamiteTier,
): MineCoord[] {
  if (tier === 4) {
    const radius = lightRadius(state.gear);
    const cells: MineCoord[] = [];
    for (let row = center.row - radius; row <= center.row + radius; row++) {
      if (row < 1 || row >= MINE_BOTTOM_ROW) continue;
      for (let col = center.col - radius; col <= center.col + radius; col++) {
        if (
          Math.max(Math.abs(col - center.col), Math.abs(row - center.row)) <=
          radius
        ) {
          cells.push({ col, row });
        }
      }
    }
    return cells;
  }
  return DYNAMITE_TIER_OFFSETS[tier]
    .map(([dc, dr]) => ({ col: center.col + dc, row: center.row + dr }))
    .filter((cell) => cell.row >= 1 && cell.row < MINE_BOTTOM_ROW);
}

export function dynamitePreviewCells(
  state: MineState,
  tier: DynamiteTier,
): MineCoord[] {
  return dynamiteBlastCells(state, state.miner, tier).filter((coord) => {
    const cell = cellAt(state, coord.col, coord.row);
    return Boolean(
      cell &&
        (BLASTABLE.has(cell.kind) ||
          cell.kind === "part-cache" ||
          cell.kind === "gas" ||
          cell.kind === "magma"),
    );
  });
}

interface ExplosionResult {
  vented?: number;
  blasted?: number;
  collected?: number;
  dropped?: number;
  bagFull?: boolean;
  foundParts?: string[];
  fallingRockTriggered?: boolean;
  fallingRockWarnings?: MineCoord[];
  ladderFalls?: LadderFall[];
  exploded: PendingDynamite;
}

/**
 * Resolves a lit charge once the miner has stepped clear. The selected tier
 * controls the blast shape; it clears dirt, any rock tier, and boulders, and
 * collects ore and caches.
 * Ore beyond the cargo hold spills onto the floor to scoop up later.
 */
function detonateDynamiteAt(
  state: MineState,
  center: PendingDynamite,
): ExplosionResult {
  state.pendingDynamite = undefined;
  const miner = state.miner;
  let blasted = 0;
  let vented = 0;
  let collected = 0;
  let dropped = 0;
  const foundParts: string[] = [];
  const emptied: Array<{ col: number; row: number }> = [];
  for (const coord of dynamiteBlastCells(state, center, center.tier)) {
    const nc = coord.col;
    const nr = coord.row;
    const cell = cellAt(state, nc, nr);
    if (!cell) continue;
    if (cell.kind === "gas" || cell.kind === "magma") {
      // Light it from a distance: chains, but the heat misses the miner.
      setCell(state, nc, nr, { kind: "empty" });
      emptied.push({ col: nc, row: nr });
      vented +=
        (cell.kind === "magma" ? 3 : cell.gasSeeped ? 0 : 1) +
        ventGasAround(state, nc, nr, emptied);
      blasted++;
      continue;
    }
    if (cell.kind === "part-cache") {
      // Dynamite cracks caches the diamond reaches directly (gas chains
      // still leave them be); the part is collected free of the hold.
      const part = rollCachePart(state, nc, nr);
      miner.carriedParts.push(part);
      foundParts.push(part);
      setCell(state, nc, nr, { kind: "empty" });
      emptied.push({ col: nc, row: nr });
      blasted++;
      continue;
    }
    if (!BLASTABLE.has(cell.kind)) continue;
    // Re-collect any pile already on the cell too, so re-blasting a drop
    // is a valid way to scoop it once the hold has room.
    const pile: Partial<Record<OreId, number>> = { ...cell.drop };
    if (cell.kind === "ore" && cell.ore) {
      const current = cell.oreRemaining ?? oreReserveAt(cell.ore, nr);
      const mined = Math.min(current, dynamiteOreHarvestUnits(center.tier));
      pile[cell.ore] = (pile[cell.ore] ?? 0) + mined;
      if (mined < current) {
        const oreCell = cellMut(state, nc, nr);
        oreCell.oreRemaining = current - mined;
        delete oreCell.hp;
        delete oreCell.drop;
      } else {
        setCell(state, nc, nr, { kind: "empty" });
        emptied.push({ col: nc, row: nr });
      }
    } else {
      setCell(state, nc, nr, { kind: "empty" });
      emptied.push({ col: nc, row: nr });
    }
    blasted++;
    // Fill the hold from the blast centre outward; overflow falls until
    // it lands on the nearest surface.
    const { taken, dropped: spilled, leftover } = fillHold(state, pile);
    collected += taken;
    dropped += spilled;
    if (spilled > 0) dropOreToSurface(state, nc, nr, leftover);
  }
  const settled = settleAfterEmptied(state, emptied);
  return {
    vented: vented > 0 ? vented : undefined,
    blasted: blasted > 0 ? blasted : undefined,
    collected: collected > 0 ? collected : undefined,
    dropped: dropped > 0 ? dropped : undefined,
    bagFull: dropped > 0 ? true : undefined,
    foundParts: foundParts.length > 0 ? foundParts : undefined,
    fallingRockTriggered: settled.fallingRockTriggered || undefined,
    fallingRockWarnings: warningCellsOrUndefined(settled.fallingRockWarnings),
    ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
    exploded: center,
  };
}

function maybeExplodePendingDynamite(
  state: MineState,
  result: Extract<MoveResult, { ok: true }>,
): MoveResult {
  const charge = state.pendingDynamite;
  if (!charge || result.collapsed || !hasDynamiteGap(state, charge))
    return result;
  clearJumpHover(state);
  const explosion = detonateDynamiteAt(state, charge);
  const vented = (result.vented ?? 0) + (explosion.vented ?? 0);
  const collected = (result.collected ?? 0) + (explosion.collected ?? 0);
  const dropped = (result.dropped ?? 0) + (explosion.dropped ?? 0);
  const bagFull = result.bagFull || explosion.bagFull;
  const foundParts = [
    ...(result.foundParts ?? []),
    ...(explosion.foundParts ?? []),
  ];
  const ladderFalls =
    explosion.ladderFalls && explosion.ladderFalls.length > 0
      ? [...(result.ladderFalls ?? []), ...explosion.ladderFalls]
      : result.ladderFalls;
  const fell = settleMiner(state);
  const totalFell = (result.fell ?? 0) + fell;
  if (isFatalMinerFall(state, totalFell)) {
    const lost = minerLostCargo(state.miner);
    collapse(state, true, lost);
    return {
      ...result,
      vented: vented > 0 ? vented : undefined,
      blasted: explosion.blasted,
      collected: collected > 0 ? collected : undefined,
      dropped: dropped > 0 ? dropped : undefined,
      bagFull: bagFull ? true : undefined,
      foundParts: foundParts.length > 0 ? foundParts : undefined,
      exploded: explosion.exploded,
      collapsed: true,
      crushed: true,
      fallingRockTriggered:
        result.fallingRockTriggered || explosion.fallingRockTriggered
          ? true
          : undefined,
      fallingRockWarnings: combineWarningCells(
        result.fallingRockWarnings,
        explosion.fallingRockWarnings,
      ),
      ladderFalls,
      fell: totalFell > 0 ? totalFell : undefined,
      fallFatal: true,
      lost,
    };
  }
  return {
    ...result,
    vented: vented > 0 ? vented : undefined,
    blasted: explosion.blasted,
    collected: collected > 0 ? collected : undefined,
    dropped: dropped > 0 ? dropped : undefined,
    bagFull: bagFull ? true : undefined,
    foundParts: foundParts.length > 0 ? foundParts : undefined,
    exploded: explosion.exploded,
    fallingRockTriggered:
      result.fallingRockTriggered || explosion.fallingRockTriggered
        ? true
        : undefined,
    fallingRockWarnings: combineWarningCells(
      result.fallingRockWarnings,
      explosion.fallingRockWarnings,
    ),
    ladderFalls,
    fell: totalFell > 0 ? totalFell : undefined,
  };
}

/**
 * Places a lit dynamite charge at the miner's current cell. It explodes after
 * a later successful action moves the miner off the charge.
 */
function plantDynamite(state: MineState, tier: DynamiteTier): MoveResult {
  if (state.consumables.dynamite <= 0)
    return { ok: false, reason: "no-dynamite" };
  if (tier > dynamiteTier(state.gear)) return { ok: false, reason: "blocked" };
  if (state.pendingDynamite) return { ok: false, reason: "blocked" };
  const t = { col: state.miner.col, row: state.miner.row, tier };
  state.consumables.dynamite--;
  state.used.dynamite++;
  state.pendingDynamite = t;
  const fallEmptied: Array<{ col: number; row: number }> = [];
  const fallTick = tickFalls(state, fallEmptied);
  const settled = settleAfterEmptied(state, [], fallEmptied);
  const fell = settleMiner(state);
  const fellTooFar = isFatalMinerFall(state, fell);
  if (fallTick.crushed || fellTooFar) {
    const lost = minerLostCargo(state.miner, fallTick.crushRest);
    collapse(state, true, lost);
    return {
      ok: true,
      dug: null,
      dugOre: null,
      found: null,
      collapsed: true,
      crushed: true,
      fallingRockTriggered: settled.fallingRockTriggered || undefined,
      fallingRockWarnings: warningCellsOrUndefined(settled.fallingRockWarnings),
      ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
      dynamitePlanted: t,
      lost,
      fell: fell || undefined,
      fallFatal: fellTooFar || undefined,
    };
  }
  return {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: false,
    fallingRockTriggered: settled.fallingRockTriggered || undefined,
    fallingRockWarnings: warningCellsOrUndefined(settled.fallingRockWarnings),
    ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
    dynamitePlanted: t,
    fell: fell || undefined,
  };
}

function collectLadder(state: MineState): MoveResult {
  const { col, row } = state.miner;
  const cell = cellAt(state, col, row);
  if (!cell?.ladder) return { ok: false, reason: "blocked" };
  cellMut(state, col, row).ladder = undefined;
  const salvageValue = salvageSupport(state, "ladder");
  return finishStationaryAction(
    state,
    {
      ok: true,
      dug: null,
      dugOre: null,
      found: null,
      collapsed: false,
      collectedLadder: true,
      supportCollected: { ladder: 1 },
      supportSalvageValue: salvageValue,
    },
    [{ col, row }],
  );
}

/** The recall rope: banks the carry when the miner is inside rope range. */
function recall(state: MineState): MoveResult {
  const miner = state.miner;
  if (miner.row === 0) return { ok: false, reason: "surface" };
  if (state.consumables.rope <= 0) return { ok: false, reason: "no-rope" };
  if (miner.row > recallRopeRange(state.gear)) {
    return { ok: false, reason: "rope-range" };
  }
  state.consumables.rope--;
  state.used.rope++;
  miner.col = START_COL;
  miner.row = 0;
  bank(miner, state.gear);
  return {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: false,
    recalled: true,
  };
}

/**
 * Giving up (REQ-025): always available below ground, no consumable
 * needed. The crew hauls you up and the carry stays behind, exactly
 * like a collapse but chosen. The escape valve for being stuck with
 * no ladders and no rope.
 */
function abandon(state: MineState): MoveResult {
  const miner = state.miner;
  if (miner.row === 0) return { ok: false, reason: "surface" };
  const lost = {
    value: carriedValue(miner),
    parts: [...miner.carriedParts],
    col: miner.col,
    row: miner.row,
  };
  // Giving up grants no free recovery stock: only dying refills.
  collapse(state, false, lost);
  return {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: true,
    abandoned: true,
    lost,
  };
}

/**
 * Rows the elevator travels per ride action (REQ-028, user-directed
 * 2026-06-16: "I do not want it to be instant. Start a little faster than
 * taking stairs straight down, then upgrade so the speed picks up faster
 * and faster and greater distances"). Stairs move one row per dig, so the
 * base car covers six; each Elevator Speed level accelerates (~1.6x + 2),
 * so a 1000-row rail clears in just a few steps at the top. Integer and
 * transcendental-free so the server replay agrees.
 */
export function elevatorSpeedRows(gear: MineGear): number {
  const level = Math.max(1, gear.elevatorSpeed ?? 1);
  let rows = 6;
  for (let i = 1; i < level; i++) rows = Math.floor(rows * 1.6) + 2;
  return rows;
}

/**
 * The elevator (REQ-028): logged rides along the elevator column,
 * a fixed number of rows per ride (see elevatorSpeedRows). Ride-down
 * bores the rail span clear on the way (the crew built the shaft; anything
 * inside was milled, no loot) and stops at the owned depth; ride-up lifts
 * toward the surface and banks the carry once it lands. No energy: the rail
 * is the investment paying out. Ride again to keep travelling.
 */
function rideElevator(state: MineState, dir: "down" | "up"): MoveResult {
  const miner = state.miner;
  const rail = Math.min(state.gear.elevator, MINE_BOTTOM_ROW - 1);
  if (rail <= 0) return { ok: false, reason: "no-elevator" };
  const step = elevatorSpeedRows(state.gear);
  if (dir === "down") {
    if (miner.col !== ELEVATOR_COL || miner.row < 0 || miner.row >= rail)
      return { ok: false, reason: "blocked" };
    const target = Math.min(rail, miner.row + step);
    const emptied: Array<{ col: number; row: number }> = [];
    for (let r = miner.row + 1; r <= target; r++) {
      const cell = cellAt(state, ELEVATOR_COL, r);
      if (cell && cell.kind !== "empty") {
        setCell(state, ELEVATOR_COL, r, { kind: "empty" });
        emptied.push({ col: ELEVATOR_COL, row: r });
      }
    }
    miner.row = target;
    if (miner.row > miner.maxDepth) miner.maxDepth = miner.row;
    const fallEmptied: Array<{ col: number; row: number }> = [];
    const fallTick = tickFalls(state, fallEmptied);
    const settled = settleAfterEmptied(state, emptied, fallEmptied);
    if (fallTick.crushed) {
      const lost = minerLostCargo(miner, fallTick.crushRest);
      collapse(state, true, lost);
      return {
        ok: true,
        dug: null,
        dugOre: null,
        found: null,
        collapsed: true,
        crushed: true,
        fallingRockTriggered: settled.fallingRockTriggered || undefined,
        fallingRockWarnings: warningCellsOrUndefined(
          settled.fallingRockWarnings,
        ),
        ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
        lost,
      };
    }
    return {
      ok: true,
      dug: null,
      dugOre: null,
      found: null,
      collapsed: false,
      fallingRockTriggered: settled.fallingRockTriggered || undefined,
      fallingRockWarnings: warningCellsOrUndefined(settled.fallingRockWarnings),
      ladderFalls: ladderFallsOrUndefined(settled.ladderFalls),
    };
  }
  if (miner.col !== ELEVATOR_COL || miner.row < 1 || miner.row > rail)
    return { ok: false, reason: "blocked" };
  miner.row = Math.max(0, miner.row - step);
  // Banking happens topside: a partial ride up just travels.
  if (miner.row === 0) bank(miner, state.gear);
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

export interface PlacedBeacon {
  col: number;
  row: number;
  order: number;
  inRange: boolean;
  label: string | null;
}

export interface PlacedPortalBeacon extends BiomePortalDef {
  active: boolean;
}

export function countPlacedBeaconsInDiff(diff: WorldDiff | undefined): number {
  let count = 0;
  for (const [, row, cell] of diff ?? []) {
    if (row >= MINE_BOTTOM_ROW) continue;
    if (cell.beacon) count++;
  }
  return count;
}

export function countActiveBiomePortalsInDiff(
  diff: WorldDiff | undefined,
): number {
  const active = new Set<PortalBeaconId>();
  for (const [col, row, cell] of diff ?? []) {
    const portal = authoredPortalAt(col, row);
    if (portal && cell.portal === portal.id && cell.portalActive === true) {
      active.add(portal.id);
    }
  }
  return active.size;
}

function maxBeaconOrder(state: MineState): number {
  let order = 0;
  for (const cell of state.cells.values()) {
    if (
      cell.beacon &&
      Number.isSafeInteger(cell.beaconOrder) &&
      (cell.beaconOrder ?? 0) > order
    )
      order = cell.beaconOrder ?? 0;
  }
  return order;
}

/** Locate placed beacons in newest-first order. */
export function findBeacons(state: MineState): PlacedBeacon[] {
  const range = warpRange(state.gear);
  const beacons: PlacedBeacon[] = [];
  for (const [key, cell] of state.cells) {
    if (!cell.beacon) continue;
    const [col, row] = key.split(",").map(Number);
    if (row >= MINE_BOTTOM_ROW) continue;
    const order = Number.isSafeInteger(cell.beaconOrder)
      ? (cell.beaconOrder ?? 0)
      : 0;
    beacons.push({
      col,
      row,
      order,
      inRange: row <= range,
      label:
        typeof cell.beaconLabel === "string"
          ? normalizeBeaconLabel(cell.beaconLabel) || null
          : null,
    });
  }
  beacons.sort((a, b) => b.order - a.order || b.row - a.row || b.col - a.col);
  return beacons;
}

/** Locate the newest placed beacon in the world diff, if any. */
export function findBeacon(
  state: MineState,
): { col: number; row: number } | null {
  const [beacon] = findBeacons(state);
  return beacon ? { col: beacon.col, row: beacon.row } : null;
}

export function isPortalActive(state: MineState, id: PortalBeaconId): boolean {
  const portal = portalDef(id);
  const cell = cellAt(state, portal.col, portal.row);
  return cell?.portal === id && cell.portalActive === true;
}

export function findPortalBeacons(state: MineState): PlacedPortalBeacon[] {
  return BIOME_PORTALS.map((portal) => ({
    ...portal,
    active: isPortalActive(state, portal.id),
  }));
}

export function activePortalAt(
  state: MineState,
  col: number,
  row: number,
): PlacedPortalBeacon | null {
  const portal = authoredPortalAt(col, row);
  if (!portal || !isPortalActive(state, portal.id)) return null;
  return { ...portal, active: true };
}

/**
 * The teleporter (REQ-029): beacon kits plant persistent anchors in
 * conquered space. The village warp pad jumps to a chosen beacon, and
 * any beacon returns the miner home while its depth is within range.
 * All logged, all free of energy: the late game compresses conquered
 * space, never unconquered space.
 */
function placeBeacon(state: MineState): MoveResult {
  const miner = state.miner;
  if (miner.row < 1) return { ok: false, reason: "surface" };
  if (miner.row >= MINE_BOTTOM_ROW) return { ok: false, reason: "blocked" };
  if (miner.row > warpRange(state.gear))
    return { ok: false, reason: "out-of-range" };
  if (state.consumables.beacon <= 0) return { ok: false, reason: "no-beacon" };
  const cell = cellMut(state, miner.col, miner.row);
  if (cell.beacon) return { ok: false, reason: "blocked" };
  state.consumables.beacon--;
  state.used.beacon++;
  cell.beacon = true;
  cell.beaconOrder = maxBeaconOrder(state) + 1;
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

function activatePortal(state: MineState, id: PortalBeaconId): MoveResult {
  const portal = portalDef(id);
  const miner = state.miner;
  if (miner.row !== portal.row || miner.col !== portal.col)
    return { ok: false, reason: "blocked" };
  const cell = cellMut(state, portal.col, portal.row);
  cell.kind = "empty";
  cell.portal = id;
  cell.portalActive = true;
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

function canUsePortalNetwork(state: MineState): boolean {
  const miner = state.miner;
  if (miner.row !== 0) return false;
  return (
    miner.col === WARP_PAD_COL ||
    activePortalAt(state, miner.col, miner.row) !== null
  );
}

function portalWarp(state: MineState, target: PortalTargetId): MoveResult {
  const miner = state.miner;
  if (!canUsePortalNetwork(state)) return { ok: false, reason: "blocked" };
  if (target === "base") {
    miner.col = START_COL;
    miner.row = 0;
    bank(miner, state.gear);
    return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
  }
  const portal = portalDef(target);
  if (!isPortalActive(state, target)) return { ok: false, reason: "no-beacon" };
  miner.col = portal.col;
  miner.row = portal.row;
  bank(miner, state.gear);
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

function warpHome(state: MineState): MoveResult {
  const miner = state.miner;
  const here = cellAt(state, miner.col, miner.row);
  if (!here?.beacon) return { ok: false, reason: "blocked" };
  if (miner.row > warpRange(state.gear))
    return { ok: false, reason: "out-of-range" };
  miner.col = WARP_PAD_COL;
  miner.row = 0;
  bank(miner, state.gear);
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

function warpDown(
  state: MineState,
  target: { col: number; row: number },
): MoveResult {
  const miner = state.miner;
  if (miner.row !== 0 || miner.col !== WARP_PAD_COL)
    return { ok: false, reason: "blocked" };
  if (target.row >= MINE_BOTTOM_ROW) return { ok: false, reason: "blocked" };
  const cell = cellAt(state, target.col, target.row);
  if (!cell?.beacon) return { ok: false, reason: "no-beacon" };
  if (target.row > warpRange(state.gear))
    return { ok: false, reason: "out-of-range" };
  miner.col = target.col;
  miner.row = target.row;
  if (miner.row > miner.maxDepth) miner.maxDepth = miner.row;
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

function warpToNewestBeacon(state: MineState): MoveResult {
  const beacons = findBeacons(state);
  const beacon = beacons.find((candidate) => candidate.inRange);
  if (!beacon) {
    return beacons.length > 0
      ? { ok: false, reason: "out-of-range" }
      : { ok: false, reason: "no-beacon" };
  }
  return warpDown(state, beacon);
}

function renameBeacon(
  state: MineState,
  target: { col: number; row: number; label: string },
): MoveResult {
  const miner = state.miner;
  if (miner.row !== 0 || miner.col !== WARP_PAD_COL)
    return { ok: false, reason: "blocked" };
  if (!cellAt(state, target.col, target.row)?.beacon)
    return { ok: false, reason: "no-beacon" };
  const cell = cellMut(state, target.col, target.row);
  const label = normalizeBeaconLabel(target.label);
  cell.beaconLabel = label || undefined;
  return { ok: true, dug: null, dugOre: null, found: null, collapsed: false };
}

function dropOreFromBag(
  state: MineState,
  pile: Partial<Record<OreId, number>>,
): MoveResult {
  const miner = state.miner;
  if (miner.row < 1) return { ok: false, reason: "surface" };
  const dropped: Partial<Record<OreId, number>> = {};
  for (const ore of ORES) {
    const requested = pile[ore.id] ?? 0;
    if (requested <= 0) continue;
    const carried = miner.carried[ore.id] ?? 0;
    const count = Math.min(carried, requested);
    if (count <= 0) continue;
    const remaining = carried - count;
    if (remaining > 0) miner.carried[ore.id] = remaining;
    else delete miner.carried[ore.id];
    dropped[ore.id] = count;
  }
  const amount = orePileCount(dropped);
  if (amount <= 0) return { ok: false, reason: "blocked" };
  const cell = cellMut(state, miner.col, miner.row);
  cell.drop = mergeOrePiles(cell.drop, dropped);
  cell.dropDeferred = mergeOrePiles(cell.dropDeferred, dropped);
  return {
    ok: true,
    dug: null,
    dugOre: null,
    found: null,
    collapsed: false,
    droppedFromBag: amount,
  };
}

/**
 * Dispatches any logged trip action (Q-006 default B).
 *
 * Finalization contract:
 * - Directional movement and digs are full mine turns: they clear jump hover,
 *   tick falling rocks, settle changed supports, settle the miner, and may
 *   detonate a planted charge once the miner has moved clear.
 * - Explicit stationary support actions use finishStationaryAction so support
 *   salvage, support placement, and plank breaking follow the same turn
 *   finalization without moving the miner.
 * - Dynamite placement has its own delayed-charge contract: planting spends
 *   stock and settles hazards, while a later successful finalized action
 *   detonates after the miner leaves the charge.
 * - Recall, abandon, elevator up, warp, portal travel, beacon placement,
 *   beacon rename, and manual bag drops are direct trip-control actions. They
 *   intentionally do not run the generic stationary finalizer unless their
 *   handler explicitly does equivalent work.
 */
export function applyAction(state: MineState, action: MineAction): MoveResult {
  if (action.startsWith("collect:")) return collectPlaced(state, action);
  const droppedOre = parseDropOreAction(action);
  if (droppedOre) return dropOreFromBag(state, droppedOre);
  const portalActivation = parseActivatePortalAction(action);
  if (portalActivation) return activatePortal(state, portalActivation);
  const portalTarget = parsePortalWarpAction(action);
  if (portalTarget) return portalWarp(state, portalTarget);
  const warpTarget = parseWarpDownAction(action);
  if (warpTarget) return warpDown(state, warpTarget);
  const renameTarget = parseRenameBeaconAction(action);
  if (renameTarget) return renameBeacon(state, renameTarget);
  switch (action) {
    case "down":
    case "up":
    case "left":
    case "right":
      return step(state, action);
    case "dynamite-1":
      return plantDynamite(state, 1);
    case "dynamite-2":
      return plantDynamite(state, 2);
    case "dynamite-3":
      return plantDynamite(state, 3);
    case "dynamite-4":
      return plantDynamite(state, 4);
    case "plank-left":
      return placePlank(state, "left");
    case "plank-right":
      return placePlank(state, "right");
    case "jump":
      return jumpJets(state);
    case "recall":
      return recall(state);
    case "abandon":
      return abandon(state);
    case "ride-down":
      return rideElevator(state, "down");
    case "ride-up":
      return rideElevator(state, "up");
    case "place-beacon":
      return placeBeacon(state);
    case "collect-ladder":
      return collectLadder(state);
    case "warp-home":
      return warpHome(state);
    case "warp-down":
      return warpToNewestBeacon(state);
  }
  return { ok: false, reason: "blocked" };
}

function bank(miner: MinerState, gear: MineGear): void {
  const totalVibes = carriedValue(miner);
  miner.lastSoldHaul = {
    ores: { ...miner.carried },
    salvageCredits: miner.carriedSalvageCredits,
    totalVibes,
  };
  miner.bankedCredits += totalVibes;
  miner.bankedParts.push(...miner.carriedParts);
  miner.carried = {};
  miner.carriedSalvageCredits = 0;
  miner.carriedParts = [];
  miner.lostCargo = undefined;
  miner.energy = maxEnergy(gear);
}

/** Battery dead underground: cargo drops, and the crew hauls you up. */
/**
 * End the trip the hard way: drop the carry, haul up to the surface,
 * recharge the robot. `recover` marks a death (battery out or crushed) rather
 * than a chosen give-up: a death tops the ladder/plank stock back up to
 * the recovery floor for free so the miner is never stranded, while
 * abandoning grants nothing. Granting is deterministic, so the server
 * replay agrees and the cash-out math forgives exactly what was given.
 */
function collapse(
  state: MineState,
  recover: boolean,
  lost?: { value: number; parts: string[]; col: number; row: number },
): void {
  const miner = state.miner;
  state.pendingDynamite = undefined;
  dropBagAt(state, lost ?? miner, droppedBagFromMiner(miner));
  if (lost && (lost.value > 0 || lost.parts.length > 0)) {
    miner.lostCargo = { ...lost, parts: [...lost.parts] };
  }
  miner.carried = {};
  miner.carriedSalvageCredits = 0;
  miner.carriedParts = [];
  miner.lastSoldHaul = undefined;
  miner.collapses += 1;
  miner.col = START_COL;
  miner.row = 0;
  miner.energy = maxEnergy(state.gear);
  if (recover) {
    grantRecovery(state, "ladder", LADDER_RECOVERY_FLOOR);
    grantRecovery(state, "plank", PLANK_RECOVERY_FLOOR);
  }
}

/** Top one consumable up TO the floor, recording the free grant. */
function grantRecovery(
  state: MineState,
  item: "ladder" | "plank",
  floor: number,
): void {
  const add = Math.max(0, floor - state.consumables[item]);
  state.consumables[item] += add;
  state.granted[item] += add;
}

/** Grid distance used by the lantern cone below and beside the miner. */
export function lanternDistance(
  state: MineState,
  col: number,
  row: number,
): number {
  return Math.max(
    Math.abs(col - state.miner.col),
    Math.max(0, row - state.miner.row),
  );
}

/** A cell is visible when within lantern reach of the miner's cell. */
export function isVisible(state: MineState, col: number, row: number): boolean {
  return lanternDistance(state, col, row) <= lightRadius(state.gear);
}

/** Hard cap on submitted move logs (server replay cost control). */
export const MAX_TRIP_MOVES = 5000;

export interface TripResult {
  bankedCredits: number;
  bankedParts: string[];
  soldHaul?: SoldHaul;
  /** Deepest row reached for the persisted profile record. */
  maxDepth: number;
  moves: number;
  /** Successful manual bag-drop actions. */
  bagDrops: number;
  /** Condemned roofs re-propped before they fell (rescue events). */
  roofRescues: number;
  /** Span collapses that landed nearby while the miner lived. */
  collapsesSurvived: number;
  /** Consumables spent (server decrements at cash-out). */
  used: MineConsumables;
  /** Free recovery stock granted by deaths: forgiven at cash-out. */
  granted: MineConsumables;
  /** The world after the trip: persisted as the next checkpoint. */
  diff: WorldDiff;
}

/**
 * Replays a full action log from a seed, gear, and consumable snapshot
 * and returns what got banked. The server uses this to credit
 * cash-outs: the mine is a pure function of (seed, gear, consumables,
 * actions), so an honest client and the server always agree.
 */
export function replayTrip(
  seed: number,
  actions: MineAction[],
  gear: MineGear = DEFAULT_GEAR,
  consumables: MineConsumables = NO_CONSUMABLES,
  diff?: WorldDiff,
): TripResult {
  const state = createMine(seed, gear, consumables, diff);
  const capped = actions.slice(0, MAX_TRIP_MOVES);
  let bagDrops = 0;
  for (const action of capped) {
    const result = applyAction(state, action);
    if (result.ok && (result.droppedFromBag ?? 0) > 0) bagDrops++;
  }
  return {
    bankedCredits: state.miner.bankedCredits,
    bankedParts: [...state.miner.bankedParts],
    soldHaul: state.miner.lastSoldHaul
      ? {
          ores: { ...state.miner.lastSoldHaul.ores },
          salvageCredits: state.miner.lastSoldHaul.salvageCredits,
          totalVibes: state.miner.lastSoldHaul.totalVibes,
        }
      : undefined,
    maxDepth: state.miner.maxDepth,
    moves: capped.length,
    bagDrops,
    roofRescues: state.tripStats.roofRescues,
    collapsesSurvived: state.tripStats.collapsesSurvived,
    used: { ...state.used },
    granted: { ...state.granted },
    diff: exportDiff(state),
  };
}
