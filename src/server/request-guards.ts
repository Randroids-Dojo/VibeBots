import { accountJson } from "./account-response";

const ACCOUNT_MUTATION_HEADER = "x-vibebots-account-mutation";
const ACCOUNT_MUTATION_HEADER_VALUE = "1";

export function sameOriginBrowserRequestAllowed(request: Request): boolean {
  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== requestOrigin) return false;
    } catch {
      return false;
    }
  }

  return request.headers.get("sec-fetch-site")?.toLowerCase() !== "cross-site";
}

function appAccountMutationHeaderPresent(request: Request): boolean {
  return (
    request.headers.get(ACCOUNT_MUTATION_HEADER) ===
    ACCOUNT_MUTATION_HEADER_VALUE
  );
}

export function sameOriginMutationAllowed(request: Request): boolean {
  return (
    sameOriginBrowserRequestAllowed(request) ||
    appAccountMutationHeaderPresent(request)
  );
}

export function sameOriginMutationRequired(request: Request): Response | null {
  if (sameOriginMutationAllowed(request)) return null;
  return accountJson(
    { error: "same-origin request required", code: "same_origin_required" },
    { status: 403 },
  );
}
