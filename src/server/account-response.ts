export function accountJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export function storageUnavailable(): Response {
  return accountJson(
    { error: "storage not configured", code: "storage_not_configured" },
    { status: 503 },
  );
}

export function signInRequired(): Response {
  return accountJson(
    { error: "account sign-in required", code: "sign_in_required" },
    { status: 401 },
  );
}

export function guestSaveRequired(): Response {
  return accountJson(
    { error: "guest save required", code: "guest_save_required" },
    { status: 409 },
  );
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
