import { auth, createClerkClient, currentUser } from "@clerk/nextjs/server";
import {
  type AccountIdentity,
  normalizeAccountIdentity,
} from "@/lib/account-link-core";
import type {
  AccountProviderIssue,
  AccountProviderStatus,
} from "@/lib/account-provider-status";
import {
  accountIdentityFromClerkUser,
  type ClerkAccountResolverDeps,
  clerkAccountIdentityResolver,
} from "./clerk-account-session";

export {
  accountIdentityFromClerkUser,
  type ClerkAuthLike,
  type ClerkAuthResolver,
  type ClerkCurrentUserResolver,
  type ClerkUserLike,
  clerkAccountIdentityResolver,
} from "./clerk-account-session";

export type AccountIdentityResolver = () => Promise<AccountIdentity | null>;

export type { AccountProviderIssue, AccountProviderStatus };

export interface AccountProviderStatusEnv {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
  NEXT_PUBLIC_CLERK_SIGN_IN_URL?: string;
  NEXT_PUBLIC_CLERK_SIGN_UP_URL?: string;
  NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL?: string;
  NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL?: string;
  NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL?: string;
  NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL?: string;
  NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL?: string;
  NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL?: string;
  CLERK_SIGN_IN_FORCE_REDIRECT_URL?: string;
  CLERK_SIGN_UP_FORCE_REDIRECT_URL?: string;
  CLERK_AFTER_SIGN_IN_URL?: string;
  CLERK_AFTER_SIGN_UP_URL?: string;
}

export interface AccountProviderStatusConfig extends AccountProviderStatusEnv {
  resolverWired: boolean;
  sdkDependencyInstalled: boolean;
}

export interface AccountSessionProvider {
  identity: AccountIdentityResolver;
  status: () => AccountProviderStatus;
}

export async function resolveAccountIdentity(
  resolver: AccountIdentityResolver,
): Promise<AccountIdentity | null> {
  const identity = await resolver();
  return identity ? normalizeAccountIdentity(identity) : null;
}

function envValueConfigured(value: string | undefined): boolean {
  return (value ?? "").trim().length > 0;
}

function publishableKeyIssue(
  env: AccountProviderStatusEnv,
): AccountProviderIssue | null {
  const key = (env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "").trim();
  if (!key) return "publishable_key_missing";
  if (!key.startsWith("pk_test_") && !key.startsWith("pk_live_")) {
    return "publishable_key_malformed";
  }
  return null;
}

function secretKeyIssue(
  env: AccountProviderStatusEnv,
): AccountProviderIssue | null {
  const key = (env.CLERK_SECRET_KEY ?? "").trim();
  if (!key) return "secret_key_missing";
  if (!key.startsWith("sk_test_") && !key.startsWith("sk_live_")) {
    return "secret_key_malformed";
  }
  return null;
}

function publicSignInUrlIssue(
  env: AccountProviderStatusEnv,
): AccountProviderIssue | null {
  const signInUrl = (env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "").trim();
  if (!signInUrl) return "public_sign_in_url_missing";
  if (signInUrl !== "/sign-in") return "public_sign_in_url_not_sign_in_route";
  return null;
}

function publicSignUpUrlIssue(
  env: AccountProviderStatusEnv,
): AccountProviderIssue | null {
  if (envValueConfigured(env.NEXT_PUBLIC_CLERK_SIGN_UP_URL)) {
    return "public_sign_up_url_configured";
  }
  return null;
}

function publicSignInFallbackUrlIssue(
  env: AccountProviderStatusEnv,
): AccountProviderIssue | null {
  const fallbackUrl = (
    env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL ?? ""
  ).trim();
  if (!fallbackUrl) return "public_sign_in_fallback_url_missing";
  if (fallbackUrl !== "/mine?account=1") {
    return "public_sign_in_fallback_url_not_account_route";
  }
  return null;
}

function publicSignUpFallbackUrlIssue(
  env: AccountProviderStatusEnv,
): AccountProviderIssue | null {
  const fallbackUrl = (
    env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL ?? ""
  ).trim();
  if (!fallbackUrl) return "public_sign_up_fallback_url_missing";
  if (fallbackUrl !== "/mine?account=1") {
    return "public_sign_up_fallback_url_not_account_route";
  }
  return null;
}

function publicForceRedirectIssues(
  env: AccountProviderStatusEnv,
): AccountProviderIssue[] {
  const issues: AccountProviderIssue[] = [];
  if (envValueConfigured(env.NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL)) {
    issues.push("public_sign_in_force_redirect_url_configured");
  }
  if (envValueConfigured(env.NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL)) {
    issues.push("public_sign_up_force_redirect_url_configured");
  }
  if (envValueConfigured(env.CLERK_SIGN_IN_FORCE_REDIRECT_URL)) {
    issues.push("server_sign_in_force_redirect_url_configured");
  }
  if (envValueConfigured(env.CLERK_SIGN_UP_FORCE_REDIRECT_URL)) {
    issues.push("server_sign_up_force_redirect_url_configured");
  }
  return issues;
}

function publicDeprecatedRedirectIssues(
  env: AccountProviderStatusEnv,
): AccountProviderIssue[] {
  const issues: AccountProviderIssue[] = [];
  if (envValueConfigured(env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL)) {
    issues.push("public_after_sign_in_url_configured");
  }
  if (envValueConfigured(env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL)) {
    issues.push("public_after_sign_up_url_configured");
  }
  if (envValueConfigured(env.CLERK_AFTER_SIGN_IN_URL)) {
    issues.push("server_after_sign_in_url_configured");
  }
  if (envValueConfigured(env.CLERK_AFTER_SIGN_UP_URL)) {
    issues.push("server_after_sign_up_url_configured");
  }
  return issues;
}

