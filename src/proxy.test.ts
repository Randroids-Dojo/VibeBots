import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestNeedsClerk } from "./proxy";
import { clerkConfigured } from "./server/clerk-configured";

function request(pathname: string, headers: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
    nextUrl: { pathname },
  };
}

describe("requestNeedsClerk", () => {
  it("runs Clerk middleware for the Clerk frontend bridge", () => {
    expect(requestNeedsClerk(request("/__clerk"))).toBe(true);
    expect(requestNeedsClerk(request("/__clerk/v1/client"))).toBe(true);
  });

  it("keeps account checks on the route-handler auth path", () => {
    expect(requestNeedsClerk(request("/api/account/status"))).toBe(false);
    expect(
      requestNeedsClerk(
        request("/api/account/status", { cookie: "__session=abc" }),
      ),
    ).toBe(false);
    expect(
      requestNeedsClerk(
        request("/api/account/claim", { authorization: "Bearer token" }),
      ),
    ).toBe(false);
  });

  it("does not run Clerk middleware for public gameplay pages", () => {
    expect(requestNeedsClerk(request("/mine"))).toBe(false);
    expect(requestNeedsClerk(request("/sign-in"))).toBe(false);
  });
});

describe("clerkConfigured", () => {
  const savedPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const savedSecretKey = process.env.CLERK_SECRET_KEY;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;
  });

  afterEach(() => {
    if (savedPublishableKey === undefined) {
      delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    } else {
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = savedPublishableKey;
    }
    if (savedSecretKey === undefined) {
      delete process.env.CLERK_SECRET_KEY;
    } else {
      process.env.CLERK_SECRET_KEY = savedSecretKey;
    }
  });

  it("is not ready when only the publishable key is set", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_abc";
    expect(clerkConfigured()).toBe(false);
  });

  it("is not ready when only the secret key is set", () => {
    process.env.CLERK_SECRET_KEY = "sk_test_abc";
    expect(clerkConfigured()).toBe(false);
  });

  it("is ready only when both keys are set", () => {
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_abc";
    process.env.CLERK_SECRET_KEY = "sk_test_abc";
    expect(clerkConfigured()).toBe(true);
  });
});
