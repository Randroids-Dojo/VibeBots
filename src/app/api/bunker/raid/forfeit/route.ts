import {
  operationResultResponse,
  withPlayerRoute,
} from "@/server/api-boundary";
import { forfeitLiveRaid } from "@/server/bunker";

export const runtime = "nodejs";

// Leaving the first-person view mid-raid forfeits the active live raid now
// (F-160), so it settles immediately instead of lingering until server
// expiry and cannot be re-rolled by re-entering. No body: the active row for
// the authenticated player is the target.
export async function POST(): Promise<Response> {
  return withPlayerRoute(async ({ sql, playerId }) =>
    operationResultResponse(
      await forfeitLiveRaid(sql, playerId),
      (result) => result.view,
    ),
  );
}
