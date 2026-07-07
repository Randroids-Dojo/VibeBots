import { auth, createClerkClient, currentUser } from "@clerk/nextjs/server";
import {
  ACCOUNT_SIGN_IN_PATH,
  type AccountEnvVars,
  accountEnvIssues,
} from "@/lib/account-env-rules.mjs";
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

// The env-variable shape lives once in the shared rules module (F-067),
// keyed by ACCOUNT_ENV_VAR_NAMES; adding a Clerk variable is one edit there.
export type AccountProviderStatusEnv = AccountEnvVars;

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
  // The env rules live in src/lib/account-env-rules.mjs (F-067), shared
  // verbatim with the ops preflight so the two can never drift.
  const issues: AccountProviderIssue[] = [];
  if (!config.resolverWired) issues.push("sdk_not_wired");
  if (!config.sdkDependencyInstalled) issues.push("sdk_dependency_missing");
  issues.push(...accountEnvIssues(config));
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
          signInUrl: env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? ACCOUNT_SIGN_IN_PATH,
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
