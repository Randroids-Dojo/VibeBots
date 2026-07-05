import googleScopes from "./account-google-scopes.json";

export const ACCOUNT_GOOGLE_IDENTITY_SCOPES =
  googleScopes.identity as unknown as readonly ["openid", "email", "profile"];

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
