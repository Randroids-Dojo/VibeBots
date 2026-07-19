import { z } from "zod";
import {
  BASE_PART_IDS,
  BUNKER_CLAIM_DEPTH,
  BUNKER_CLAIM_HEIGHT,
  BUNKER_CLAIM_WIDTH,
  BUNKER_SLOTS,
  type BunkerSkinId,
  type BunkerSlot,
  bunkerOrientationSchema,
  isBunkerOrientation,
  isBunkerSkinId,
} from "@/sim/bunker";
import { withSpawnPocket } from "@/sim/bunker-blocks";
import { maxGearLevel } from "@/sim/mine";

// Shared validation for mine trip gear and consumable snapshots. The bank route
// (authoritative cash-out) and the account trip checkpoint route both parse the
// same client-supplied trip payload, so the schema lives here to keep them in
// lockstep when gear tracks or consumables change.
const DB_INT_MAX = 2_147_483_647;
const MINE_COLUMN_LIMIT = 100_000;

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
  elevatorColumn: z
    .number()
    .int()
    .min(-MINE_COLUMN_LIMIT)
    .max(MINE_COLUMN_LIMIT)
    .nullable()
    .optional(),
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

// One bounded schema for the pending-bunker checkpoint (F-112). The account
// trip route, the trip-response reader, and local persistence all restore the
// same nested PendingBunkerBuild, so validating it in one place stops the old
// hand-rolled normalizer from throwing when it dereferenced malformed data
// (a `parts: [null]` element, out-of-range cells). Invalid input is rejected
// as a stable incompatible-state; legacy shapes coerce: a missing depth lands
// on the tunnel plane, a missing dug list is empty, and a legacy `core` field
// (F-118 removed the core) is silently dropped by the object strip.
const MAX_BUNKER_CELLS =
  BUNKER_CLAIM_WIDTH * BUNKER_CLAIM_HEIGHT * BUNKER_CLAIM_DEPTH;
// One part per cell, so the whole 7x5x5 volume is the cap. F-118 removed the
// core, so every cell is now buildable (the old cap of 174 reserved the core
// cell).
const BUNKER_PART_LIMIT = MAX_BUNKER_CELLS;
// Match the authoritative bank route's part bounds (min 1, max 1000): a placed
// part always has positive durability, and aligning avoids a checkpoint that
// resumes locally but is then rejected at bank.
const PART_DURABILITY_MIN = 1;
const PART_DURABILITY_MAX = 1000;

// A cell depth that must be present and in range (dug and loot cells always
// carry one). Corruption (missing, non-integer, out of range) is rejected.
const bunkerCellDepth = z
  .number()
  .int()
  .min(0)
  .max(BUNKER_CLAIM_DEPTH - 1);
// Parts predate the depth axis (F-115), so their depth is coerced onto the
// tunnel plane rather than rejected: a missing, non-integer, or out-of-range
// depth lands on 0, matching the legacy resume behavior.
const legacyPartDepth = z.preprocess(
  (value) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < BUNKER_CLAIM_DEPTH
      ? value
      : 0,
  bunkerCellDepth,
);

// Thin sub-cell slot (F-117). A saved trip from a build without slots, or a
// malformed value, coerces to undefined (a legacy whole-cell part) rather than
// rejecting the whole trip, mirroring `legacyPartDepth`.
const legacyPartSlot = z.preprocess(
  (value) =>
    typeof value === "string" &&
    (BUNKER_SLOTS as readonly string[]).includes(value)
      ? value
      : undefined,
  z.enum(BUNKER_SLOTS).optional() as z.ZodType<BunkerSlot | undefined>,
);

// Facing for a rotatable part (F-117 stair). A saved trip without an
// orientation, or a malformed value, coerces to undefined, mirroring
// `legacyPartSlot`.
const legacyPartOrientation = z.preprocess(
  (value) => (isBunkerOrientation(value) ? value : undefined),
  bunkerOrientationSchema.optional(),
);

const basePartIdSchema = z.enum(BASE_PART_IDS);
// Skins are purely cosmetic and re-derived server-side, so an unrecognized id
// (e.g. a trip saved by a newer build, loaded by an older one) coerces to the
// default rather than rejecting the whole trip.
const bunkerSkinIdSchema = z
  .custom<BunkerSkinId>((value) => isBunkerSkinId(value))
  .catch(undefined as unknown as BunkerSkinId);

const placedBasePartSchema = z.object({
  partId: basePartIdSchema,
  col: z.number().int(),
  row: z.number().int().min(1),
  depth: legacyPartDepth,
  slot: legacyPartSlot,
  orientation: legacyPartOrientation,
  durability: z
    .number()
    .int()
    .min(PART_DURABILITY_MIN)
    .max(PART_DURABILITY_MAX),
});

const dugBunkerCellSchema = z.object({
  col: z.number().int(),
  row: z.number().int().min(1),
  depth: bunkerCellDepth,
});

const bunkerFootprintSchema = z.object({
  col: z.number().int(),
  row: z.number().int().min(1),
  width: z.number().int().min(1).max(BUNKER_CLAIM_WIDTH),
  height: z.number().int().min(1).max(BUNKER_CLAIM_HEIGHT),
});

const bunkerLootSchema = z.object({
  col: z.number().int(),
  row: z.number().int().min(1),
  depth: bunkerCellDepth,
  ores: z.record(z.string(), z.number()),
});

// Inventory is a client hint the bank re-derives from the player row, so keep
// it lenient (any bounded count) but still reject a non-object.
const basePartInventorySchema = z.record(z.string(), z.number().int().min(0));

const bunkerStateSchema = z
  .object({
    footprint: bunkerFootprintSchema,
    parts: z.array(placedBasePartSchema).max(BUNKER_PART_LIMIT),
    dug: z.array(dugBunkerCellSchema).max(MAX_BUNKER_CELLS).default([]),
    blockSeed: z.number().int().optional(),
    loot: z.array(bunkerLootSchema).max(MAX_BUNKER_CELLS).optional(),
    skin: bunkerSkinIdSchema.optional(),
    skinsOwned: z.array(bunkerSkinIdSchema).optional(),
  })
  .transform((bunker) => ({
    ...bunker,
    // Seed the spawn pocket so a claim persisted before the dig-out redesign
    // (F-115) still opens into a walkable room rather than trapping the spawn.
    dug: withSpawnPocket(bunker.footprint, bunker.dug),
  }));

export const pendingBunkerBuildSchema = z.object({
  claimCol: z.number().int(),
  claimRow: z.number().int().min(1),
  claimedAtMoveCount: z.number().int().min(0),
  bunker: bunkerStateSchema,
  inventory: basePartInventorySchema,
});
