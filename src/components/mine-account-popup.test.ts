import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AccountSaveSummary, AccountSyncState } from "@/state/mine-store";
import { nextFocusTrapIndex } from "./dialog-primitives";
import {
  AccountSyncPopup,
  accountDialogControls,
  accountSignInRedirectUrl,
  accountSignInUrlIsExpectedRoute,
} from "./mine-account-popup";

const localSave: AccountSaveSummary = {
  exists: true,
  createdAt: null,
  balance: 18,
  deepestDepth: 7,
  partsOwned: 4,
  designs: 2,
  stamps: 1,
};

const cloudSave: AccountSaveSummary = {
  exists: true,
  createdAt: null,
  balance: 42,
  deepestDepth: 9,
  partsOwned: 8,
  designs: 3,
  stamps: 2,
};

type AccountStateOverrides = Partial<
  Pick<
    AccountSyncState,
    "providerStatus" | "mode" | "accountEmail" | "currentSave" | "accountSave"
  >
> & { providerReady?: boolean };

function accountState(overrides: AccountStateOverrides = {}): AccountSyncState {
  const { providerReady = false, ...stateOverrides } = overrides;
  const providerStatus =
    overrides.providerStatus ??
    (providerReady
      ? {
          provider: "clerk" as const,
          ready: true as const,
          reason: null,
          issues: [],
        }
      : {
          provider: "clerk" as const,
          ready: false as const,
          reason: "sdk_not_wired" as const,
          issues: [
            "sdk_not_wired" as const,
            "publishable_key_missing" as const,
            "secret_key_missing" as const,
            "public_sign_in_url_missing" as const,
            "public_sign_in_fallback_url_missing" as const,
            "public_sign_up_fallback_url_missing" as const,
          ],
        });
  return {
    state: "ready",
    mode: "guest",
    accountEmail: null,
    currentSave: localSave,
    accountSave: null,
    ...stateOverrides,
    providerStatus,
  };
}

describe("accountSignInRedirectUrl", () => {
  it("adds the one-time handoff to Clerk's return redirect", () => {
    const url = accountSignInRedirectUrl({
      signInUrl: "/sign-in",
      origin: "https://vibebots.test",
      handoff: {
        handoffId: "handoff-123",
        expiresAt: "2026-07-04T00:10:00.000Z",
        returnTo: "/mine?panel=account",
      },
    });

    const signIn = new URL(url);
    expect(signIn.origin).toBe("https://vibebots.test");
    expect(signIn.pathname).toBe("/sign-in");

    const redirectUrl = signIn.searchParams.get("redirect_url");
    expect(redirectUrl).toBeTruthy();
    const redirect = new URL(redirectUrl ?? "");
    expect(redirect.origin).toBe("https://vibebots.test");
    expect(redirect.pathname).toBe("/mine");
    expect(redirect.searchParams.get("panel")).toBe("account");
    expect(redirect.searchParams.get("accountHandoff")).toBe("handoff-123");
  });

  it("normalizes hosted Clerk sign-in URLs back to the app sign-in route", () => {
    const url = accountSignInRedirectUrl({
      signInUrl: "https://accounts.vibebots.test/sign-in",
      origin: "https://vibebots.test",
      handoff: {
        handoffId: "handoff-456",
        expiresAt: "2026-07-04T00:10:00.000Z",
        returnTo: "/mine",
      },
    });

    const signIn = new URL(url);
    expect(signIn.origin).toBe("https://vibebots.test");
    expect(signIn.pathname).toBe("/sign-in");
    const redirectUrl = signIn.searchParams.get("redirect_url");
    expect(new URL(redirectUrl ?? "").searchParams.get("accountHandoff")).toBe(
      "handoff-456",
    );
  });

  it("keeps Clerk return redirects on the app origin", () => {
    const url = accountSignInRedirectUrl({
      signInUrl: "https://accounts.vibebots.test/sign-in",
      origin: "https://vibebots.test",
      handoff: {
        handoffId: "handoff-789",
        expiresAt: "2026-07-04T00:10:00.000Z",
        returnTo: "https://evil.test/capture",
      },
    });

    const redirectUrl = new URL(url).searchParams.get("redirect_url");
    const redirect = new URL(redirectUrl ?? "");
    expect(redirect.origin).toBe("https://vibebots.test");
    expect(redirect.pathname).toBe("/mine");
    expect(redirect.searchParams.get("accountHandoff")).toBe("handoff-789");
  });
});

describe("accountSignInUrlIsExpectedRoute", () => {
  it("accepts only the local app sign-in route", () => {
    expect(accountSignInUrlIsExpectedRoute("/sign-in")).toBe(true);
    expect(accountSignInUrlIsExpectedRoute(" /sign-in ")).toBe(true);
    expect(accountSignInUrlIsExpectedRoute("")).toBe(false);
    expect(accountSignInUrlIsExpectedRoute("/mine?account=1")).toBe(false);
    expect(
      accountSignInUrlIsExpectedRoute("https://accounts.vibebots.test/sign-in"),
    ).toBe(false);
  });
});

