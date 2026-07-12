import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { setBunkerSkin } from "@/server/bunker";
import { BUNKER_SKIN_CATALOG, type BunkerSkinId } from "@/sim/bunker";

export const runtime = "nodejs";

const bodySchema = z.object({
  skinId: z.enum(
    Object.keys(BUNKER_SKIN_CATALOG) as [BunkerSkinId, ...BunkerSkinId[]],
  ),
});

export async function POST(request: Request): Promise<Response> {
  return withPlayerJsonRoute(
    request,
    bodySchema,
    async ({ sql, playerId }, body) =>
      operationResultResponse(
        await setBunkerSkin(sql, playerId, body.skinId),
        (result) => result.view,
      ),
  );
}
