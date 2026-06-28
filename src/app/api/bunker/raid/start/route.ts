import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { startBunkerRaid } from "@/server/bunker";

export const runtime = "nodejs";

const bodySchema = z.object({
  tier: z.number().int().min(1).max(1).optional().default(1),
});

export async function POST(request: Request): Promise<Response> {
  return withPlayerJsonRoute(
    request,
    bodySchema,
    async ({ sql, playerId }, body) =>
      operationResultResponse(
        await startBunkerRaid(sql, playerId, body.tier),
        (result) => ({ ...result.view, raid: result.raid }),
      ),
  );
}
