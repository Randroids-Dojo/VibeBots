export function accountJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export function storageUnavailable(): Response {
  return accountJson({ error: "storage not configured" }, { status: 503 });
}

/** Request body as an object, or null for invalid JSON / non-object bodies. */
export async function safeJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
