import { z } from "zod";
import {
  operationResultResponse,
  withPlayerJsonRoute,
} from "@/server/api-boundary";
import { resolveLiveRaid } from "@/server/bunker";
import type { LiveRaidOutcomeReport } from "@/sim/bunker-raid-live";

export const runtime = "nodejs";

// The bounded outcome a client reports after running a live raid (Q-024
// option D). The server settles it against the frozen start snapshot, which
// is the real bound on trust; the schema only shapes the payload and caps its
// size. The full 7x5x5 volume is 175 cells, so 200 comfortably bounds part wear.
const bodySchema = z.object({
  version: z.number().int(),
  raidId: z.string().max(64),
  outcome: z.enum(["won", "lost"]),
  minerKilled: z.boolean(),
  sealed: z.boolean(),
  endedTick: z.number().int().min(0),
  clankersKilled: z.number().int().min(0),
  defenseXp: z.number().int().min(0),
  partWear: z
    .array(
      z.object({
        partId: z.string().max(40),
        col: z.number().int(),
        row: z.number().int(),
        depth: z.number().int(),
        durability: z.number().int().min(0),
        // Thin sub-cell slot (F-117). Absent on legacy full-cell parts. The
        // snapshot identity match in settleLiveRaidOutcome is the real bound,
        // so this only needs to preserve the slot the client observed.
        slot: z.string().max(16).optional(),
      }),
    )
    .max(200),
});

export async function POST(request: Request): Promise<Response> {
  return withPlayerJsonRoute(
    request,
    bodySchema,
    async ({ sql, playerId }, body) =>
      operationResultResponse(
        await resolveLiveRaid(sql, playerId, body as LiveRaidOutcomeReport),
        (result) => ({
          ...result.view,
          reward: result.reward,
          // Stamps ride the top-level channel like every other award route.
          newStamps: result.reward.newStamps,
        }),
      ),
  );
}
