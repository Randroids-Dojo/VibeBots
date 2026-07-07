#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ACCOUNT_DIALOG_PATH,
  ACCOUNT_ENV_VAR_NAMES,
  ACCOUNT_GOOGLE_IDENTITY_SCOPES,
  ACCOUNT_SIGN_IN_PATH,
  accountEnvIssues,
  accountGoogleIdentityScopeString,
  accountGoogleScopeStringIsIdentityOnly,
} from "../src/lib/account-env-rules.mjs";

const GOOGLE_SCOPES_ENV = "CLERK_GOOGLE_SCOPES";

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

export function evaluateAccountEnv({
  env,
  packageJson,
  requireReady = false,
  googleScopes,
}) {
  const hasClerkSdk = hasDependency(packageJson, "@clerk/nextjs");
  /** @type {import("../src/lib/account-env-rules.mjs").AccountEnvVars} */
  const clerkEnv = Object.fromEntries(
    ACCOUNT_ENV_VAR_NAMES.map((name) => [name, envValue(env, name)]),
  );
  const googleScopesText =
    googleScopes !== undefined
      ? googleScopes.trim()
      : envValue(env, GOOGLE_SCOPES_ENV) || accountGoogleIdentityScopeString();
  const googleScopesDeclared = Boolean(googleScopesText);
  const googleScopesIdentityOnly =
    googleScopesDeclared &&
    accountGoogleScopeStringIsIdentityOnly(googleScopesText);
  const anyAccountEnv = Object.values(clerkEnv).some(Boolean);
  const googleScopesRequired = requireReady || anyAccountEnv || hasClerkSdk;

  const issues = [];
  if (!hasClerkSdk) issues.push("sdk_dependency_missing");
  // The env rules are the shared engine in src/lib/account-env-rules.mjs
  // (F-067), the same code the server's readiness classifier runs.
  issues.push(...accountEnvIssues(clerkEnv));
  if (googleScopesRequired && !googleScopesDeclared) {
    issues.push("google_scopes_missing");
  }
  if (googleScopesDeclared && !googleScopesIdentityOnly) {
    issues.push("google_scopes_non_identity");
  }

  const ready = issues.length === 0;
  const pending = !requireReady && !anyAccountEnv;
  return {
    ok: ready || pending,
    ready,
    pending,
    provider: "clerk",
    requiredGoogleScopes: ACCOUNT_GOOGLE_IDENTITY_SCOPES,
    checks: {
      sdkDependencyInstalled: hasClerkSdk,
      publishableKeyPresent: Boolean(
        clerkEnv.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      ),
      publishableKeyPrefixValid:
        !issues.includes("publishable_key_missing") &&
        !issues.includes("publishable_key_malformed"),
      secretKeyPresent: Boolean(clerkEnv.CLERK_SECRET_KEY),
      secretKeyPrefixValid:
        !issues.includes("secret_key_missing") &&
        !issues.includes("secret_key_malformed"),
      signInUrlConfigured: Boolean(clerkEnv.NEXT_PUBLIC_CLERK_SIGN_IN_URL),
      signInUrlIsExpectedRoute:
        clerkEnv.NEXT_PUBLIC_CLERK_SIGN_IN_URL === ACCOUNT_SIGN_IN_PATH,
      signUpUrlUnset: !clerkEnv.NEXT_PUBLIC_CLERK_SIGN_UP_URL,
      signInFallbackUrlConfigured: Boolean(
        clerkEnv.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL,
      ),
      signInFallbackUrlIsAccountRoute:
        clerkEnv.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL ===
        ACCOUNT_DIALOG_PATH,
      signUpFallbackUrlConfigured: Boolean(
        clerkEnv.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL,
      ),
      signUpFallbackUrlIsAccountRoute:
        clerkEnv.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL ===
        ACCOUNT_DIALOG_PATH,
      signInForceRedirectUrlUnset:
        !clerkEnv.NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL,
      signUpForceRedirectUrlUnset:
        !clerkEnv.NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL,
      afterSignInUrlUnset: !clerkEnv.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL,
      afterSignUpUrlUnset: !clerkEnv.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL,
      serverSignInForceRedirectUrlUnset:
        !clerkEnv.CLERK_SIGN_IN_FORCE_REDIRECT_URL,
      serverSignUpForceRedirectUrlUnset:
        !clerkEnv.CLERK_SIGN_UP_FORCE_REDIRECT_URL,
      serverAfterSignInUrlUnset: !clerkEnv.CLERK_AFTER_SIGN_IN_URL,
      serverAfterSignUpUrlUnset: !clerkEnv.CLERK_AFTER_SIGN_UP_URL,
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
