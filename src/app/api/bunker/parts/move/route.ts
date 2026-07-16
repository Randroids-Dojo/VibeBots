import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { moveBunkerPart } from "@/server/bunker";
import { BUNKER_CLAIM_DEPTH } from "@/sim/bunker";

export const runtime = "nodejs";

const depthSchema = z
  .number()
  .int()
  .min(0)
  .max(BUNKER_CLAIM_DEPTH - 1)
  .default(0);

const bodySchema = z.object({
  fromCol: z.number().int(),
  fromRow: z.number().int().min(1),
  toCol: z.number().int(),
  toRow: z.number().int().min(1),
  fromDepth: depthSchema,
  toDepth: depthSchema,
  expectedRevision: z.number().int().nonnegative().optional(),
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
          body.fromDepth,
          body.toDepth,
          body.expectedRevision,
        ),
        (result) => result.view,
      ),
  );
}
