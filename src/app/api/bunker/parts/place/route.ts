import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { placeBunkerPart } from "@/server/bunker";
import { BASE_PART_IDS } from "@/sim/bunker";

export const runtime = "nodejs";

const bodySchema = z.object({
  partId: z.enum(BASE_PART_IDS),
  col: z.number().int(),
  row: z.number().int().min(1),
});

export async function POST(request: Request): Promise<Response> {
  return withPlayerJsonRoute(
    request,
    bodySchema,
    async ({ sql, playerId }, body) =>
      operationResultResponse(
        await placeBunkerPart(sql, playerId, body.partId, body.col, body.row),
        (result) => result.view,
      ),
  );
}
