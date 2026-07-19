import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { placeBunkerPart } from "@/server/bunker";
import {
  BASE_PART_IDS,
  BUNKER_CLAIM_DEPTH,
  BUNKER_SLOTS,
  bunkerOrientationSchema,
} from "@/sim/bunker";

export const runtime = "nodejs";

const bodySchema = z.object({
  partId: z.enum(BASE_PART_IDS),
  col: z.number().int(),
  row: z.number().int().min(1),
  depth: z
    .number()
    .int()
    .min(0)
    .max(BUNKER_CLAIM_DEPTH - 1)
    .default(0),
  // Thin sub-cell slot (F-117). Absent for a legacy whole-cell placement; the
  // sim enforces which slots each part may occupy and the structural rules.
  slot: z.enum(BUNKER_SLOTS).optional(),
  // Facing for a rotatable part (F-117 stair), as quarter turns 0-3. Absent
  // on every fixed-orientation part; the sim only records it where used.
  orientation: bunkerOrientationSchema.optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request): Promise<Response> {
  return withPlayerJsonRoute(
    request,
    bodySchema,
    async ({ sql, playerId }, body) =>
      operationResultResponse(
        await placeBunkerPart(
          sql,
          playerId,
          body.partId,
          body.col,
          body.row,
          body.depth,
          body.slot,
          body.orientation,
          body.expectedRevision,
        ),
        (result) => result.view,
      ),
  );
}
