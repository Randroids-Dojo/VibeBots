import type { BotDesign } from "./design";
import { PART_CATALOG, type PartDef } from "./parts";

export interface PartInventoryRow {
  part_id: string;
  count: number;
}

export function partInventoryCounts(
  inventory: readonly PartInventoryRow[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of inventory) {
    counts.set(row.part_id, Math.max(0, Math.floor(row.count)));
  }
  return counts;
}

export function designPartCounts(
  design: BotDesign,
  catalog: Record<string, PartDef> = PART_CATALOG,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const instance of design.parts) {
    const part = catalog[instance.partId];
    if (!part || part.category === "core") continue;
    counts.set(instance.partId, (counts.get(instance.partId) ?? 0) + 1);
  }
  return counts;
}

export function validateDesignInventory(
  design: BotDesign,
  inventory: readonly PartInventoryRow[],
  catalog: Record<string, PartDef> = PART_CATALOG,
): { ok: true } | { ok: false; errors: string[] } {
  const owned = partInventoryCounts(inventory);
  const used = designPartCounts(design, catalog);
  const errors: string[] = [];
  for (const [partId, usedCount] of used) {
    const part = catalog[partId];
    const ownedCount = owned.get(partId) ?? 0;
    if (ownedCount < usedCount) {
      errors.push(
        `${part?.name ?? partId}: uses ${usedCount}, owns ${ownedCount}`,
      );
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