function currentProviderStatusEnv(): AccountProviderStatusEnv {
  return {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL,
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL,
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL:
      process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL,
    NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL:
      process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL,
    NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL:
      process.env.NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL,
    NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL:
      process.env.NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL,
    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL:
      process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL,
    NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL:
      process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL,
    CLERK_SIGN_IN_FORCE_REDIRECT_URL:
      process.env.CLERK_SIGN_IN_FORCE_REDIRECT_URL,
    CLERK_SIGN_UP_FORCE_REDIRECT_URL:
      process.env.CLERK_SIGN_UP_FORCE_REDIRECT_URL,
    CLERK_AFTER_SIGN_IN_URL: process.env.CLERK_AFTER_SIGN_IN_URL,
    CLERK_AFTER_SIGN_UP_URL: process.env.CLERK_AFTER_SIGN_UP_URL,
  };
}

export function accountProviderStatus(
  env: AccountProviderStatusEnv = currentProviderStatusEnv(),
): AccountProviderStatus {
  return currentAccountSessionProvider(env).status();
}

export function accountProviderStatusFromConfig(
  config: AccountProviderStatusConfig,
): AccountProviderStatus {
  const issues: AccountProviderIssue[] = [];
  if (!config.resolverWired) issues.push("sdk_not_wired");
  if (!config.sdkDependencyInstalled) issues.push("sdk_dependency_missing");
  const publishableIssue = publishableKeyIssue(config);
  if (publishableIssue) issues.push(publishableIssue);
  const secretIssue = secretKeyIssue(config);
  if (secretIssue) issues.push(secretIssue);
  const signInIssue = publicSignInUrlIssue(config);
  if (signInIssue) issues.push(signInIssue);
  const signUpIssue = publicSignUpUrlIssue(config);
  if (signUpIssue) issues.push(signUpIssue);
  const fallbackIssue = publicSignInFallbackUrlIssue(config);
  if (fallbackIssue) issues.push(fallbackIssue);
  const signUpFallbackIssue = publicSignUpFallbackUrlIssue(config);
  if (signUpFallbackIssue) issues.push(signUpFallbackIssue);
  issues.push(...publicForceRedirectIssues(config));
  issues.push(...publicDeprecatedRedirectIssues(config));
  const reason = issues[0];
  if (!reason) {
    return {
      provider: "clerk",
      ready: true,
      reason: null,
      issues: [],
    };
  }
  return {
    provider: "clerk",
    ready: false,
    reason,
    issues,
  };
}

export function accountProviderReady(
  provider: AccountSessionProvider = currentAccountSessionProvider(),
): boolean {
  return provider.status().ready;
}

export function currentAccountSessionProvider(
  env: AccountProviderStatusEnv = currentProviderStatusEnv(),
): AccountSessionProvider {
  return clerkAccountProvider({ auth, currentUser }, env);
}

export function requestAccountSessionProvider(
  request: Request,
  env: AccountProviderStatusEnv = currentProviderStatusEnv(),
  createClient: typeof createClerkClient = createClerkClient,
  options: { withEmail?: boolean } = {},
): AccountSessionProvider {
  return {
    identity: async () => {
      const publishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
      const secretKey = env.CLERK_SECRET_KEY?.trim();
      if (!publishableKey || !secretKey) return null;

      const client = createClient({ publishableKey, secretKey });
      let requestState: Awaited<ReturnType<typeof client.authenticateRequest>>;
      try {
        requestState = await client.authenticateRequest(request, {
          publishableKey,
          secretKey,
          signInUrl: env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "/sign-in",
        });
      } catch {
        return null;
      }
      if (!requestState.isAuthenticated) return null;

      let authState: ReturnType<typeof requestState.toAuth>;
      try {
        authState = requestState.toAuth();
      } catch {
        return null;
      }
      const userId =
        typeof authState?.userId === "string" ? authState.userId : undefined;
      if (!userId) return null;

      // The Clerk user lookup is a remote API call and only supplies the
      // email, so skip it unless the caller actually surfaces the email.
      if (!options.withEmail) return { provider: "clerk", subject: userId };

      try {
        return accountIdentityFromClerkUser(await client.users.getUser(userId));
      } catch {
        return null;
      }
    },
    status: () =>
      accountProviderStatusFromConfig({
        ...env,
        resolverWired: true,
        sdkDependencyInstalled: true,
      }),
  };
}

export function clerkAccountProvider(
  deps: ClerkAccountResolverDeps,
  env: AccountProviderStatusEnv = currentProviderStatusEnv(),
): AccountSessionProvider {
  return {
    identity: clerkAccountIdentityResolver(deps),
    status: () =>
      accountProviderStatusFromConfig({
        ...env,
        resolverWired: true,
        sdkDependencyInstalled: true,
      }),
  };
}

export async function currentAccountIdentity(
  provider: AccountSessionProvider = currentAccountSessionProvider(),
): Promise<AccountIdentity | null> {
  return resolveAccountIdentity(provider.identity);
}

export async function currentReadyAccountIdentity(
  provider: AccountSessionProvider = currentAccountSessionProvider(),
  providerStatus: AccountProviderStatus = provider.status(),
): Promise<AccountIdentity | null> {
  if (!providerStatus.ready) return null;
  return currentAccountIdentity(provider);
}
