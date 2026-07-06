import { describe, expect, it } from "vitest";
import {
  accountProviderReady,
  accountProviderStatus,
  accountProviderStatusFromConfig,
  clerkAccountProvider,
  createAccountSessionProvider,
  currentAccountIdentity,
  currentAccountSessionProvider,
  currentReadyAccountIdentity,
  requestAccountSessionProvider,
  resolveAccountIdentity,
} from "./account-session";

const READY_ACCOUNT_ENV = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fake",
  CLERK_SECRET_KEY: "sk_test_fake",
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
  NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/mine?account=1",
  NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/mine?account=1",
};

describe("account session resolver", () => {
  it("normalizes provider resolver output before routes use it", async () => {
    await expect(
      resolveAccountIdentity(async () => ({
        provider: " Clerk ",
        subject: " user-123 ",
        email: " pilot@example.com ",
      })),
    ).resolves.toEqual({
      provider: "clerk",
      subject: "user-123",
      email: "pilot@example.com",
    });
  });

  it("drops invalid resolver output", async () => {
    await expect(
      resolveAccountIdentity(async () => ({
        provider: "clerk",
        subject: " ",
      })),
    ).resolves.toBeNull();
    await expect(
      resolveAccountIdentity(async () => ({
        provider: "clerk oauth",
        subject: "user-123",
      })),
    ).resolves.toBeNull();
  });

  it("stays not ready until Clerk env is configured", async () => {
    expect(accountProviderStatus()).toEqual({
      provider: "clerk",
      ready: false,
      reason: "publishable_key_missing",
      issues: [
        "publishable_key_missing",
        "secret_key_missing",
        "public_sign_in_url_missing",
        "public_sign_in_fallback_url_missing",
        "public_sign_up_fallback_url_missing",
      ],
    });
    expect(accountProviderStatus(READY_ACCOUNT_ENV)).toEqual({
      provider: "clerk",
      ready: true,
      reason: null,
      issues: [],
    });
    expect(accountProviderReady()).toBe(false);
    await expect(currentAccountIdentity()).resolves.toBeNull();
  });

  it("reports provider ready only when resolver, env keys, and public sign-in URL are configured", () => {
    expect(
      accountProviderStatusFromConfig({
        resolverWired: false,
        sdkDependencyInstalled: false,
        NEXT_PUBLIC_CLERK_SIGN_IN_URL: "",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "sdk_not_wired",
      issues: [
        "sdk_not_wired",
        "sdk_dependency_missing",
        "publishable_key_missing",
        "secret_key_missing",
        "public_sign_in_url_missing",
        "public_sign_in_fallback_url_missing",
        "public_sign_up_fallback_url_missing",
      ],
    });

    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        NEXT_PUBLIC_CLERK_SIGN_IN_URL: "",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "publishable_key_missing",
      issues: [
        "publishable_key_missing",
        "secret_key_missing",
        "public_sign_in_url_missing",
        "public_sign_in_fallback_url_missing",
        "public_sign_up_fallback_url_missing",
      ],
    });

    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fake",
        CLERK_SECRET_KEY: "sk_test_fake",
        NEXT_PUBLIC_CLERK_SIGN_IN_URL: "https://accounts.example.test/sign-in",
        NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/mine?account=1",
        NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/mine?account=1",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "public_sign_in_url_not_sign_in_route",
      issues: ["public_sign_in_url_not_sign_in_route"],
    });

    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
      }),
    ).toEqual({
      provider: "clerk",
      ready: true,
      reason: null,
      issues: [],
    });

    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "public_sign_in_fallback_url_not_account_route",
      issues: ["public_sign_in_fallback_url_not_account_route"],
    });
  });

  it("requires the Clerk SDK dependency before reporting ready", () => {
    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: false,
        ...READY_ACCOUNT_ENV,
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "sdk_dependency_missing",
      issues: ["sdk_dependency_missing"],
    });
  });

  it("requires the Clerk fallback URL to return direct visits to Account", () => {
    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "public_sign_in_fallback_url_missing",
      issues: ["public_sign_in_fallback_url_missing"],
    });
  });

  it("rejects malformed Clerk key prefixes before reporting ready", () => {
    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "sk_test_wrong_kind",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "publishable_key_malformed",
      issues: ["publishable_key_malformed"],
    });

    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        CLERK_SECRET_KEY: "pk_test_wrong_kind",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "secret_key_malformed",
      issues: ["secret_key_malformed"],
    });
  });

  it("rejects a separate Clerk sign-up URL for the single sign-in-or-up page", () => {
    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "public_sign_up_url_configured",
      issues: ["public_sign_up_url_configured"],
    });
  });

  it("requires the Clerk sign-up fallback URL to return account creation to Account", () => {
    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "public_sign_up_fallback_url_missing",
      issues: ["public_sign_up_fallback_url_missing"],
    });

    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "public_sign_up_fallback_url_not_account_route",
      issues: ["public_sign_up_fallback_url_not_account_route"],
    });
  });

  it("rejects Clerk force redirects so account handoffs remain authoritative", () => {
    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL: "/mine?account=1",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "public_sign_in_force_redirect_url_configured",
      issues: ["public_sign_in_force_redirect_url_configured"],
    });

    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL: "/mine?account=1",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "public_sign_up_force_redirect_url_configured",
      issues: ["public_sign_up_force_redirect_url_configured"],
    });
  });

  it("rejects server Clerk force redirects so account handoffs remain authoritative", () => {
    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        CLERK_SIGN_IN_FORCE_REDIRECT_URL: "/mine?account=1",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "server_sign_in_force_redirect_url_configured",
      issues: ["server_sign_in_force_redirect_url_configured"],
    });

    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        CLERK_SIGN_UP_FORCE_REDIRECT_URL: "/mine?account=1",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "server_sign_up_force_redirect_url_configured",
      issues: ["server_sign_up_force_redirect_url_configured"],
    });
  });

  it("rejects deprecated Clerk after redirects in favor of fallback redirects", () => {
    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: "/mine?account=1",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "public_after_sign_in_url_configured",
      issues: ["public_after_sign_in_url_configured"],
    });

    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: "/mine?account=1",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "public_after_sign_up_url_configured",
      issues: ["public_after_sign_up_url_configured"],
    });
  });

  it("rejects server deprecated Clerk after redirects in favor of fallback redirects", () => {
    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        CLERK_AFTER_SIGN_IN_URL: "/mine?account=1",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "server_after_sign_in_url_configured",
      issues: ["server_after_sign_in_url_configured"],
    });

    expect(
      accountProviderStatusFromConfig({
        resolverWired: true,
        sdkDependencyInstalled: true,
        ...READY_ACCOUNT_ENV,
        CLERK_AFTER_SIGN_UP_URL: "/mine?account=1",
      }),
    ).toEqual({
      provider: "clerk",
      ready: false,
      reason: "server_after_sign_up_url_configured",
      issues: ["server_after_sign_up_url_configured"],
    });
  });

  it("resolves identity and readiness through an injected account provider", async () => {
    const provider = createAccountSessionProvider({
      identity: async () => ({
        provider: " Clerk ",
        subject: " user-456 ",
        email: " pilot@example.com ",
      }),
      status: () =>
        accountProviderStatusFromConfig({
          resolverWired: true,
          sdkDependencyInstalled: true,
          ...READY_ACCOUNT_ENV,
        }),
    });

    expect(accountProviderReady(provider)).toBe(true);
    await expect(currentAccountIdentity(provider)).resolves.toEqual({
      provider: "clerk",
      subject: "user-456",
      email: "pilot@example.com",
    });
  });

  it("wires the current runtime account provider to Clerk helpers", async () => {
    const provider = currentAccountSessionProvider(READY_ACCOUNT_ENV);

    expect(provider.status()).toEqual({
      provider: "clerk",
      ready: true,
      reason: null,
      issues: [],
    });
    expect(accountProviderReady(provider)).toBe(true);
    await expect(currentAccountIdentity(provider)).resolves.toBeNull();
  });

  it("does not expose account identity while the provider is not ready", async () => {
    const provider = createAccountSessionProvider({
      identity: async () => ({
        provider: "clerk",
        subject: "user_789",
      }),
      status: () =>
        accountProviderStatusFromConfig({
          resolverWired: true,
          sdkDependencyInstalled: true,
          NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fake",
          CLERK_SECRET_KEY: "sk_test_fake",
          NEXT_PUBLIC_CLERK_SIGN_IN_URL: "",
          NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/mine?account=1",
          NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/mine?account=1",
        }),
    });

    await expect(currentAccountIdentity(provider)).resolves.toEqual({
      provider: "clerk",
      subject: "user_789",
    });
    await expect(currentReadyAccountIdentity(provider)).resolves.toBeNull();
  });

  it("builds the approved Clerk provider from injected server helpers", async () => {
    const provider = clerkAccountProvider(
      {
        auth: async () => ({ userId: "user_789" }),
        currentUser: async () => ({
          id: "user_789",
          primaryEmailAddress: { emailAddress: "pilot@example.com" },
        }),
      },
      READY_ACCOUNT_ENV,
    );

    expect(provider.status()).toEqual({
      provider: "clerk",
      ready: true,
      reason: null,
      issues: [],
    });
    await expect(currentAccountIdentity(provider)).resolves.toEqual({
      provider: "clerk",
      subject: "user_789",
      email: "pilot@example.com",
    });
  });

  it("keeps the Clerk provider pending until the public sign-in route is configured", async () => {
    const provider = clerkAccountProvider(
      {
        auth: async () => ({ userId: "user_789" }),
        currentUser: async () => ({ id: "user_789" }),
      },
      {
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fake",
        CLERK_SECRET_KEY: "sk_test_fake",
        NEXT_PUBLIC_CLERK_SIGN_IN_URL: "",
        NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/mine?account=1",
        NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: "/mine?account=1",
      },
    );

    expect(provider.status()).toEqual({
      provider: "clerk",
      ready: false,
      reason: "public_sign_in_url_missing",
      issues: ["public_sign_in_url_missing"],
    });
    expect(accountProviderReady(provider)).toBe(false);
    await expect(currentAccountIdentity(provider)).resolves.toEqual({
      provider: "clerk",
      subject: "user_789",
    });
  });
});

