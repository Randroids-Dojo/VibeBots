import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_GOOGLE_IDENTITY_SCOPES,
  accountGoogleIdentityScopeString,
  accountGoogleScopeListFromString,
  accountGoogleScopeStringIsIdentityOnly,
  accountGoogleScopesAreIdentityOnly,
  isAccountGoogleIdentityScope,
} from "./account-google-scopes";
import googleScopes from "./account-google-scopes.json";

describe("account Google scope contract", () => {
  it("pins Google sign-in to the default identity scopes", () => {
    expect([...ACCOUNT_GOOGLE_IDENTITY_SCOPES]).toEqual([
      "openid",
      "email",
      "profile",
    ]);
    expect(accountGoogleIdentityScopeString()).toBe("openid email profile");
  });

  it("loads the scope list from shared JSON data", () => {
    expect(ACCOUNT_GOOGLE_IDENTITY_SCOPES).toBe(googleScopes.identity);
  });

  it("keeps shared scope data limited to identity scopes", () => {
    expect(Object.keys(googleScopes).sort()).toEqual(["identity"]);
    expect(googleScopes.identity.every(isAccountGoogleIdentityScope)).toBe(
      true,
    );
    expect(new Set(googleScopes.identity).size).toBe(
      ACCOUNT_GOOGLE_IDENTITY_SCOPES.length,
    );
  });

  it("accepts only the identity scope set", () => {
    expect(
      accountGoogleScopesAreIdentityOnly(["profile", "openid", "email"]),
    ).toBe(true);

    expect(accountGoogleScopesAreIdentityOnly(["openid", "email"])).toBe(false);
    expect(
      accountGoogleScopesAreIdentityOnly([
        "openid",
        "email",
        "profile",
        "profile",
      ]),
    ).toBe(false);
  });

  it("parses dashboard scope strings before validation", () => {
    expect(accountGoogleScopeListFromString(" openid,email profile ")).toEqual([
      "openid",
      "email",
      "profile",
    ]);
    expect(accountGoogleScopeStringIsIdentityOnly("openid email profile")).toBe(
      true,
    );
    expect(accountGoogleScopeStringIsIdentityOnly("openid,email,profile")).toBe(
      true,
    );
    expect(accountGoogleScopeStringIsIdentityOnly("openid email")).toBe(false);
  });

  it("rejects non-identity Google API scopes", () => {
    const blockedScopes = [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/contacts.readonly",
      "calendar.readonly",
    ];

    for (const scope of blockedScopes) {
      expect(isAccountGoogleIdentityScope(scope)).toBe(false);
      expect(
        accountGoogleScopesAreIdentityOnly([
          "openid",
          "email",
          "profile",
          scope,
        ]),
      ).toBe(false);
      expect(
        accountGoogleScopeStringIsIdentityOnly(`openid email profile ${scope}`),
      ).toBe(false);
    }
  });

  it("stays free of framework, provider, app, and storage imports", () => {
    const source = readFileSync("src/lib/account-google-scopes.ts", "utf8");

    expect(source).not.toMatch(/from ["']@clerk\/nextjs["']/);
    expect(source).not.toMatch(/from ["']next\//);
    expect(source).not.toMatch(/from ["']react["']/);
    expect(source).not.toMatch(/from ["']@\/server\//);
    expect(source).not.toMatch(/from ["']@\/state\//);
    expect(source).not.toMatch(/from ["']@\/components\//);
    expect(source).not.toMatch(/cookies\(/);
    expect(source).not.toMatch(/localStorage/);
  });
});
