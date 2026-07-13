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
  // Depth 0 is the open claim plane; only interior rock can be dug.
  depth: z
    .number()
    .int()
    .min(1)
    .max(BUNKER_CLAIM_DEPTH - 1),
});

export async function POST(request: Request): Promise<Response> {
  return withPlayerJsonRoute(
    request,
    bodySchema,
    async ({ sql, playerId }, body) =>
      operationResultResponse(
        await excavateBunker(sql, playerId, body.col, body.row, body.depth),
        (result) => result.view,
      ),
  );
}
