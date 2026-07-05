import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_PROVIDER_ISSUES,
  isAccountProviderIssue,
} from "./account-provider-status";
import providerStatusCodes from "./account-provider-status-codes.json";

describe("account provider status contract", () => {
  it("accepts only the known Clerk readiness issue codes", () => {
    expect([...ACCOUNT_PROVIDER_ISSUES]).toEqual([
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
    expect(isAccountProviderIssue("sdk_not_wired")).toBe(true);
    expect(isAccountProviderIssue("sdk_dependency_missing")).toBe(true);
    expect(isAccountProviderIssue("publishable_key_malformed")).toBe(true);
    expect(isAccountProviderIssue("secret_key_malformed")).toBe(true);
    expect(isAccountProviderIssue("public_sign_in_url_not_sign_in_route")).toBe(
      true,
    );
    expect(isAccountProviderIssue("public_sign_up_url_configured")).toBe(true);
    expect(
      isAccountProviderIssue("public_sign_in_fallback_url_not_account_route"),
    ).toBe(true);
    expect(
      isAccountProviderIssue("public_sign_up_fallback_url_not_account_route"),
    ).toBe(true);
    expect(
      isAccountProviderIssue("public_sign_in_force_redirect_url_configured"),
    ).toBe(true);
    expect(
      isAccountProviderIssue("public_sign_up_force_redirect_url_configured"),
    ).toBe(true);
    expect(isAccountProviderIssue("public_after_sign_in_url_configured")).toBe(
      true,
    );
    expect(isAccountProviderIssue("public_after_sign_up_url_configured")).toBe(
      true,
    );
    expect(
      isAccountProviderIssue("server_sign_in_force_redirect_url_configured"),
    ).toBe(true);
    expect(
      isAccountProviderIssue("server_sign_up_force_redirect_url_configured"),
    ).toBe(true);
    expect(isAccountProviderIssue("server_after_sign_in_url_configured")).toBe(
      true,
    );
    expect(isAccountProviderIssue("server_after_sign_up_url_configured")).toBe(
      true,
    );
    expect(isAccountProviderIssue("unexpected_setup_issue")).toBe(false);
    expect(isAccountProviderIssue("")).toBe(false);
  });

  it("loads the issue list from shared JSON data", () => {
    expect(ACCOUNT_PROVIDER_ISSUES).toBe(providerStatusCodes.issues);
  });

  it("stays free of framework, provider, storage, and app imports", () => {
    const source = readFileSync("src/lib/account-provider-status.ts", "utf8");

    expect(source).not.toMatch(/from ["']@clerk\/nextjs["']/);
    expect(source).not.toMatch(/from ["']next\//);
    expect(source).not.toMatch(/from ["']react["']/);
    expect(source).not.toMatch(/from ["']@\/server\//);
    expect(source).not.toMatch(/from ["']@\/state\//);
    expect(source).not.toMatch(/from ["']@\/components\//);
  });
});
