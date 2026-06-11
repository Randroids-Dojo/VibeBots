import { z } from "zod";
import { DEFAULT_TIME_LIMIT_TICKS } from "@/sim/combat";
import { SIM_VERSION } from "@/sim/constants";
import { botDesignSchema, validateDesign } from "@/sim/design";
import { resolveMatch } from "@/sim/resolve";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({
  designs: z.tuple([botDesignSchema, botDesignSchema]),
  /** Clients must simulate on the same sim version the server runs. */
  simVersion: z.number().int(),
  timeLimitTicks: z
    .number()
    .int()
    .min(60)
    .max(DEFAULT_TIME_LIMIT_TICKS)
    .optional(),
});

/**
 * The official match result (Q-003 hybrid authority): the server reruns
 * the deterministic sim and its answer is the one that counts. A client
 * that simulated the same designs on the same sim version gets the same
 * hash; a mismatch means a buggy or dishonest client.
 */
export async function POST(request: Request): Promise<Response> {
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(parsedBody);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  if (parsed.data.simVersion !== SIM_VERSION) {
    return Response.json(
      { error: "stale sim version", expected: SIM_VERSION },
      { status: 409 },
    );
  }
  for (const design of parsed.data.designs) {
    const validation = validateDesign(design);
    if (!validation.ok) {
      return Response.json(
        {
          error: "invalid design",
          design: design.name,
          issues: validation.errors,
        },
        { status: 422 },
      );
    }
  }
  const result = await resolveMatch(
    parsed.data.designs,
    parsed.data.timeLimitTicks,
  );
  return Response.json(result);
}
