const MAX_ACCOUNT_HANDOFF_ID_LENGTH = 128;
const ACCOUNT_HANDOFF_ID_RE = /^[A-Za-z0-9._:-]+$/;
const DEFAULT_MAX_ACCOUNT_RETURN_PATH_LENGTH = 256;

export interface AccountReturnPathPolicy {
  fallbackPath: string;
  allowPath: (path: string) => boolean;
  maxLength?: number;
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function safeLocalAccountReturnTo(
  value: unknown,
  policy: AccountReturnPathPolicy,
): string {
  if (typeof value !== "string") return policy.fallbackPath;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return policy.fallbackPath;
  }
  if (
    trimmed.includes("\\") ||
    hasAsciiControlCharacter(trimmed) ||
    trimmed.length >
      (policy.maxLength ?? DEFAULT_MAX_ACCOUNT_RETURN_PATH_LENGTH)
  ) {
    return policy.fallbackPath;
  }
  return policy.allowPath(trimmed) ? trimmed : policy.fallbackPath;
}

function mineAccountReturnPathAllowed(path: string): boolean {
  return (
    path === "/mine" || path.startsWith("/mine?") || path.startsWith("/mine#")
  );
}

export function safeAccountReturnTo(value: unknown): string {
  return safeLocalAccountReturnTo(value, {
    fallbackPath: "/mine",
    allowPath: mineAccountReturnPathAllowed,
  });
}

export function safeAccountHandoffId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handoffId = value.trim();
  if (!handoffId || handoffId.length > MAX_ACCOUNT_HANDOFF_ID_LENGTH) {
    return null;
  }
  return ACCOUNT_HANDOFF_ID_RE.test(handoffId) ? handoffId : null;
}
