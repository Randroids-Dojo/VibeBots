// Source of truth for the pinned Google identity scopes and the type derived
// from them. account-google-scopes.json mirrors this list for
// scripts/check-account-env.mjs, which cannot import TypeScript; the scope
// contract test asserts the two stay in sync.
export const ACCOUNT_GOOGLE_IDENTITY_SCOPES = [
  "openid",
  "email",
  "profile",
] as const;

export type AccountGoogleIdentityScope =
  (typeof ACCOUNT_GOOGLE_IDENTITY_SCOPES)[number];

export function accountGoogleIdentityScopeString(): string {
  return ACCOUNT_GOOGLE_IDENTITY_SCOPES.join(" ");
}

export function isAccountGoogleIdentityScope(
  value: unknown,
): value is AccountGoogleIdentityScope {
  return (
    typeof value === "string" &&
    ACCOUNT_GOOGLE_IDENTITY_SCOPES.includes(value as AccountGoogleIdentityScope)
  );
}

export function accountGoogleScopesAreIdentityOnly(
  values: readonly unknown[],
): boolean {
  if (values.length !== ACCOUNT_GOOGLE_IDENTITY_SCOPES.length) {
    return false;
  }

  const uniqueScopes = new Set<AccountGoogleIdentityScope>();
  for (const value of values) {
    if (!isAccountGoogleIdentityScope(value)) {
      return false;
    }
    uniqueScopes.add(value);
  }

  return ACCOUNT_GOOGLE_IDENTITY_SCOPES.every((scope) =>
    uniqueScopes.has(scope),
  );
}

export function accountGoogleScopeListFromString(value: string): string[] {
  return value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
}

export function accountGoogleScopeStringIsIdentityOnly(value: string): boolean {
  return accountGoogleScopesAreIdentityOnly(
    accountGoogleScopeListFromString(value),
  );
}
