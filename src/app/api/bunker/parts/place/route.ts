import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { placeBunkerPart } from "@/server/bunker";
import { BASE_PART_IDS, BUNKER_CLAIM_DEPTH } from "@/sim/bunker";

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
        ),
        (result) => result.view,
      ),
  );
}
