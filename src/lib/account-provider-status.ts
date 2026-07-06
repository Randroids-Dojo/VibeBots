// Source of truth for the Clerk readiness issue codes and the
// AccountProviderIssue type derived from them. account-provider-status-codes.json
// mirrors this list for scripts/check-account-env.mjs, which cannot import
// TypeScript; the provider status contract test asserts the two stay in sync.
export const ACCOUNT_PROVIDER_ISSUES = [
  "sdk_not_wired",
  "sdk_dependency_missing",
  "publishable_key_missing",
  "publishable_key_malformed",
  "secret_key_missing",
  "secret_key_malformed",
  "public_sign_in_url_missing",
  "public_sign_in_url_not_sign_in_route",
  "public_sign_up_url_configured",
  "public_sign_in_fallback_url_missing",
  "public_sign_in_fallback_url_not_account_route",
  "public_sign_up_fallback_url_missing",
  "public_sign_up_fallback_url_not_account_route",
  "public_sign_in_force_redirect_url_configured",
  "public_sign_up_force_redirect_url_configured",
  "public_after_sign_in_url_configured",
  "public_after_sign_up_url_configured",
  "server_sign_in_force_redirect_url_configured",
  "server_sign_up_force_redirect_url_configured",
  "server_after_sign_in_url_configured",
  "server_after_sign_up_url_configured",
] as const;

export type AccountProviderIssue = (typeof ACCOUNT_PROVIDER_ISSUES)[number];

export type AccountProviderStatus = {
  provider: "clerk";
} & (
  | { ready: true; reason: null; issues: [] }
  | {
      ready: false;
      reason: AccountProviderIssue | null;
      issues: AccountProviderIssue[];
    }
);

export function isAccountProviderIssue(
  value: string,
): value is AccountProviderIssue {
  return ACCOUNT_PROVIDER_ISSUES.includes(value as AccountProviderIssue);
}
