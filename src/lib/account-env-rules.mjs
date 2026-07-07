/**
 * Single source of truth for the Clerk account-env readiness rules (F-067):
 * the expected route constants, the issue-code list, the Google identity
 * scopes, and the per-variable rule functions. Plain JavaScript so both the
 * ops preflight (scripts/check-account-env.mjs, which cannot import
 * TypeScript) and the server readiness classifier import the same rules;
 * tsconfig's allowJs type-checks this file and the const assertions below
 * give TypeScript consumers precise literal types.
 */

/** The app-local Clerk sign-in route (the only accepted sign-in URL). */
export const ACCOUNT_SIGN_IN_PATH = "/sign-in";

/** Where completed sign-ins land: the mine with the Account dialog open. */
export const ACCOUNT_DIALOG_PATH = "/mine?account=1";

export const ACCOUNT_PROVIDER_ISSUES = /** @type {const} */ ([
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
]);

export const ACCOUNT_GOOGLE_IDENTITY_SCOPES = /** @type {const} */ ([
  "openid",
  "email",
  "profile",
]);

/**
 * Every Clerk env variable the readiness rules read, in the order the ops
 * preflight reports them. The single source for these names: AccountEnvVars
 * and the preflight's env-reading loop both derive from this list, so adding
 * a Clerk variable is one edit here plus its rule below.
 */
export const ACCOUNT_ENV_VAR_NAMES = /** @type {const} */ ([
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
  "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL",
  "NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL",
  "NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL",
  "CLERK_SIGN_IN_FORCE_REDIRECT_URL",
  "CLERK_SIGN_UP_FORCE_REDIRECT_URL",
  "CLERK_AFTER_SIGN_IN_URL",
  "CLERK_AFTER_SIGN_UP_URL",
]);

/** @typedef {(typeof ACCOUNT_PROVIDER_ISSUES)[number]} EnvIssue */

// Per-variable rule helpers, composed by accountEnvIssues below. Internal:
// consumers call accountEnvIssues, never these directly.
/**
 * @param {string | undefined} value
 * @returns {EnvIssue | null}
 */
function publishableKeyIssue(value) {
  const key = (value ?? "").trim();
  if (!key) return "publishable_key_missing";
  if (!key.startsWith("pk_test_") && !key.startsWith("pk_live_")) {
    return "publishable_key_malformed";
  }
  return null;
}

/**
 * @param {string | undefined} value
 * @returns {EnvIssue | null}
 */
function secretKeyIssue(value) {
  const key = (value ?? "").trim();
  if (!key) return "secret_key_missing";
  if (!key.startsWith("sk_test_") && !key.startsWith("sk_live_")) {
    return "secret_key_malformed";
  }
  return null;
}

/**
 * @param {string | undefined} value
 * @returns {EnvIssue | null}
 */
function signInUrlIssue(value) {
  const url = (value ?? "").trim();
  if (!url) return "public_sign_in_url_missing";
  if (url !== ACCOUNT_SIGN_IN_PATH) {
    return "public_sign_in_url_not_sign_in_route";
  }
  return null;
}

/**
 * @param {string | undefined} value
 * @returns {EnvIssue | null}
 */
function signInFallbackUrlIssue(value) {
  const url = (value ?? "").trim();
  if (!url) return "public_sign_in_fallback_url_missing";
  if (url !== ACCOUNT_DIALOG_PATH) {
    return "public_sign_in_fallback_url_not_account_route";
  }
  return null;
}

/**
 * @param {string | undefined} value
 * @returns {EnvIssue | null}
 */
function signUpFallbackUrlIssue(value) {
  const url = (value ?? "").trim();
  if (!url) return "public_sign_up_fallback_url_missing";
  if (url !== ACCOUNT_DIALOG_PATH) {
    return "public_sign_up_fallback_url_not_account_route";
  }
  return null;
}

/**
 * The env-variable shape both consumers read (values may be undefined),
 * keyed by ACCOUNT_ENV_VAR_NAMES so the name list lives in exactly one place.
 * @typedef {Partial<Record<(typeof ACCOUNT_ENV_VAR_NAMES)[number], string>>} AccountEnvVars
 */

/** @param {string | undefined} value */
function configured(value) {
  return (value ?? "").trim().length > 0;
}

/**
 * The one rule engine (F-067): derives every env-derived readiness issue in
 * canonical order from the Clerk env variables. The SDK wiring flags and the
 * preflight-only Google scope issues are layered on by the two consumers.
 * @param {AccountEnvVars} env
 * @returns {EnvIssue[]}
 */
export function accountEnvIssues(env) {
  /** @type {EnvIssue[]} */
  const issues = [];
  const push = (/** @type {EnvIssue | null} */ issue) => {
    if (issue) issues.push(issue);
  };
  push(publishableKeyIssue(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY));
  push(secretKeyIssue(env.CLERK_SECRET_KEY));
  push(signInUrlIssue(env.NEXT_PUBLIC_CLERK_SIGN_IN_URL));
  if (configured(env.NEXT_PUBLIC_CLERK_SIGN_UP_URL)) {
    issues.push("public_sign_up_url_configured");
  }
  push(
    signInFallbackUrlIssue(env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL),
  );
  push(
    signUpFallbackUrlIssue(env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL),
  );
  if (configured(env.NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL)) {
    issues.push("public_sign_in_force_redirect_url_configured");
  }
  if (configured(env.NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL)) {
    issues.push("public_sign_up_force_redirect_url_configured");
  }
  if (configured(env.CLERK_SIGN_IN_FORCE_REDIRECT_URL)) {
    issues.push("server_sign_in_force_redirect_url_configured");
  }
  if (configured(env.CLERK_SIGN_UP_FORCE_REDIRECT_URL)) {
    issues.push("server_sign_up_force_redirect_url_configured");
  }
  if (configured(env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL)) {
    issues.push("public_after_sign_in_url_configured");
  }
  if (configured(env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL)) {
    issues.push("public_after_sign_up_url_configured");
  }
  if (configured(env.CLERK_AFTER_SIGN_IN_URL)) {
    issues.push("server_after_sign_in_url_configured");
  }
  if (configured(env.CLERK_AFTER_SIGN_UP_URL)) {
    issues.push("server_after_sign_up_url_configured");
  }
  return issues;
}

/** @param {string} value */
export function accountGoogleScopeListFromString(value) {
  return value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
}

/** @param {readonly unknown[]} values */
export function accountGoogleScopesAreIdentityOnly(values) {
  if (values.length !== ACCOUNT_GOOGLE_IDENTITY_SCOPES.length) return false;
  const unique = new Set();
  for (const value of values) {
    if (
      typeof value !== "string" ||
      !ACCOUNT_GOOGLE_IDENTITY_SCOPES.includes(
        /** @type {(typeof ACCOUNT_GOOGLE_IDENTITY_SCOPES)[number]} */ (value),
      )
    ) {
      return false;
    }
    unique.add(value);
  }
  return ACCOUNT_GOOGLE_IDENTITY_SCOPES.every((scope) => unique.has(scope));
}

/** @param {string} value */
export function accountGoogleScopeStringIsIdentityOnly(value) {
  return accountGoogleScopesAreIdentityOnly(
    accountGoogleScopeListFromString(value),
  );
}

export function accountGoogleIdentityScopeString() {
  return ACCOUNT_GOOGLE_IDENTITY_SCOPES.join(" ");
}
