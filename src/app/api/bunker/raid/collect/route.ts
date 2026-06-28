import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { collectBunkerRaidPickup } from "@/server/bunker";

export const runtime = "nodejs";

const bodySchema = z.object({
  col: z.coerce.number().int(),
  row: z.coerce.number().int(),
});

export async function POST(request: Request): Promise<Response> {
  return withPlayerJsonRoute(
    request,
    bodySchema,
    async ({ sql, playerId }, body) =>
      operationResultResponse(
        await collectBunkerRaidPickup(sql, playerId, body.col, body.row),
        (result) => ({ ...result.view, raid: result.raid }),
      ),
    {
      invalidJsonError: "invalid pickup cell",
      validationError: "invalid pickup cell",
    },
  );
}
