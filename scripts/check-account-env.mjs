#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PUBLIC_KEY = "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY";
const SECRET_KEY = "CLERK_SECRET_KEY";
const SIGN_IN_URL = "NEXT_PUBLIC_CLERK_SIGN_IN_URL";
const SIGN_UP_URL = "NEXT_PUBLIC_CLERK_SIGN_UP_URL";
const SIGN_IN_FALLBACK_URL = "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL";
const SIGN_UP_FALLBACK_URL = "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL";
const SIGN_IN_FORCE_URL = "NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL";
const SIGN_UP_FORCE_URL = "NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL";
const AFTER_SIGN_IN_URL = "NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL";
const AFTER_SIGN_UP_URL = "NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL";
const SERVER_SIGN_IN_FORCE_URL = "CLERK_SIGN_IN_FORCE_REDIRECT_URL";
const SERVER_SIGN_UP_FORCE_URL = "CLERK_SIGN_UP_FORCE_REDIRECT_URL";
const SERVER_AFTER_SIGN_IN_URL = "CLERK_AFTER_SIGN_IN_URL";
const SERVER_AFTER_SIGN_UP_URL = "CLERK_AFTER_SIGN_UP_URL";
const GOOGLE_SCOPES_ENV = "CLERK_GOOGLE_SCOPES";
const STATUS_CODES_URL = new URL(
  "../src/lib/account-provider-status-codes.json",
  import.meta.url,
);
const GOOGLE_SCOPES_URL = new URL(
  "../src/lib/account-google-scopes.json",
  import.meta.url,
);
const ACCOUNT_PROVIDER_ISSUES = JSON.parse(
  readFileSync(STATUS_CODES_URL, "utf8"),
).issues;
const ACCOUNT_GOOGLE_IDENTITY_SCOPES = JSON.parse(
  readFileSync(GOOGLE_SCOPES_URL, "utf8"),
).identity;

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadLocalEnvFile(path = ".env.local") {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const name = trimmed.slice(0, equalsIndex).trim();
    if (!name || process.env[name] !== undefined) continue;

    process.env[name] = unquoteEnvValue(trimmed.slice(equalsIndex + 1));
  }
}

function hasArg(name) {
  return process.argv.includes(name);
}

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function readPackageJson() {
  return JSON.parse(readFileSync("package.json", "utf8"));
}

function hasDependency(packageJson, name) {
  return Boolean(
    packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name],
  );
}

function envValue(env, name) {
  return env[name]?.trim() ?? "";
}

function providerIssue(name) {
  if (!ACCOUNT_PROVIDER_ISSUES.includes(name)) {
    throw new Error(`unknown account provider issue: ${name}`);
  }
  return name;
}

function publishableKeyIssue(value) {
  const trimmed = value.trim();
  if (!trimmed) return providerIssue("publishable_key_missing");
  if (!trimmed.startsWith("pk_test_") && !trimmed.startsWith("pk_live_")) {
    return providerIssue("publishable_key_malformed");
  }
  return null;
}

function secretKeyIssue(value) {
  const trimmed = value.trim();
  if (!trimmed) return providerIssue("secret_key_missing");
  if (!trimmed.startsWith("sk_test_") && !trimmed.startsWith("sk_live_")) {
    return providerIssue("secret_key_malformed");
  }
  return null;
}

function signInUrlIssue(value) {
  const trimmed = value.trim();
  if (!trimmed) return providerIssue("public_sign_in_url_missing");
  if (trimmed !== "/sign-in") {
    return providerIssue("public_sign_in_url_not_sign_in_route");
  }
  return null;
}

function signUpUrlIssue(value) {
  if (value.trim()) return providerIssue("public_sign_up_url_configured");
  return null;
}

function signInFallbackUrlIssue(value) {
  const trimmed = value.trim();
  if (!trimmed) return providerIssue("public_sign_in_fallback_url_missing");
  if (trimmed !== "/mine?account=1") {
    return providerIssue("public_sign_in_fallback_url_not_account_route");
  }
  return null;
}

function signUpFallbackUrlIssue(value) {
  const trimmed = value.trim();
  if (!trimmed) return providerIssue("public_sign_up_fallback_url_missing");
  if (trimmed !== "/mine?account=1") {
    return providerIssue("public_sign_up_fallback_url_not_account_route");
  }
  return null;
}

