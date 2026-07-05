"use client";

import { useEffect, useState } from "react";
import { safeAccountReturnTo } from "@/lib/account-handoff-contract";
import type {
  AccountHandoffStart,
  AccountSaveSummary,
  AccountSyncState,
} from "@/state/mine-store";
import { DismissibleDialogFrame } from "./dismissible-dialog-frame";

const SIGN_IN_URL = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? "";

export function accountSignInUrlIsExpectedRoute(signInUrl: string): boolean {
  return signInUrl.trim() === "/sign-in";
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
    accountSignInUrlIsExpectedRoute(signInUrl) ? signInUrl.trim() : "/sign-in",
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
}

export function accountDialogControls({
  state,
  signInUrl,
  pending,
}: {
  state: AccountSyncState;
  signInUrl: string;
  pending: "sign-in" | "claim" | "load" | null;
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
  const providerReady = state.providerReady && state.providerStatus.ready;
  const signInUrlReady = accountSignInUrlIsExpectedRoute(signInUrl);
  return {
    busy,
    signedIn,
    canClaim,
    canLoadCloud,
    canKeepDevice,
    signInDisabled: busy || signedIn || !signInUrlReady || !providerReady,
    signInLabel:
      signInUrlReady && providerReady
        ? "Sign in or create account with Google"
        : "Google sign-in pending",
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

export function AccountSyncPopup({
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

  useEffect(() => {
    if (open) onRefresh();
  }, [open, onRefresh]);

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
  } = accountDialogControls({
    state,
    signInUrl: SIGN_IN_URL,
    pending,
  });

  if (!open) return null;

  return (
    <DismissibleDialogFrame
      onDismiss={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-sync-title"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 34,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(3, 6, 12, 0.72)",
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          width: "min(520px, 100%)",
          maxHeight: "calc(100dvh - 48px)",
          overflowY: "auto",
          borderRadius: 12,
          border: "1px solid #384564",
          background: "rgba(16, 20, 31, 0.98)",
          boxShadow: "0 18px 60px rgba(0, 0, 0, 0.58)",
          color: "#e6e8ee",
          padding: 18,
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
          <button
            type="button"
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
            style={{
              minHeight: 38,
              borderRadius: 10,
              border: "1px solid #cdd6ea",
              background: signInDisabled ? "#151a26" : "#20283a",
              color: signInDisabled ? "#5e6880" : "#e6e8ee",
              fontSize: "0.88rem",
              fontWeight: 800,
              cursor: signInDisabled ? "default" : "pointer",
              padding: "0 12px",
            }}
          >
            {signInLabel}
          </button>
          <button
            type="button"
            disabled={!canClaim}
            onClick={async () => {
              setPending("claim");
              await onClaim();
              setPending(null);
            }}
            style={{
              minHeight: 38,
              borderRadius: 10,
              border: "1px solid #54e0c7",
              background: canClaim ? "#172b30" : "#151a26",
              color: canClaim ? "#54e0c7" : "#5e6880",
              fontSize: "0.88rem",
              fontWeight: 800,
              cursor: canClaim ? "pointer" : "default",
              padding: "0 12px",
            }}
          >
            Save this run
          </button>
          <button
            type="button"
            disabled={!canLoadCloud}
            onClick={async () => {
              setPending("load");
              const loaded = await onLoadCloud();
              setPending(null);
              if (loaded) onClose();
            }}
            style={{
              minHeight: 38,
              borderRadius: 10,
              border: "1px solid #f0c36b",
              background: canLoadCloud ? "#2d2616" : "#151a26",
              color: canLoadCloud ? "#f0c36b" : "#5e6880",
              fontSize: "0.88rem",
              fontWeight: 800,
              cursor: canLoadCloud ? "pointer" : "default",
              padding: "0 12px",
            }}
          >
            Load cloud save
          </button>
          {canKeepDevice && (
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              style={{
                minHeight: 38,
                borderRadius: 10,
                border: "1px solid #72809b",
                background: busy ? "#151a26" : "#1a2030",
                color: busy ? "#5e6880" : "#d8deec",
                fontSize: "0.88rem",
                fontWeight: 800,
                cursor: busy ? "default" : "pointer",
                padding: "0 12px",
              }}
            >
              Keep this device save
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onRefresh}
            style={{
              minHeight: 38,
              borderRadius: 10,
              border: "1px solid #9fb6ff",
              background: busy ? "#151a26" : "#1c2440",
              color: busy ? "#5e6880" : "#c7d4ff",
              fontSize: "0.88rem",
              fontWeight: 800,
              cursor: busy ? "default" : "pointer",
              padding: "0 12px",
            }}
          >
            Refresh
          </button>
        </div>
      </section>
    </DismissibleDialogFrame>
  );
}
