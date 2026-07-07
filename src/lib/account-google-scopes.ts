// The pinned Google identity scopes and their helpers live in
// account-env-rules.mjs (F-067), the single rules module shared with
// scripts/check-account-env.mjs. This wrapper derives the TypeScript types.
import {
  ACCOUNT_GOOGLE_IDENTITY_SCOPES,
  accountGoogleIdentityScopeString,
  accountGoogleScopeListFromString,
  accountGoogleScopeStringIsIdentityOnly,
  accountGoogleScopesAreIdentityOnly,
} from "./account-env-rules.mjs";

export {
  ACCOUNT_GOOGLE_IDENTITY_SCOPES,
  accountGoogleIdentityScopeString,
  accountGoogleScopeListFromString,
  accountGoogleScopeStringIsIdentityOnly,
  accountGoogleScopesAreIdentityOnly,
};

export type AccountGoogleIdentityScope =
  (typeof ACCOUNT_GOOGLE_IDENTITY_SCOPES)[number];

export function isAccountGoogleIdentityScope(
  value: unknown,
): value is AccountGoogleIdentityScope {
  return (
    typeof value === "string" &&
    ACCOUNT_GOOGLE_IDENTITY_SCOPES.includes(value as AccountGoogleIdentityScope)
  );
}