function forceRedirectIssues({
  signInForceUrl,
  signUpForceUrl,
  serverSignInForceUrl,
  serverSignUpForceUrl,
}) {
  const issues = [];
  if (signInForceUrl.trim()) {
    issues.push(providerIssue("public_sign_in_force_redirect_url_configured"));
  }
  if (signUpForceUrl.trim()) {
    issues.push(providerIssue("public_sign_up_force_redirect_url_configured"));
  }
  if (serverSignInForceUrl.trim()) {
    issues.push(providerIssue("server_sign_in_force_redirect_url_configured"));
  }
  if (serverSignUpForceUrl.trim()) {
    issues.push(providerIssue("server_sign_up_force_redirect_url_configured"));
  }
  return issues;
}

function deprecatedRedirectIssues({
  afterSignInUrl,
  afterSignUpUrl,
  serverAfterSignInUrl,
  serverAfterSignUpUrl,
}) {
  const issues = [];
  if (afterSignInUrl.trim()) {
    issues.push(providerIssue("public_after_sign_in_url_configured"));
  }
  if (afterSignUpUrl.trim()) {
    issues.push(providerIssue("public_after_sign_up_url_configured"));
  }
  if (serverAfterSignInUrl.trim()) {
    issues.push(providerIssue("server_after_sign_in_url_configured"));
  }
  if (serverAfterSignUpUrl.trim()) {
    issues.push(providerIssue("server_after_sign_up_url_configured"));
  }
  return issues;
}

function googleScopeList(value) {
  return value
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
}

function googleScopesAreIdentityOnly(value) {
  const scopes = googleScopeList(value);
  if (scopes.length !== ACCOUNT_GOOGLE_IDENTITY_SCOPES.length) {
    return false;
  }

  const uniqueScopes = new Set(scopes);
  return (
    uniqueScopes.size === ACCOUNT_GOOGLE_IDENTITY_SCOPES.length &&
    ACCOUNT_GOOGLE_IDENTITY_SCOPES.every((scope) => uniqueScopes.has(scope))
  );
}

function defaultGoogleScopes() {
  return ACCOUNT_GOOGLE_IDENTITY_SCOPES.join(" ");
}