describe("accountDialogControls", () => {
  it("draws only the moves the current state offers", () => {
    const guest = accountDialogControls({
      state: accountState(),
      signInUrl: "/sign-in",
      pending: null,
    });
    expect(guest.showSignIn).toBe(true);
    expect(guest.showClaim).toBe(false);
    expect(guest.showLoadCloud).toBe(false);
    expect(guest.showRefresh).toBe(false);

    const signedIn = accountDialogControls({
      state: { ...accountState(), mode: "signed_in" },
      signInUrl: "/sign-in",
      pending: null,
    });
    // Signed in, the sign-in button could only ever render disabled.
    expect(signedIn.showSignIn).toBe(false);
    expect(signedIn.showClaim).toBe(true);
    expect(signedIn.showLoadCloud).toBe(false);

    const conflict = accountDialogControls({
      state: { ...accountState(), mode: "conflict", accountSave: cloudSave },
      signInUrl: "/sign-in",
      pending: null,
    });
    // A conflict is a choice between two saves, not a save-this-run moment.
    expect(conflict.showClaim).toBe(false);
    expect(conflict.showLoadCloud).toBe(true);
    expect(conflict.showRefresh).toBe(false);
  });

  it("hides an action whose save does not exist", () => {
    // Signed in with nothing saved on this device: there is no run to save.
    const nothingLocal = accountDialogControls({
      state: { ...accountState(), mode: "signed_in", currentSave: null },
      signInUrl: "/sign-in",
      pending: null,
    });
    expect(nothingLocal.showClaim).toBe(false);
    expect(nothingLocal.canClaim).toBe(false);

    // A conflict with no cloud save is not a conflict worth a button.
    const nothingCloud = accountDialogControls({
      state: { ...accountState(), mode: "conflict", accountSave: null },
      signInUrl: "/sign-in",
      pending: null,
    });
    expect(nothingCloud.showLoadCloud).toBe(false);
    expect(nothingCloud.canLoadCloud).toBe(false);
  });

  it("keeps a running action on screen while it completes", () => {
    // `busy` disables the button but must not make it vanish mid-click.
    const claiming = accountDialogControls({
      state: { ...accountState(), mode: "signed_in" },
      signInUrl: "/sign-in",
      pending: "claim",
    });
    expect(claiming.showClaim).toBe(true);
    expect(claiming.canClaim).toBe(false);
  });

  it("offers Refresh only when there is something to recover from", () => {
    for (const state of ["error", "unavailable"] as const) {
      expect(
        accountDialogControls({
          state: {
            ...accountState(),
            state,
            message: "boom",
          } as AccountSyncState,
          signInUrl: "/sign-in",
          pending: null,
        }).showRefresh,
      ).toBe(true);
    }
    expect(
      accountDialogControls({
        state: accountState(),
        signInUrl: "/sign-in",
        pending: null,
      }).showRefresh,
    ).toBe(false);
  });

  it("keeps Google sign-in disabled until the provider URL is configured", () => {
    const controls = accountDialogControls({
      state: accountState(),
      signInUrl: "",
      pending: null,
    });

    expect(controls.signInDisabled).toBe(true);
    expect(controls.signInLabel).toBe("Google sign-in pending");
    expect(controls.canClaim).toBe(false);
    expect(controls.canLoadCloud).toBe(false);
    expect(controls.canKeepDevice).toBe(false);
  });

  it("enables Google sign-in for a guest once the provider URL exists", () => {
    const controls = accountDialogControls({
      state: accountState({ providerReady: true }),
      signInUrl: "/sign-in",
      pending: null,
    });

    expect(controls.signInDisabled).toBe(false);
    expect(controls.signInLabel).toBe("Sign in or create account with Google");
  });

  it("blocks embedded Google sign-in so the user can open a full page", () => {
    const controls = accountDialogControls({
      state: accountState({ providerReady: true }),
      signInUrl: "/sign-in",
      pending: null,
      signInBlockedByEmbed: true,
    });

    expect(controls.signInDisabled).toBe(true);
    expect(controls.signInLabel).toBe("Open full page to sign in");
  });

  it("keeps Google sign-in disabled when only the public URL is configured", () => {
    const controls = accountDialogControls({
      state: accountState({ providerReady: false }),
      signInUrl: "/sign-in",
      pending: null,
    });

    expect(controls.signInDisabled).toBe(true);
    expect(controls.signInLabel).toBe("Google sign-in pending");
  });

  it("keeps Google sign-in disabled for hosted sign-in URLs", () => {
    const controls = accountDialogControls({
      state: accountState({ providerReady: true }),
      signInUrl: "https://accounts.vibebots.test/sign-in",
      pending: null,
    });

    expect(controls.signInDisabled).toBe(true);
    expect(controls.signInLabel).toBe("Google sign-in pending");
  });

  it("requires the explicit provider status before enabling Google sign-in", () => {
    const controls = accountDialogControls({
      state: accountState({
        providerReady: true,
        providerStatus: {
          provider: "clerk",
          ready: false,
          reason: "sdk_not_wired",
          issues: ["sdk_not_wired"],
        },
      }),
      signInUrl: "/sign-in",
      pending: null,
    });

    expect(controls.signInDisabled).toBe(true);
    expect(controls.signInLabel).toBe("Google sign-in pending");
  });

  it("enables Save this run only for signed-in local progress", () => {
    const controls = accountDialogControls({
      state: accountState({
        mode: "signed_in",
        accountEmail: "pilot@example.com",
      }),
      signInUrl: "/sign-in",
      pending: null,
    });

    expect(controls.signedIn).toBe(true);
    expect(controls.signInDisabled).toBe(true);
    expect(controls.canClaim).toBe(true);
    expect(controls.canLoadCloud).toBe(false);
  });

  it("keeps Save this run disabled without an existing local save", () => {
    const controls = accountDialogControls({
      state: accountState({
        mode: "signed_in",
        accountEmail: "pilot@example.com",
        currentSave: null,
      }),
      signInUrl: "/sign-in",
      pending: null,
    });

    expect(controls.canClaim).toBe(false);
  });

  it("requires an explicit cloud-load action when both saves exist", () => {
    const controls = accountDialogControls({
      state: accountState({
        mode: "conflict",
        accountEmail: "pilot@example.com",
        accountSave: cloudSave,
      }),
      signInUrl: "/sign-in",
      pending: null,
    });

    expect(controls.canClaim).toBe(false);
    expect(controls.canLoadCloud).toBe(true);
    expect(controls.canKeepDevice).toBe(true);
  });

  it("locks every account action while a handoff is starting", () => {
    const controls = accountDialogControls({
      state: accountState({
        mode: "conflict",
        accountEmail: "pilot@example.com",
        accountSave: cloudSave,
      }),
      signInUrl: "/sign-in",
      pending: "sign-in",
    });

    expect(controls.busy).toBe(true);
    expect(controls.signInDisabled).toBe(true);
    expect(controls.canClaim).toBe(false);
    expect(controls.canLoadCloud).toBe(false);
    expect(controls.canKeepDevice).toBe(false);
  });
});

