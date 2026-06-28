import { withPlayerRoute } from "@/server/api-boundary";
import { loadBunkerView } from "@/server/bunker";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return withPlayerRoute(async ({ sql, playerId }) =>
    Response.json(await loadBunkerView(sql, playerId)),
  );
}
