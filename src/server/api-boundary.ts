import type { z } from "zod";
import { storageUnavailable } from "./account-response";
import { db, storageConfigured } from "./db";
import { getOrCreatePlayerId } from "./player";

type Sql = Awaited<ReturnType<typeof db>>;

export interface PlayerRouteContext {
  sql: Sql;
  playerId: string;
}

type OperationResult<T extends object> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string };

interface JsonRouteOptions {
  invalidJsonError?: string;
  validationError?: string;
}

function unavailableStorageResponse(): Response | null {
  return storageConfigured() ? null : storageUnavailable();
}

async function loadPlayerRouteContext(): Promise<PlayerRouteContext> {
  const playerId = await getOrCreatePlayerId();
  const sql = await db();
  return { sql, playerId };
}

export async function withPlayerRoute(
  handler: (context: PlayerRouteContext) => Promise<Response>,
): Promise<Response> {
  const unavailable = unavailableStorageResponse();
  if (unavailable) return unavailable;
  const context = await loadPlayerRouteContext();
  return handler(context);
}

export async function withPlayerJsonRoute<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  handler: (
    context: PlayerRouteContext,
    body: z.infer<TSchema>,
  ) => Promise<Response>,
  options: JsonRouteOptions = {},
): Promise<Response> {
  const unavailable = unavailableStorageResponse();
  if (unavailable) return unavailable;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: options.invalidJsonError ?? "invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: options.validationError ?? parsed.error.issues },
      { status: 400 },
    );
  }

  const context = await loadPlayerRouteContext();
  return handler(context, parsed.data);
}

export function operationResultResponse<T extends object>(
  result: OperationResult<T>,
  successProjector: (result: { ok: true } & T) => unknown,
): Response {
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(successProjector(result));
}
