import { describe, expect, it } from "vitest";
import { requestNeedsClerk } from "./proxy";

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
