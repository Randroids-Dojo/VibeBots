import {
  operationResultResponse,
  withPlayerRoute,
} from "@/server/api-boundary";
import { finishBunkerRaid } from "@/server/bunker";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  return withPlayerRoute(async ({ sql, playerId }) =>
    operationResultResponse(
      await finishBunkerRaid(sql, playerId),
      (result) => ({
        ...result.view,
        raid: result.raid,
        reward: result.reward,
      }),
    ),
  );
}
