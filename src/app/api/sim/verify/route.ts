import { z } from "zod";
import { DEFAULT_STEPS } from "@/sim/constants";
import { runSim } from "@/sim/run";

export const runtime = "nodejs";
export const maxDuration = 60;

const querySchema = z.object({
  seed: z.coerce.number().int().min(0).max(4294967295).default(42),
  steps: z.coerce.number().int().min(1).max(36000).default(DEFAULT_STEPS),
});

/**
 * Reruns the deterministic sim server-side and returns its state hash.
 * Proof of the hybrid-authority architecture: for a given seed and step
 * count this hash must match what the browser computes locally.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues }, { status: 400 });
  }
  return Response.json(await runSim(parsed.data));
}
