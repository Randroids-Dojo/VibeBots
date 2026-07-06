export function accountJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export function storageUnavailable(): Response {
  return accountJson({ error: "storage not configured" }, { status: 503 });
}
