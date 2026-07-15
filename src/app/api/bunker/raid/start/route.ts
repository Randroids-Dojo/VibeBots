import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { startBunkerRaid, startLiveRaid } from "@/server/bunker";
import { BUNKER_RAID_TIER_CAP } from "@/sim/bunker";

export const runtime = "nodejs";

const bodySchema = z.object({
  tier: z.number().int().min(1).max(BUNKER_RAID_TIER_CAP).optional().default(1),
  // Opt-in to the live first-person raid (Q-024 option D). Defaults to the
  // interim server-resolved raid so existing clients keep working unchanged.
  mode: z.enum(["interim", "live"]).optional().default("interim"),
});

export async function POST(request: Request): Promise<Response> {
  return withPlayerJsonRoute(
    request,
    bodySchema,
    async ({ sql, playerId }, body) => {
      if (body.mode === "live") {
        return operationResultResponse(
          await startLiveRaid(sql, playerId, body.tier),
          (result) => ({ ...result.view, liveRaid: result.liveRaid }),
        );
      }
      return operationResultResponse(
        await startBunkerRaid(sql, playerId, body.tier),
        (result) => ({ ...result.view, raid: result.raid }),
      );
    },
  );
}