export function evaluateAccountEnv({
  env,
  packageJson,
  requireReady = false,
  googleScopes,
}) {
  const hasClerkSdk = hasDependency(packageJson, "@clerk/nextjs");
  const accountEnv = {
    publishableKey: envValue(env, PUBLIC_KEY),
    secretKey: envValue(env, SECRET_KEY),
    signInUrl: envValue(env, SIGN_IN_URL),
    signUpUrl: envValue(env, SIGN_UP_URL),
    signInFallbackUrl: envValue(env, SIGN_IN_FALLBACK_URL),
    signUpFallbackUrl: envValue(env, SIGN_UP_FALLBACK_URL),
    signInForceUrl: envValue(env, SIGN_IN_FORCE_URL),
    signUpForceUrl: envValue(env, SIGN_UP_FORCE_URL),
    afterSignInUrl: envValue(env, AFTER_SIGN_IN_URL),
    afterSignUpUrl: envValue(env, AFTER_SIGN_UP_URL),
    serverSignInForceUrl: envValue(env, SERVER_SIGN_IN_FORCE_URL),
    serverSignUpForceUrl: envValue(env, SERVER_SIGN_UP_FORCE_URL),
    serverAfterSignInUrl: envValue(env, SERVER_AFTER_SIGN_IN_URL),
    serverAfterSignUpUrl: envValue(env, SERVER_AFTER_SIGN_UP_URL),
  };
  const googleScopesText =
    googleScopes !== undefined
      ? googleScopes.trim()
      : envValue(env, GOOGLE_SCOPES_ENV) || defaultGoogleScopes();
  const googleScopesDeclared = Boolean(googleScopesText);
  const googleScopesIdentityOnly =
    googleScopesDeclared && googleScopesAreIdentityOnly(googleScopesText);
  const anyClerkEnv =
    accountEnv.publishableKey || accountEnv.secretKey || accountEnv.signInUrl;
  const anyAccountEnv =
    anyClerkEnv ||
    Boolean(accountEnv.signUpUrl) ||
    Boolean(accountEnv.signInFallbackUrl) ||
    Boolean(accountEnv.signUpFallbackUrl) ||
    Boolean(accountEnv.signInForceUrl) ||
    Boolean(accountEnv.signUpForceUrl) ||
    Boolean(accountEnv.afterSignInUrl) ||
    Boolean(accountEnv.afterSignUpUrl) ||
    Boolean(accountEnv.serverSignInForceUrl) ||
    Boolean(accountEnv.serverSignUpForceUrl) ||
    Boolean(accountEnv.serverAfterSignInUrl) ||
    Boolean(accountEnv.serverAfterSignUpUrl);
  const googleScopesRequired = requireReady || anyAccountEnv || hasClerkSdk;

  const issues = [];
  if (!hasClerkSdk) issues.push(providerIssue("sdk_dependency_missing"));
  const publishableIssue = publishableKeyIssue(accountEnv.publishableKey);
  if (publishableIssue) issues.push(publishableIssue);
  const secretIssue = secretKeyIssue(accountEnv.secretKey);
  if (secretIssue) issues.push(secretIssue);
  const signInIssue = signInUrlIssue(accountEnv.signInUrl);
  if (signInIssue) issues.push(signInIssue);
  const signUpIssue = signUpUrlIssue(accountEnv.signUpUrl);
  if (signUpIssue) issues.push(signUpIssue);
  const signInFallbackIssue = signInFallbackUrlIssue(
    accountEnv.signInFallbackUrl,
  );
  if (signInFallbackIssue) issues.push(signInFallbackIssue);
  const signUpFallbackIssue = signUpFallbackUrlIssue(
    accountEnv.signUpFallbackUrl,
  );
  if (signUpFallbackIssue) issues.push(signUpFallbackIssue);
  issues.push(...forceRedirectIssues(accountEnv));
  issues.push(...deprecatedRedirectIssues(accountEnv));
  if (googleScopesRequired && !googleScopesDeclared) {
    issues.push("google_scopes_missing");
  }
  if (googleScopesDeclared && !googleScopesIdentityOnly) {
    issues.push("google_scopes_non_identity");
  }

  const ready = issues.length === 0;
  const pending = !requireReady && !anyAccountEnv;
  return {
    ok: ready || (!requireReady && pending),
    ready,
    pending,
    provider: "clerk",
    requiredGoogleScopes: ACCOUNT_GOOGLE_IDENTITY_SCOPES,
    checks: {
      sdkDependencyInstalled: hasClerkSdk,
      publishableKeyPresent: Boolean(accountEnv.publishableKey),
      publishableKeyPrefixValid:
        accountEnv.publishableKey.startsWith("pk_test_") ||
        accountEnv.publishableKey.startsWith("pk_live_"),
      secretKeyPresent: Boolean(accountEnv.secretKey),
      secretKeyPrefixValid:
        accountEnv.secretKey.startsWith("sk_test_") ||
        accountEnv.secretKey.startsWith("sk_live_"),
      signInUrlConfigured: Boolean(accountEnv.signInUrl),
      signInUrlIsExpectedRoute: accountEnv.signInUrl === "/sign-in",
      signUpUrlUnset: !accountEnv.signUpUrl,
      signInFallbackUrlConfigured: Boolean(accountEnv.signInFallbackUrl),
      signInFallbackUrlIsAccountRoute:
        accountEnv.signInFallbackUrl === "/mine?account=1",
      signUpFallbackUrlConfigured: Boolean(accountEnv.signUpFallbackUrl),
      signUpFallbackUrlIsAccountRoute:
        accountEnv.signUpFallbackUrl === "/mine?account=1",
      signInForceRedirectUrlUnset: !accountEnv.signInForceUrl,
      signUpForceRedirectUrlUnset: !accountEnv.signUpForceUrl,
      afterSignInUrlUnset: !accountEnv.afterSignInUrl,
      afterSignUpUrlUnset: !accountEnv.afterSignUpUrl,
      serverSignInForceRedirectUrlUnset: !accountEnv.serverSignInForceUrl,
      serverSignUpForceRedirectUrlUnset: !accountEnv.serverSignUpForceUrl,
      serverAfterSignInUrlUnset: !accountEnv.serverAfterSignInUrl,
      serverAfterSignUpUrlUnset: !accountEnv.serverAfterSignUpUrl,
      googleScopesDeclared,
      googleScopesIdentityOnly,
    },
    issues,
  };
}

function main() {
  loadLocalEnvFile();

  const result = evaluateAccountEnv({
    env: process.env,
    packageJson: readPackageJson(),
    requireReady: hasArg("--require-ready"),
    googleScopes: readArgValue("--google-scopes"),
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "account env check failed",
    );
    process.exit(1);
  }
}
