"use client";

import { memo, useEffect, useRef, useState } from "react";
import { ACCOUNT_SIGN_IN_PATH } from "@/lib/account-env-rules.mjs";
import { safeAccountReturnTo } from "@/lib/account-handoff-contract";
import type {
  AccountHandoffStart,
  AccountSaveSummary,
  AccountSyncState,
} from "@/state/mine-store";
import {
  DIALOG_BACKDROP_STYLE,
  DIALOG_PRIMARY_ACCENT,
  DIALOG_QUIET_ACCENT,
  DialogActionButton,
  dialogCardStyle,
  useFocusTrap,
} from "./dialog-primitives";
import { DismissibleDialogFrame } from "./dismissible-dialog-frame";

const SIGN_IN_URL = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "";

export function accountSignInUrlIsExpectedRoute(signInUrl: string): boolean {
  return signInUrl.trim() === ACCOUNT_SIGN_IN_PATH;
}

export function accountSignInRedirectUrl({
  signInUrl,
  origin,
  handoff,
}: {
  signInUrl: string;
  origin: string;
  handoff: AccountHandoffStart;
}): string {
  const callback = new URL(safeAccountReturnTo(handoff.returnTo), origin);
  callback.searchParams.set("accountHandoff", handoff.handoffId);
  const signIn = new URL(
    accountSignInUrlIsExpectedRoute(signInUrl)
      ? signInUrl.trim()
      : ACCOUNT_SIGN_IN_PATH,
    origin,
  );
  signIn.searchParams.set("redirect_url", callback.toString());
  return signIn.toString();
}

function saveMeta(summary: AccountSaveSummary | null): string {
  if (!summary?.exists) return "No saved progress";
  return [
    `${summary.balance} vibes`,
    `depth ${summary.deepestDepth}`,
    `${summary.partsOwned} parts`,
    `${summary.designs} bots`,
    `${summary.stamps} stamps`,
  ].join(" | ");
}

function statusText(state: AccountSyncState): string {
  if (state.state === "unavailable") return "Account sync needs storage.";
  if (state.state === "error") return state.message;
  if (state.state === "loading") return "Checking account...";
  if (state.state === "claiming") return "Saving to account...";
  if (state.state === "starting-sign-in") return "Starting sign-in...";
  if (state.state === "finishing-sign-in") return "Finishing sign-in...";
  if (state.state === "loading-cloud") return "Loading cloud save...";
  if (state.mode === "cloud_loaded") return "Cloud save loaded.";
  if (state.mode === "conflict") return "Choose which save to use.";
  if (state.mode === "signed_in") return "Ready to save this run.";
  return "Guest save is local to this device.";
}

export interface AccountDialogControls {
  busy: boolean;
  signedIn: boolean;
  canClaim: boolean;
  canLoadCloud: boolean;
  canKeepDevice: boolean;
  signInDisabled: boolean;
  signInLabel: string;
  /**
   * Which buttons the dialog draws at all. A control that can never fire
   * from the current state is not an affordance, it is a row of grey the
   * player has to read past, so the dialog shows the one or two moves
   * that are actually open. Refresh is a recovery control and appears
   * only when there is something to recover from.
   */
  showSignIn: boolean;
  showClaim: boolean;
  showLoadCloud: boolean;
  showRefresh: boolean;
}

export function accountDialogControls({
  state,
  signInUrl,
  pending,
  signInBlockedByEmbed = false,
}: {
  state: AccountSyncState;
  signInUrl: string;
  pending: "sign-in" | "claim" | "load" | null;
  signInBlockedByEmbed?: boolean;
}): AccountDialogControls {
  const busy =
    pending !== null ||
    state.state === "loading" ||
    state.state === "claiming" ||
    state.state === "starting-sign-in" ||
    state.state === "finishing-sign-in" ||
    state.state === "loading-cloud";
  const signedIn = state.mode !== "guest";
  const canClaim =
    !busy &&
    state.state !== "unavailable" &&
    state.mode === "signed_in" &&
    state.currentSave?.exists === true;
  const canLoadCloud =
    !busy &&
    state.state !== "unavailable" &&
    state.mode === "conflict" &&
    state.accountSave?.exists === true;
  const canKeepDevice =
    !busy && state.state !== "unavailable" && state.mode === "conflict";
  const providerReady = state.providerStatus.ready;
  const signInUrlReady = accountSignInUrlIsExpectedRoute(signInUrl);
  const embedSignInBlocked = signInBlockedByEmbed && !signedIn;
  return {
    busy,
    signedIn,
    canClaim,
    canLoadCloud,
    canKeepDevice,
    signInDisabled:
      busy ||
      signedIn ||
      embedSignInBlocked ||
      !signInUrlReady ||
      !providerReady,
    signInLabel: embedSignInBlocked
      ? "Open full page to sign in"
      : signInUrlReady && providerReady
        ? "Sign in or create account with Google"
        : "Google sign-in pending",
    showSignIn: !signedIn,
    showClaim: signedIn && state.mode !== "conflict",
    showLoadCloud: state.mode === "conflict",
    showRefresh: state.state === "error" || state.state === "unavailable",
  };
}

