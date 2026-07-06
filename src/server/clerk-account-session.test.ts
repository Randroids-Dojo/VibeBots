import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accountIdentityFromClerkUser,
  clerkAccountIdentityResolver,
} from "./clerk-account-session";

describe("Clerk account session adapter", () => {
  it("does not import the Clerk SDK directly", () => {
    const source = readFileSync("src/server/clerk-account-session.ts", "utf8");

    expect(source).not.toContain("@clerk");
    expect(source).not.toContain("nextjs");
    expect(source).not.toContain("Request");
  });

  it("maps Clerk user id and primary email into account identity metadata", () => {
    expect(
      accountIdentityFromClerkUser({
        id: "user_123",
        primaryEmailAddress: { emailAddress: " pilot@example.com " },
      }),
    ).toEqual({
      provider: "clerk",
      subject: "user_123",
      email: "pilot@example.com",
    });
  });

  it("ignores malformed Clerk email metadata without rejecting the user id", () => {
    expect(
      accountIdentityFromClerkUser({
        id: "user_123",
        primaryEmailAddress: { emailAddress: 123 },
        primaryEmailAddressId: "email_2",
        emailAddresses: [
          { id: "email_1", emailAddress: "old@example.com" },
          { id: 2, emailAddress: "bad@example.com" },
        ],
      }),
    ).toEqual({
      provider: "clerk",
      subject: "user_123",
    });
  });

  it("falls back to the primary email id when the direct primary email is absent", () => {
    expect(
      accountIdentityFromClerkUser({
        id: "user_123",
        primaryEmailAddressId: "email_2",
        emailAddresses: [
          { id: "email_1", emailAddress: "old@example.com" },
          { id: "email_2", emailAddress: "pilot@example.com" },
        ],
      }),
    ).toEqual({
      provider: "clerk",
      subject: "user_123",
      email: "pilot@example.com",
    });
  });

  it("rejects missing or invalid Clerk user ids before routes see them", () => {
    expect(accountIdentityFromClerkUser(null)).toBeNull();
    expect(accountIdentityFromClerkUser({ id: " " })).toBeNull();
    expect(accountIdentityFromClerkUser({ id: 123 })).toBeNull();
    expect(accountIdentityFromClerkUser({ id: "user\n123" })).toBeNull();
  });

  it("resolves the signed-in Clerk user through injected server helpers", async () => {
    const resolver = clerkAccountIdentityResolver({
      auth: async () => ({ userId: "user_123" }),
      currentUser: async () => ({
        id: "user_123",
        primaryEmailAddress: { emailAddress: "pilot@example.com" },
      }),
    });

    await expect(resolver()).resolves.toEqual({
      provider: "clerk",
      subject: "user_123",
      email: "pilot@example.com",
    });
  });

  it("stays signed out when Clerk auth has no user id", async () => {
    let currentUserCalls = 0;
    const resolver = clerkAccountIdentityResolver({
      auth: () => ({ userId: null }),
      currentUser: () => {
        currentUserCalls += 1;
        return { id: "user_123" };
      },
    });

    await expect(resolver()).resolves.toBeNull();
    expect(currentUserCalls).toBe(0);
  });

  it("stays signed out when Clerk auth or current-user helpers fail", async () => {
    let currentUserCalls = 0;
    await expect(
      clerkAccountIdentityResolver({
        auth: () => {
          throw new Error("auth unavailable");
        },
        currentUser: () => {
          currentUserCalls += 1;
          return { id: "user_123" };
        },
      })(),
    ).resolves.toBeNull();
    expect(currentUserCalls).toBe(0);

    await expect(
      clerkAccountIdentityResolver({
        auth: () => ({ userId: "user_123" }),
        currentUser: () => {
          throw new Error("user unavailable");
        },
      })(),
    ).resolves.toBeNull();
  });

  it("rejects missing or mismatched Clerk current-user results", async () => {
    await expect(
      clerkAccountIdentityResolver({
        auth: () => ({ userId: "user_123" }),
        currentUser: () => null,
      })(),
    ).resolves.toBeNull();

    await expect(
      clerkAccountIdentityResolver({
        auth: () => ({ userId: "user_123" }),
        currentUser: () => ({ id: "user_456" }),
      })(),
    ).resolves.toBeNull();
  });
});
