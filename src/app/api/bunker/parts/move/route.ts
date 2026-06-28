import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { moveBunkerPart } from "@/server/bunker";

export const runtime = "nodejs";

const bodySchema = z.object({
  fromCol: z.number().int(),
  fromRow: z.number().int().min(1),
  toCol: z.number().int(),
  toRow: z.number().int().min(1),
});

export async function POST(request: Request): Promise<Response> {
  return withPlayerJsonRoute(
    request,
    bodySchema,
    async ({ sql, playerId }, body) =>
      operationResultResponse(
        await moveBunkerPart(
          sql,
          playerId,
          body.fromCol,
          body.fromRow,
          body.toCol,
          body.toRow,
        ),
        (result) => result.view,
      ),
  );
}