function SaveSummaryRow({
  label,
  summary,
}: {
  label: string;
  summary: AccountSaveSummary | null;
}) {
  return (
    <div
      style={{
        borderRadius: 10,
        border: "1px solid #344061",
        background: "#171d2b",
        padding: "10px 12px",
      }}
    >
      <strong style={{ display: "block", marginBottom: 3 }}>{label}</strong>
      <span style={{ color: "#9aa6c4", fontSize: "0.82rem" }}>
        {saveMeta(summary)}
      </span>
    </div>
  );
}

// MinePanel re-renders on every mine tick; memo keeps the closed dialog from
// re-rendering along with it.
export const AccountSyncPopup = memo(function AccountSyncPopup({
  open,
  state,
  onClose,
  onRefresh,
  onStartSignIn,
  onClaim,
  onLoadCloud,
}: {
  open: boolean;
  state: AccountSyncState;
  onClose: () => void;
  onRefresh: () => void;
  onStartSignIn: () => Promise<AccountHandoffStart | null>;
  onClaim: () => Promise<boolean>;
  onLoadCloud: () => Promise<boolean>;
}) {
  const [pending, setPending] = useState<"sign-in" | "claim" | "load" | null>(
    null,
  );
  const [signInBlockedByEmbed, setSignInBlockedByEmbed] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);

  useFocusTrap(open, dialogRef);

  useEffect(() => {
    if (open) onRefresh();
  }, [open, onRefresh]);

  useEffect(() => {
    setSignInBlockedByEmbed(window.self !== window.top);
  }, []);

  useEffect(() => {
    if (!open) setPending(null);
  }, [open]);

  useEffect(() => {
    if (
      open &&
      pending === "load" &&
      state.state === "ready" &&
      state.mode === "cloud_loaded"
    ) {
      setPending(null);
      onClose();
    }
  }, [open, pending, state.state, state.mode, onClose]);

  const {
    busy,
    canClaim,
    canLoadCloud,
    canKeepDevice,
    signInDisabled,
    signInLabel,
    showSignIn,
    showClaim,
    showLoadCloud,
    showRefresh,
  } = accountDialogControls({
    state,
    signInUrl: SIGN_IN_URL,
    pending,
    signInBlockedByEmbed,
  });

  if (!open) return null;

  return (
    <DismissibleDialogFrame
      onDismiss={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-sync-title"
      style={DIALOG_BACKDROP_STYLE}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        style={{
          ...dialogCardStyle(520),
          maxHeight: "calc(100dvh - 48px)",
          overflowY: "auto",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <h2
              id="account-sync-title"
              style={{ margin: 0, fontSize: "1.25rem" }}
            >
              Account
            </h2>
            <p style={{ margin: "6px 0 0", color: "#f5c542" }}>
              {statusText(state)}
            </p>
            {state.accountEmail && (
              <p style={{ margin: "4px 0 0", color: "#9aa6c4" }}>
                {state.accountEmail}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close Account"
            onClick={onClose}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#182033",
              color: "#e6e8ee",
              fontSize: "1rem",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            X
          </button>
        </header>
        <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          <SaveSummaryRow label="This device" summary={state.currentSave} />
          {state.mode !== "guest" && (
            <SaveSummaryRow
              label="Google account"
              summary={state.accountSave}
            />
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {showSignIn && (
            <DialogActionButton
              accent={DIALOG_PRIMARY_ACCENT}
              disabled={signInDisabled}
              onClick={async () => {
                if (SIGN_IN_URL.length === 0) return;
                setPending("sign-in");
                const handoff = await onStartSignIn();
                setPending(null);
                if (!handoff) return;
                window.location.assign(
                  accountSignInRedirectUrl({
                    signInUrl: SIGN_IN_URL,
                    origin: window.location.origin,
                    handoff,
                  }),
                );
              }}
            >
              {signInLabel}
            </DialogActionButton>
          )}
          {showClaim && (
            <DialogActionButton
              accent={DIALOG_PRIMARY_ACCENT}
              disabled={!canClaim}
              onClick={async () => {
                setPending("claim");
                await onClaim();
                setPending(null);
              }}
            >
              Save this run
            </DialogActionButton>
          )}
          {showLoadCloud && (
            <DialogActionButton
              accent={DIALOG_PRIMARY_ACCENT}
              disabled={!canLoadCloud}
              onClick={async () => {
                setPending("load");
                const loaded = await onLoadCloud();
                setPending(null);
                if (loaded) onClose();
              }}
            >
              Load cloud save
            </DialogActionButton>
          )}
          {canKeepDevice && (
            <DialogActionButton
              accent={DIALOG_QUIET_ACCENT}
              disabled={busy}
              onClick={onClose}
            >
              Keep this device save
            </DialogActionButton>
          )}
          {showRefresh && (
            <DialogActionButton
              accent={DIALOG_QUIET_ACCENT}
              disabled={busy}
              onClick={onRefresh}
            >
              Refresh
            </DialogActionButton>
          )}
        </div>
      </section>
    </DismissibleDialogFrame>
  );
});
