import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { removeBunkerPart } from "@/server/bunker";

export const runtime = "nodejs";

const bodySchema = z.object({
  col: z.number().int(),
  row: z.number().int().min(1),
});

export async function POST(request: Request): Promise<Response> {
  return withPlayerJsonRoute(
    request,
    bodySchema,
    async ({ sql, playerId }, body) =>
      operationResultResponse(
        await removeBunkerPart(sql, playerId, body.col, body.row),
        (result) => result.view,
      ),
  );
}
