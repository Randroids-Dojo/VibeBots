import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { buyBasePart } from "@/server/bunker";
import { BASE_PART_IDS } from "@/sim/bunker";

export const runtime = "nodejs";

const bodySchema = z.object({
  partId: z.enum(BASE_PART_IDS),
  quantity: z.number().int().min(1).max(99).optional().default(1),
});

export async function POST(request: Request): Promise<Response> {
  return withPlayerJsonRoute(
    request,
    bodySchema,
    async ({ sql, playerId }, body) =>
      operationResultResponse(
        await buyBasePart(sql, playerId, body.partId, body.quantity),
        (result) => result.view,
      ),
  );
}