describe("nextFocusTrapIndex", () => {
  it("wraps Tab from the last focusable back to the first", () => {
    expect(nextFocusTrapIndex(3, 2, false)).toBe(0);
  });

  it("wraps Shift+Tab from the first focusable to the last", () => {
    expect(nextFocusTrapIndex(3, 0, true)).toBe(2);
  });

  it("pulls focus back inside when it sits outside the dialog", () => {
    expect(nextFocusTrapIndex(3, -1, false)).toBe(0);
    expect(nextFocusTrapIndex(3, -1, true)).toBe(2);
  });

  it("lets the browser move focus in the middle of the dialog", () => {
    expect(nextFocusTrapIndex(3, 1, false)).toBeNull();
    expect(nextFocusTrapIndex(3, 1, true)).toBeNull();
  });

  it("does nothing when the dialog has no focusable controls", () => {
    expect(nextFocusTrapIndex(0, -1, false)).toBeNull();
  });
});

describe("AccountSyncPopup", () => {
  it("renders the guest account dialog with disabled pending Google sign-in", () => {
    const html = renderToStaticMarkup(
      createElement(AccountSyncPopup, {
        open: true,
        state: accountState(),
        onClose: vi.fn(),
        onRefresh: vi.fn(),
        onStartSignIn: vi.fn(),
        onClaim: vi.fn(),
        onLoadCloud: vi.fn(),
      }),
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Guest save is local to this device.");
    expect(html).toContain("Google sign-in pending");
    expect(html).toContain("Close Account");
    expect(html).toContain("18 vibes");
  });

  it("renders both save summaries for conflict review", () => {
    const html = renderToStaticMarkup(
      createElement(AccountSyncPopup, {
        open: true,
        state: accountState({
          mode: "conflict",
          accountEmail: "pilot@example.com",
          accountSave: cloudSave,
        }),
        onClose: vi.fn(),
        onRefresh: vi.fn(),
        onStartSignIn: vi.fn(),
        onClaim: vi.fn(),
        onLoadCloud: vi.fn(),
      }),
    );

    expect(html).toContain("Choose which save to use.");
    expect(html).toContain("pilot@example.com");
    expect(html).toContain("This device");
    expect(html).toContain("Google account");
    expect(html).toContain("18 vibes");
    expect(html).toContain("42 vibes");
    expect(html).toContain("Load cloud save");
    expect(html).toContain("Keep this device save");
  });
});
