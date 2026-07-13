import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { removeBunkerPart } from "@/server/bunker";
import { BUNKER_CLAIM_DEPTH } from "@/sim/bunker";

export const runtime = "nodejs";

const bodySchema = z.object({
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
        await removeBunkerPart(sql, playerId, body.col, body.row, body.depth),
        (result) => result.view,
      ),
  );
}
