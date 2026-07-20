import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { excavateBunker } from "@/server/bunker";
import { BUNKER_CLAIM_DEPTH } from "@/sim/bunker";

export const runtime = "nodejs";

const bodySchema = z.object({
  col: z.number().int(),
  row: z.number().int().min(1),
  // Every cell is solid claim rock at claim (F-115), including the
  // depth-0 floor plane, so any depth in range can be dug.
  depth: z
    .number()
    .int()
    .min(0)
    .max(BUNKER_CLAIM_DEPTH - 1),
  expectedRevision: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request): Promise<Response> {
  return withPlayerJsonRoute(
    request,
    bodySchema,
    async ({ sql, playerId }, body) =>
      operationResultResponse(
        await excavateBunker(
          sql,
          playerId,
          body.col,
          body.row,
          body.depth,
          body.expectedRevision,
        ),
        (result) => ({
          ...result.view,
          newStamps: result.newStamps,
          oreDrop: result.oreDrop,
        }),
      ),
  );
}
