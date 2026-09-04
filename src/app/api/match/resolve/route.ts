import { z } from "zod";
import { refreshPlayerAchievements } from "@/server/achievements";
import { db, storageConfigured } from "@/server/db";
import {
  loadMatchRecordSummary,
  type MatchRecordSummary,
  recordMatchResult,
} from "@/server/match-records";
import { validatePlayerDesignInventory } from "@/server/part-inventory";
import { getOrCreatePlayerId } from "@/server/player";
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
  /**
   * Workshop verification can ask the server to enforce inventory on the
   * current player's design. The CPU opponent is not owned by the player.
   */
  enforceInventory: z.boolean().optional(),
  inventoryDesignIndex: z.union([z.literal(0), z.literal(1)]).optional(),
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
  if (parsed.data.enforceInventory) {
    if (!storageConfigured()) {
      return Response.json(
        { error: "storage not configured" },
        { status: 503 },
      );
    }
    const playerId = await getOrCreatePlayerId();
    const designIndex = parsed.data.inventoryDesignIndex ?? 0;
    const inventoryValidation = await validatePlayerDesignInventory(
      playerId,
      parsed.data.designs[designIndex],
    );
    if (!inventoryValidation.ok) {
      return Response.json(
        {
          error: "design uses unowned parts",
          design: parsed.data.designs[designIndex].name,
          issues: inventoryValidation.errors,
        },
        { status: 422 },
      );
    }
  }
  // Telemetry on (F-239): post-match damage attribution is a match fact,
  // so the authoritative rerun states it rather than leaving the player's
  // teardown entirely client-authored. Recording is bounded and trivial
  // next to the 3600 physics steps the rerun already pays for.
  const result = await resolveMatch(
    parsed.data.designs,
    parsed.data.timeLimitTicks,
    { telemetry: true },
  );
  // Verified player fights become durable records (B4): the workshop
  // record chip and the battle stamps read from them. Exhibition and
  // anonymous resolves persist nothing.
  let record: MatchRecordSummary | null = null;
  let newStamps: string[] = [];
  if (parsed.data.enforceInventory && storageConfigured()) {
    const sql = await db();
    const playerId = await getOrCreatePlayerId();
    const playerIndex = parsed.data.inventoryDesignIndex ?? 0;
    const playerDesign = parsed.data.designs[playerIndex];
    const opponent = parsed.data.designs[1 - playerIndex];
    const winner = result.status.over ? result.status.winner : null;
    await recordMatchResult(sql, playerId, {
      botName: playerDesign.name,
      opponentName: opponent.name,
      outcome:
        winner === null ? "draw" : winner === playerIndex ? "win" : "loss",
      resultHash: result.hash,
      simVersion: result.simVersion,
      durationTicks: result.tick,
      usedPartIds: [...new Set(playerDesign.parts.map((p) => p.partId))],
      ruleCount: playerDesign.rules?.length ?? 0,
    });
    try {
      newStamps = (await refreshPlayerAchievements(sql, playerId))
        .newlyUnlocked;
    } catch {
      // Stamps are cosmetic and must never fail an already-recorded match.
    }
    record = await loadMatchRecordSummary(sql, playerId);
  }
  return Response.json({ ...result, record, newStamps });
}
