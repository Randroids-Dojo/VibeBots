import type {
  DroppedBag,
  MineCell,
  MineCoord,
  MinerState,
  MineState,
} from "./cells";
import { BAG_STACK_LIMIT } from "./consumables";
import { cargoCapacity } from "./gear";
import { type OreId, oreDef } from "./ores";
import { cellAt, cellKey, cellMut } from "./world";

/** Credit value of everything currently carried (the bet on the table). */
export function carriedValue(miner: MinerState): number {
  let total = miner.carriedSalvageCredits;
  for (const [id, count] of Object.entries(miner.carried)) {
    total += oreDef(id as OreId).value * (count ?? 0);
  }
  return total;
}

/** Count of carried ore chunks (cargo, not value). */
export function carriedCount(miner: MinerState): number {
  let total = 0;
  for (const count of Object.values(miner.carried)) total += count ?? 0;
  return total;
}

function stackCountForOreCount(count: number): number {
  return Math.ceil(Math.max(0, count) / BAG_STACK_LIMIT);
}

/** Count of occupied carried ore stack slots. */
export function carriedStackCount(miner: MinerState): number {
  let total = 0;
  for (const count of Object.values(miner.carried)) {
    total += stackCountForOreCount(count ?? 0);
  }
  return total;
}

function stackRoomForOre(
  miner: MinerState,
  ore: OreId,
  slotCapacity: number,
): number {
  const carried = miner.carried[ore] ?? 0;
  const oreStacks = stackCountForOreCount(carried);
  const usedStacks = carriedStackCount(miner);
  const openSlots = Math.max(0, slotCapacity - usedStacks);
  const roomInExistingStacks =
    oreStacks > 0 ? oreStacks * BAG_STACK_LIMIT - carried : 0;
  return roomInExistingStacks + openSlots * BAG_STACK_LIMIT;
}

/**
 * Pour an ore pile into the hold up to the cargo cap. Returns how many
 * chunks were taken and whatever overflowed (the caller decides where the
 * leftover lands). Shared by walk-over pickups and dynamite collection.
 * Each hold slot carries one resource type and stacks up to five chunks.
 */
export function fillHold(
  state: MineState,
  pile: Partial<Record<OreId, number>>,
): {
  taken: number;
  dropped: number;
  leftover: Partial<Record<OreId, number>>;
} {
  const miner = state.miner;
  const slotCapacity = cargoCapacity(state.gear);
  let taken = 0;
  let dropped = 0;
  const leftover: Partial<Record<OreId, number>> = {};
  for (const [id, n] of Object.entries(pile) as Array<[OreId, number]>) {
    const room = stackRoomForOre(miner, id, slotCapacity);
    const count = Math.max(0, Math.floor(n));
    const take = Math.min(count, room);
    if (take > 0) {
      miner.carried[id] = (miner.carried[id] ?? 0) + take;
      taken += take;
    }
    const spill = count - take;
    if (spill > 0) {
      leftover[id] = (leftover[id] ?? 0) + spill;
      dropped += spill;
    }
  }
  return { taken, dropped, leftover };
}

function subtractOrePiles(
  pile: Partial<Record<OreId, number>> | undefined,
  subtract: Partial<Record<OreId, number>> | undefined,
): Partial<Record<OreId, number>> {
  const next: Partial<Record<OreId, number>> = {};
  if (!pile) return next;
  for (const [id, count] of Object.entries(pile) as Array<[OreId, number]>) {
    const kept = Math.max(0, count - (subtract?.[id] ?? 0));
    if (kept > 0) next[id] = kept;
  }
  return next;
}

function intersectOrePiles(
  pile: Partial<Record<OreId, number>> | undefined,
  limit: Partial<Record<OreId, number>> | undefined,
): Partial<Record<OreId, number>> {
  const next: Partial<Record<OreId, number>> = {};
  if (!pile || !limit) return next;
  for (const [id, count] of Object.entries(pile) as Array<[OreId, number]>) {
    const kept = Math.min(count, limit[id] ?? 0);
    if (kept > 0) next[id] = kept;
  }
  return next;
}

function cleanOrePile(
  pile: Partial<Record<OreId, number>> | undefined,
): Partial<Record<OreId, number>> | undefined {
  if (!pile) return undefined;
  const next: Partial<Record<OreId, number>> = {};
  for (const [id, count] of Object.entries(pile) as Array<[OreId, number]>) {
    if (count > 0) next[id] = count;
  }
  return orePileCount(next) > 0 ? next : undefined;
}

export function orePileCount(
  pile: Partial<Record<OreId, number>> | undefined,
): number {
  let total = 0;
  if (!pile) return total;
  for (const count of Object.values(pile)) total += count ?? 0;
  return total;
}

export function mergeOrePiles(
  a: Partial<Record<OreId, number>> | undefined,
  b: Partial<Record<OreId, number>>,
): Partial<Record<OreId, number>> {
  const next: Partial<Record<OreId, number>> = { ...a };
  for (const [id, count] of Object.entries(b) as Array<[OreId, number]>) {
    if (count <= 0) continue;
    next[id] = (next[id] ?? 0) + count;
  }
  return next;
}

