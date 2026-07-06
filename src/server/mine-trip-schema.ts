import { z } from "zod";
import { maxGearLevel } from "@/sim/mine";

// Shared validation for mine trip gear and consumable snapshots. The bank route
// (authoritative cash-out) and the account trip checkpoint route both parse the
// same client-supplied trip payload, so the schema lives here to keep them in
// lockstep when gear tracks or consumables change.
const DB_INT_MAX = 2_147_483_647;

export const mineConsumableCount = z.number().int().min(0).max(DB_INT_MAX);

const gearLevel = (
  track:
    | "pickaxe"
    | "battery"
    | "cargo"
    | "lantern"
    | "warpcoil"
    | "blast"
    | "elevatorSpeed"
    | "fall"
    | "recall",
) => z.number().int().min(1).max(maxGearLevel(track));

export const mineGearSchema = z.object({
  pickaxe: gearLevel("pickaxe"),
  battery: gearLevel("battery").optional(),
  lamp: gearLevel("battery").optional(),
  cargo: gearLevel("cargo"),
  lantern: gearLevel("lantern"),
  elevator: z.number().int().min(0).max(100000),
  warpcoil: gearLevel("warpcoil"),
  blast: gearLevel("blast").optional(),
  elevatorSpeed: gearLevel("elevatorSpeed").optional(),
  fall: gearLevel("fall").optional(),
  recall: gearLevel("recall").optional(),
});

export const mineConsumablesSchema = z.object({
  dynamite: mineConsumableCount,
  rope: mineConsumableCount,
  ladder: mineConsumableCount,
  plank: mineConsumableCount,
  beacon: mineConsumableCount,
});
