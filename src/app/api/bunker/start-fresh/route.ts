import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { startFreshBunker } from "@/server/bunker";

export const runtime = "nodejs";

const bodySchema = z.object({});

export async function POST(request: Request): Promise<Response> {
  return withPlayerJsonRoute(request, bodySchema, async ({ sql, playerId }) =>
    operationResultResponse(
      await startFreshBunker(sql, playerId),
      (result) => result.view,
    ),
  );
}