function fillHoldFromCellDrop(
  state: MineState,
  cell: MineCell,
): {
  taken: number;
  dropped: number;
  leftover: Partial<Record<OreId, number>>;
  deferredLeftover?: Partial<Record<OreId, number>>;
} {
  const deferred = cleanOrePile(
    intersectOrePiles(cell.drop, cell.dropDeferred),
  );
  if (!deferred) return fillHold(state, cell.drop ?? {});
  const immediate = subtractOrePiles(cell.drop, deferred);
  const immediateResult = fillHold(state, immediate);
  const deferredResult = fillHold(state, deferred);
  const leftover = mergeOrePiles(
    immediateResult.leftover,
    deferredResult.leftover,
  );
  return {
    taken: immediateResult.taken + deferredResult.taken,
    dropped: immediateResult.dropped + deferredResult.dropped,
    leftover,
    deferredLeftover: cleanOrePile(
      intersectOrePiles(deferredResult.leftover, deferred),
    ),
  };
}

export function bagValue(bag: DroppedBag): number {
  let total = bag.salvageCredits;
  for (const [id, count] of Object.entries(bag.ores) as Array<
    [OreId, number]
  >) {
    total += oreDef(id).value * count;
  }
  return total;
}

function bagHasContents(bag: DroppedBag): boolean {
  return (
    orePileCount(bag.ores) > 0 || bag.salvageCredits > 0 || bag.parts.length > 0
  );
}

export function droppedBagFromMiner(miner: MinerState): DroppedBag | undefined {
  const bag: DroppedBag = {
    ores: { ...miner.carried },
    salvageCredits: miner.carriedSalvageCredits,
    parts: [...miner.carriedParts],
  };
  return bagHasContents(bag) ? bag : undefined;
}

export function dropBagAt(
  state: MineState,
  location: MineCoord,
  bag: DroppedBag | undefined,
): void {
  if (!bag || location.row < 1) return;
  const cell = cellMut(state, location.col, location.row);
  const existing = cell.bag;
  cell.bag = existing
    ? {
        ores: mergeOrePiles(existing.ores, bag.ores),
        salvageCredits: existing.salvageCredits + bag.salvageCredits,
        parts: [...existing.parts, ...bag.parts],
      }
    : {
        ores: { ...bag.ores },
        salvageCredits: bag.salvageCredits,
        parts: [...bag.parts],
      };
}

export function dropBagToSurface(
  state: MineState,
  col: number,
  row: number,
  bag: DroppedBag,
): MineCoord {
  let rest = row;
  while (true) {
    const here = cellAt(state, col, rest);
    if (!here) break;
    if (here.kind !== "empty" || here.plank) break;
    const below = cellAt(state, col, rest + 1);
    if (below?.kind !== "empty" || below?.ladder) break;
    rest++;
  }
  const landing = { col, row: rest };
  dropBagAt(state, landing, bag);
  return landing;
}

export function dropOreToSurface(
  state: MineState,
  col: number,
  row: number,
  pile: Partial<Record<OreId, number>>,
  deferred?: Partial<Record<OreId, number>>,
): number {
  const amount = orePileCount(pile);
  if (amount <= 0) return 0;
  let rest = row;
  while (true) {
    const here = cellAt(state, col, rest);
    if (!here) break;
    if (here.kind !== "empty" || here.plank) break;
    const below = cellAt(state, col, rest + 1);
    if (below?.kind !== "empty") break;
    rest++;
  }
  const landing = cellMut(state, col, rest);
  landing.drop = mergeOrePiles(landing.drop, pile);
  const cleanDeferred = cleanOrePile(deferred);
  if (cleanDeferred) {
    landing.dropDeferred = mergeOrePiles(landing.dropDeferred, cleanDeferred);
  }
  return amount;
}

export function pickupAtMiner(state: MineState): {
  pickedUp?: number;
  pickedUpBag?: { value: number; parts: number };
} {
  const miner = state.miner;
  if (miner.row < 1) return {};
  const here = state.cells.get(cellKey(miner.col, miner.row));
  let pickedUp: number | undefined;
  let pickedUpBag: { value: number; parts: number } | undefined;
  if (here?.drop) {
    const { taken, dropped, leftover, deferredLeftover } = fillHoldFromCellDrop(
      state,
      here,
    );
    if (dropped > 0) here.drop = leftover;
    else delete here.drop;
    if (deferredLeftover) here.dropDeferred = deferredLeftover;
    else delete here.dropDeferred;
    if (taken > 0) pickedUp = taken;
  }
  if (here?.bag) {
    const startingBag = here.bag;
    const startingValue = bagValue(startingBag);
    const startingParts = startingBag.parts.length;
    const {
      taken,
      dropped: leftoverCount,
      leftover,
    } = fillHold(state, startingBag.ores);
    if (startingBag.salvageCredits > 0) {
      miner.carriedSalvageCredits += startingBag.salvageCredits;
    }
    if (startingParts > 0) miner.carriedParts.push(...startingBag.parts);
    const leftoverBag: DroppedBag = {
      ores: leftover,
      salvageCredits: 0,
      parts: [],
    };
    if (leftoverCount > 0) here.bag = leftoverBag;
    else delete here.bag;
    if (taken > 0) pickedUp = (pickedUp ?? 0) + taken;
    const recoveredValue = startingValue - bagValue(leftoverBag);
    if (recoveredValue > 0 || startingParts > 0) {
      pickedUpBag = { value: recoveredValue, parts: startingParts };
    }
    if (
      !here.bag &&
      miner.lostCargo?.col === miner.col &&
      miner.lostCargo.row === miner.row
    ) {
      miner.lostCargo = undefined;
    }
  }
  return { pickedUp, pickedUpBag };
}