describe("request account session provider", () => {
  interface FakeAuthState {
    userId?: unknown;
  }
  interface FakeRequestState {
    isAuthenticated: boolean;
    toAuth: () => FakeAuthState | null;
  }
  interface FakeClerkClient {
    authenticateRequest: () => Promise<FakeRequestState>;
    users: { getUser: (userId: string) => Promise<unknown> };
  }

  function factoryOf(client: FakeClerkClient) {
    return (() => client) as never;
  }

  function accountRequest(): Request {
    return new Request("https://vibebots.test/mine");
  }

  it("returns null without constructing a client when Clerk keys are missing", async () => {
    let clientRequested = false;
    const provider = requestAccountSessionProvider(
      accountRequest(),
      {},
      (() => {
        clientRequested = true;
        return {} as never;
      }) as never,
    );

    await expect(provider.identity()).resolves.toBeNull();
    expect(clientRequested).toBe(false);
  });

  it("returns null when the request is not authenticated", async () => {
    const provider = requestAccountSessionProvider(
      accountRequest(),
      READY_ACCOUNT_ENV,
      factoryOf({
        authenticateRequest: async () => ({
          isAuthenticated: false,
          toAuth: () => null,
        }),
        users: { getUser: async () => ({ id: "user_1" }) },
      }),
    );

    await expect(provider.identity()).resolves.toBeNull();
  });

  it("returns null when authenticating the request throws", async () => {
    const provider = requestAccountSessionProvider(
      accountRequest(),
      READY_ACCOUNT_ENV,
      factoryOf({
        authenticateRequest: async () => {
          throw new Error("clerk unreachable");
        },
        users: { getUser: async () => ({ id: "user_1" }) },
      }),
    );

    await expect(provider.identity()).resolves.toBeNull();
  });

  it("returns null when reading the auth state throws", async () => {
    const provider = requestAccountSessionProvider(
      accountRequest(),
      READY_ACCOUNT_ENV,
      factoryOf({
        authenticateRequest: async () => ({
          isAuthenticated: true,
          toAuth: () => {
            throw new Error("bad auth state");
          },
        }),
        users: { getUser: async () => ({ id: "user_1" }) },
      }),
    );

    await expect(provider.identity()).resolves.toBeNull();
  });

  it("returns null when the auth state has no user id", async () => {
    const provider = requestAccountSessionProvider(
      accountRequest(),
      READY_ACCOUNT_ENV,
      factoryOf({
        authenticateRequest: async () => ({
          isAuthenticated: true,
          toAuth: () => ({ userId: undefined }),
        }),
        users: { getUser: async () => ({ id: "user_1" }) },
      }),
    );

    await expect(provider.identity()).resolves.toBeNull();
  });

  it("resolves the linked identity for an authenticated request", async () => {
    const provider = requestAccountSessionProvider(
      accountRequest(),
      READY_ACCOUNT_ENV,
      factoryOf({
        authenticateRequest: async () => ({
          isAuthenticated: true,
          toAuth: () => ({ userId: "user_1" }),
        }),
        users: {
          getUser: async () => ({
            id: "user_1",
            primaryEmailAddress: { emailAddress: "pilot@example.com" },
          }),
        },
      }),
    );

    await expect(currentAccountIdentity(provider)).resolves.toEqual({
      provider: "clerk",
      subject: "user_1",
      email: "pilot@example.com",
    });
  });
});
