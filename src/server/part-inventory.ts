import { db } from "@/server/db";
import type { BotDesign } from "@/sim/design";
import {
  type PartInventoryRow,
  validateDesignInventory,
} from "@/sim/inventory";

export async function playerPartInventory(
  playerId: string,
): Promise<PartInventoryRow[]> {
  const sql = await db();
  return (await sql`
    SELECT part_id, count
    FROM player_parts
    WHERE player_id = ${playerId}`) as PartInventoryRow[];
}

export async function validatePlayerDesignInventory(
  playerId: string,
  design: BotDesign,
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const inventory = await playerPartInventory(playerId);
  return validateDesignInventory(design, inventory);
}
