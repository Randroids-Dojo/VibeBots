import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_GOOGLE_IDENTITY_SCOPES,
  accountGoogleScopeStringIsIdentityOnly,
} from "@/lib/account-google-scopes";
import { isAccountProviderIssue } from "@/lib/account-provider-status";
import { evaluateAccountEnv } from "../../scripts/check-account-env.mjs";
import { accountProviderStatusFromConfig } from "./account-session";

const READY_ACCOUNT_ENV = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fake",
  CLERK_SECRET_KEY: "sk_test_fake",
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
  NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/mine?account=1",
  NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/mine?account=1",
};

function evaluate({
  env = {},
  dependencies = {},
  requireReady = false,
  googleScopes,
}: {
  env?: Record<string, string>;
  dependencies?: Record<string, string>;
  requireReady?: boolean;
  googleScopes?: string;
} = {}) {
  return evaluateAccountEnv({
    env,
    packageJson: { dependencies },
    requireReady,
    googleScopes,
  });
}

describe("account env preflight", () => {
  it("accepts the current no-SDK state as safely pending", () => {
    expect(evaluate()).toEqual({
      ok: true,
      ready: false,
      pending: true,
      provider: "clerk",
      requiredGoogleScopes: ACCOUNT_GOOGLE_IDENTITY_SCOPES,
      checks: {
        sdkDependencyInstalled: false,
        publishableKeyPresent: false,
        publishableKeyPrefixValid: false,
        secretKeyPresent: false,
        secretKeyPrefixValid: false,
        signInUrlConfigured: false,
        signInUrlIsExpectedRoute: false,
        signUpUrlUnset: true,
        signInFallbackUrlConfigured: false,
        signInFallbackUrlIsAccountRoute: false,
        signUpFallbackUrlConfigured: false,
        signUpFallbackUrlIsAccountRoute: false,
        signInForceRedirectUrlUnset: true,
        signUpForceRedirectUrlUnset: true,
        afterSignInUrlUnset: true,
        afterSignUpUrlUnset: true,
        serverSignInForceRedirectUrlUnset: true,
        serverSignUpForceRedirectUrlUnset: true,
        serverAfterSignInUrlUnset: true,
        serverAfterSignUpUrlUnset: true,
        googleScopesDeclared: false,
        googleScopesIdentityOnly: false,
      },
      issues: [
        "sdk_dependency_missing",
        "publishable_key_missing",
        "secret_key_missing",
        "public_sign_in_url_missing",
        "public_sign_in_fallback_url_missing",
        "public_sign_up_fallback_url_missing",
      ],
    });
  });

  it("fails partial Clerk env instead of treating it as pending", () => {
    expect(
      evaluate({
        env: {
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fake",
        },
      }),
    ).toMatchObject({
      ok: false,
      pending: false,
      checks: {
        publishableKeyPresent: true,
        publishableKeyPrefixValid: true,
        secretKeyPresent: false,
        secretKeyPrefixValid: false,
      },
      issues: [
        "sdk_dependency_missing",
        "secret_key_missing",
        "public_sign_in_url_missing",
        "public_sign_in_fallback_url_missing",
        "public_sign_up_fallback_url_missing",
        "google_scopes_missing",
      ],
    });
  });

  it("does not include Clerk key values in the preflight result", () => {
    const env = {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public_value_to_hide",
      CLERK_SECRET_KEY: "sk_test_secret_value_to_hide",
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/wrong-route",
    };
    const resultText = JSON.stringify(
      evaluate({
        env,
        dependencies: { "@clerk/nextjs": "1.0.0" },
        requireReady: true,
        googleScopes: "openid email profile",
      }),
    );

    expect(resultText).not.toContain(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
    expect(resultText).not.toContain(env.CLERK_SECRET_KEY);
    expect(resultText).toContain("publishableKeyPresent");
    expect(resultText).toContain("secretKeyPresent");
    expect(resultText).toContain("public_sign_in_url_not_sign_in_route");
  });

  it("does not print Clerk key values from the CLI", () => {
    const env = {
      ...process.env,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_cli_public_value_to_hide",
      CLERK_SECRET_KEY: "sk_test_cli_secret_value_to_hide",
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
      NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
      NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/mine?account=1",
      NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/mine?account=1",
    };
    const result = spawnSync(
      process.execPath,
      [
        "scripts/check-account-env.mjs",
        "--require-ready",
        "--google-scopes",
        "openid email profile",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env,
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("public_sign_up_url_configured");
    expect(output).not.toContain(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
    expect(output).not.toContain(env.CLERK_SECRET_KEY);
  });

  it("requires the local app sign-in route", () => {
    expect(
      evaluate({
        env: {
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fake",
          CLERK_SECRET_KEY: "sk_test_fake",
          NEXT_PUBLIC_CLERK_SIGN_IN_URL:
            "https://accounts.example.test/sign-in",
          NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/mine?account=1",
          NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/mine?account=1",
        },
        dependencies: { "@clerk/nextjs": "1.0.0" },
        googleScopes: "openid email profile",
      }),
    ).toMatchObject({
      ok: false,
      ready: false,
      checks: {
        sdkDependencyInstalled: true,
        publishableKeyPresent: true,
        publishableKeyPrefixValid: true,
        secretKeyPresent: true,
        secretKeyPrefixValid: true,
        signInUrlConfigured: true,
        signInUrlIsExpectedRoute: false,
      },
      issues: ["public_sign_in_url_not_sign_in_route"],
    });
  });

  it("rejects a separate public sign-up route for the single-page flow", () => {
    expect(
      evaluate({
        env: {
          ...READY_ACCOUNT_ENV,
          NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
        },
        dependencies: { "@clerk/nextjs": "1.0.0" },
        googleScopes: "openid email profile",
      }),
    ).toMatchObject({
      ok: false,
      ready: false,
      checks: {
        signUpUrlUnset: false,
      },
      issues: ["public_sign_up_url_configured"],
    });
  });

  it("rejects malformed Clerk key prefixes", () => {
    expect(
      evaluate({
        env: {
          ...READY_ACCOUNT_ENV,
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "sk_test_wrong_kind",
          CLERK_SECRET_KEY: "pk_test_wrong_kind",
        },
        dependencies: { "@clerk/nextjs": "1.0.0" },
        googleScopes: "openid email profile",
      }),
    ).toMatchObject({
      ok: false,
      ready: false,
      checks: {
        publishableKeyPresent: true,
        publishableKeyPrefixValid: false,
        secretKeyPresent: true,
        secretKeyPrefixValid: false,
      },
      issues: ["publishable_key_malformed", "secret_key_malformed"],
    });
  });

  it("requires the local account fallback route", () => {
    expect(
      evaluate({
        env: {
          ...READY_ACCOUNT_ENV,
          NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/",
        },
        dependencies: { "@clerk/nextjs": "1.0.0" },
        googleScopes: "openid email profile",
      }),
    ).toMatchObject({
      ok: false,
      ready: false,
      checks: {
        signInFallbackUrlConfigured: true,
        signInFallbackUrlIsAccountRoute: false,
      },
      issues: ["public_sign_in_fallback_url_not_account_route"],
    });
  });

  it("requires the sign-up fallback to return account creation to Account", () => {
    expect(
      evaluate({
        env: {
          ...READY_ACCOUNT_ENV,
          NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/",
        },
        dependencies: { "@clerk/nextjs": "1.0.0" },
        googleScopes: "openid email profile",
      }),
    ).toMatchObject({
      ok: false,
      ready: false,
      checks: {
        signUpFallbackUrlConfigured: true,
        signUpFallbackUrlIsAccountRoute: false,
      },
      issues: ["public_sign_up_fallback_url_not_account_route"],
    });
  });

  it("rejects force redirects that would bypass the account handoff", () => {
    expect(
      evaluate({
        env: {
          ...READY_ACCOUNT_ENV,
          NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL: "/mine?account=1",
          NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL: "/mine?account=1",
        },
        dependencies: { "@clerk/nextjs": "1.0.0" },
        googleScopes: "openid email profile",
      }),
    ).toMatchObject({
      ok: false,
      ready: false,
      checks: {
        signInForceRedirectUrlUnset: false,
        signUpForceRedirectUrlUnset: false,
      },
      issues: [
        "public_sign_in_force_redirect_url_configured",
        "public_sign_up_force_redirect_url_configured",
      ],
    });
  });

  it("rejects server force redirects that would bypass the account handoff", () => {
    expect(
      evaluate({
        env: {
          ...READY_ACCOUNT_ENV,
          CLERK_SIGN_IN_FORCE_REDIRECT_URL: "/mine?account=1",
          CLERK_SIGN_UP_FORCE_REDIRECT_URL: "/mine?account=1",
        },
        dependencies: { "@clerk/nextjs": "1.0.0" },
        googleScopes: "openid email profile",
      }),
    ).toMatchObject({
      ok: false,
      ready: false,
      checks: {
        serverSignInForceRedirectUrlUnset: false,
        serverSignUpForceRedirectUrlUnset: false,
      },
      issues: [
        "server_sign_in_force_redirect_url_configured",
        "server_sign_up_force_redirect_url_configured",
      ],
    });
  });

  it("rejects deprecated after redirects in favor of fallback redirects", () => {
    expect(
      evaluate({
        env: {
          ...READY_ACCOUNT_ENV,
          NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: "/mine?account=1",
          NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: "/mine?account=1",
        },
        dependencies: { "@clerk/nextjs": "1.0.0" },
        googleScopes: "openid email profile",
      }),
    ).toMatchObject({
      ok: false,
      ready: false,
      checks: {
        afterSignInUrlUnset: false,
        afterSignUpUrlUnset: false,
      },
      issues: [
        "public_after_sign_in_url_configured",
        "public_after_sign_up_url_configured",
      ],
    });
  });

  it("rejects server deprecated after redirects in favor of fallback redirects", () => {
    expect(
      evaluate({
        env: {
          ...READY_ACCOUNT_ENV,
          CLERK_AFTER_SIGN_IN_URL: "/mine?account=1",
          CLERK_AFTER_SIGN_UP_URL: "/mine?account=1",
        },
        dependencies: { "@clerk/nextjs": "1.0.0" },
        googleScopes: "openid email profile",
      }),
    ).toMatchObject({
      ok: false,
      ready: false,
      checks: {
        serverAfterSignInUrlUnset: false,
        serverAfterSignUpUrlUnset: false,
      },
      issues: [
        "server_after_sign_in_url_configured",
        "server_after_sign_up_url_configured",
      ],
    });
  });

  it("requires ready setup when requested", () => {
    expect(evaluate({ requireReady: true })).toMatchObject({
      ok: false,
      pending: true,
      checks: {
        googleScopesDeclared: false,
        googleScopesIdentityOnly: false,
      },
      issues: expect.arrayContaining(["google_scopes_missing"]),
    });
  });

  it("rejects non-identity Google scopes during setup", () => {
    expect(
      evaluate({
        env: {
          ...READY_ACCOUNT_ENV,
        },
        dependencies: { "@clerk/nextjs": "1.0.0" },
        googleScopes:
          "openid email profile https://www.googleapis.com/auth/drive.file",
      }),
    ).toMatchObject({
      ok: false,
      ready: false,
      checks: {
        googleScopesDeclared: true,
        googleScopesIdentityOnly: false,
      },
      issues: ["google_scopes_non_identity"],
    });
  });

  it("matches the shared Google scope string helper", () => {
    const cases = [
      "openid email profile",
      "openid,email,profile",
      "profile openid email",
      "openid email",
      "openid email profile profile",
      "openid email profile https://www.googleapis.com/auth/gmail.readonly",
      "",
      " ",
    ];

    for (const googleScopes of cases) {
      expect(evaluate({ googleScopes }).checks.googleScopesIdentityOnly).toBe(
        accountGoogleScopeStringIsIdentityOnly(googleScopes),
      );
    }
  });

  it("passes once the SDK and expected env are present", () => {
    expect(
      evaluate({
        env: {
          ...READY_ACCOUNT_ENV,
        },
        dependencies: { "@clerk/nextjs": "1.0.0" },
        requireReady: true,
        googleScopes: "openid email profile",
      }),
    ).toEqual({
      ok: true,
      ready: true,
      pending: false,
      provider: "clerk",
      requiredGoogleScopes: ACCOUNT_GOOGLE_IDENTITY_SCOPES,
      checks: {
        sdkDependencyInstalled: true,
        publishableKeyPresent: true,
        publishableKeyPrefixValid: true,
        secretKeyPresent: true,
        secretKeyPrefixValid: true,
        signInUrlConfigured: true,
        signInUrlIsExpectedRoute: true,
        signUpUrlUnset: true,
        signInFallbackUrlConfigured: true,
        signInFallbackUrlIsAccountRoute: true,
        signUpFallbackUrlConfigured: true,
        signUpFallbackUrlIsAccountRoute: true,
        signInForceRedirectUrlUnset: true,
        signUpForceRedirectUrlUnset: true,
        afterSignInUrlUnset: true,
        afterSignUpUrlUnset: true,
        serverSignInForceRedirectUrlUnset: true,
        serverSignUpForceRedirectUrlUnset: true,
        serverAfterSignInUrlUnset: true,
        serverAfterSignUpUrlUnset: true,
        googleScopesDeclared: true,
        googleScopesIdentityOnly: true,
      },
      issues: [],
    });
  });

  it("matches runtime readiness for the approved ready setup", () => {
    const env = READY_ACCOUNT_ENV;
    const preflight = evaluate({
      env,
      dependencies: { "@clerk/nextjs": "1.0.0" },
      requireReady: true,
      googleScopes: "openid email profile",
    });
    const runtime = accountProviderStatusFromConfig({
      ...env,
      resolverWired: true,
      sdkDependencyInstalled: true,
    });

    expect(preflight.ready).toBe(true);
    expect(runtime.ready).toBe(true);
    expect(preflight.issues).toEqual(runtime.issues);
  });

  it("matches runtime readiness for a missing Clerk SDK dependency", () => {
    const env = READY_ACCOUNT_ENV;
    const preflight = evaluate({
      env,
      dependencies: {},
      requireReady: true,
      googleScopes: "openid email profile",
    });
    const runtime = accountProviderStatusFromConfig({
      ...env,
      resolverWired: true,
      sdkDependencyInstalled: false,
    });

    expect(preflight.ready).toBe(false);
    expect(runtime.ready).toBe(false);
    expect(preflight.issues).toEqual(runtime.issues);
  });

  it("matches runtime readiness for missing Clerk env keys after resolver wiring", () => {
    const env = {
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
      NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/mine?account=1",
      NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/mine?account=1",
    };
    const preflight = evaluate({
      env,
      dependencies: { "@clerk/nextjs": "1.0.0" },
      requireReady: true,
      googleScopes: "openid email profile",
    });
    const runtime = accountProviderStatusFromConfig({
      ...env,
      resolverWired: true,
      sdkDependencyInstalled: true,
    });

    expect(preflight.ready).toBe(false);
    expect(runtime.ready).toBe(false);
    expect(preflight.issues).toEqual(runtime.issues);
  });

  it("matches runtime readiness for a non-local sign-in URL", () => {
    const env = {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fake",
      CLERK_SECRET_KEY: "sk_test_fake",
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: "https://accounts.example.test/sign-in",
      NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/mine?account=1",
      NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/mine?account=1",
    };
    const preflight = evaluate({
      env,
      dependencies: { "@clerk/nextjs": "1.0.0" },
      requireReady: true,
      googleScopes: "openid email profile",
    });
    const runtime = accountProviderStatusFromConfig({
      ...env,
      resolverWired: true,
      sdkDependencyInstalled: true,
    });

    expect(preflight.ready).toBe(false);
    expect(runtime.ready).toBe(false);
    expect(preflight.issues).toEqual(runtime.issues);
  });

  it("keeps preflight provider issues on the shared readiness list", () => {
    const preflight = evaluate();
    const providerIssues = preflight.issues.filter(
      (issue) =>
        !["google_scopes_missing", "google_scopes_non_identity"].includes(
          issue,
        ),
    );

    expect(providerIssues.length).toBeGreaterThan(0);
    expect(providerIssues.every(isAccountProviderIssue)).toBe(true);
  });
});
