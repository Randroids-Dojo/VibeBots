"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 60_000;
const APP_VERSION_MARKER = /data-vibebots-app-version="([^"]+)"/;

function versionFromPayload(payload: unknown): string | null {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "version" in payload &&
    typeof payload.version === "string"
  ) {
    return payload.version;
  }
  return null;
}

function versionFromDocument(html: string): string | null {
  return APP_VERSION_MARKER.exec(html)?.[1] ?? null;
}

function cacheBustedMineUrl(paramName: string, value: string): URL {
  const url = new URL(window.location.href);
  url.searchParams.set(paramName, value);
  return url;
}

async function refreshableVersion(): Promise<string | null> {
  const url = cacheBustedMineUrl("vibebots_version_probe", String(Date.now()));
  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      accept: "text/html",
      "x-vibebots-version-probe": "1",
    },
  });
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return null;
  return versionFromDocument(await res.text());
}

export function VersionRefreshPrompt({
  currentVersion,
}: {
  currentVersion: string;
}) {
  const [staleVersion, setStaleVersion] = useState<string | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const gamepadDismissPressedRef = useRef(false);
  const dismiss = useCallback(() => {
    setStaleVersion((version) => {
      if (version) setDismissedVersion(version);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!currentVersion || currentVersion === "dev") return;

    let cancelled = false;
    let checking = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function checkVersion() {
      if (checking) return;
      checking = true;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const version = versionFromPayload(await res.json());
        if (
          !version ||
          version === "dev" ||
          version === currentVersion ||
          version === dismissedVersion
        ) {
          return;
        }
        const documentVersion = await refreshableVersion();
        if (documentVersion !== version) return;
        if (!cancelled) setStaleVersion(version);
      } catch {
        return;
      } finally {
        checking = false;
      }
    }

    function checkWhenVisible() {
      if (document.visibilityState === "visible") void checkVersion();
    }

    checkWhenVisible();
    interval = setInterval(() => void checkVersion(), POLL_INTERVAL_MS);
    window.addEventListener("focus", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      window.removeEventListener("focus", checkWhenVisible);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [currentVersion, dismissedVersion]);

  useEffect(() => {
    if (!staleVersion) {
      gamepadDismissPressedRef.current = false;
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dismiss();
    };
    window.addEventListener("keydown", onKey);
    let frame = 0;
    const pollGamepadDismiss = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const dismissPressed = pads.some(
        (pad) =>
          Boolean(pad?.buttons[1]?.pressed) ||
          Boolean(pad?.buttons[8]?.pressed),
      );
      if (dismissPressed && !gamepadDismissPressedRef.current) dismiss();
      gamepadDismissPressedRef.current = dismissPressed;
      frame = requestAnimationFrame(pollGamepadDismiss);
    };
    frame = requestAnimationFrame(pollGamepadDismiss);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(frame);
    };
  }, [dismiss, staleVersion]);

  if (!staleVersion) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="version-refresh-title"
      aria-describedby="version-refresh-description"
      aria-live="polite"
      data-version-refresh-prompt={staleVersion}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          position: "absolute",
          top: 12,
          left: "50%",
          width: "min(92vw, 420px)",
          transform: "translateX(-50%)",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          alignItems: "center",
          gap: 12,
          border: "1px solid #54e0c7",
          borderRadius: 8,
          background: "rgba(17, 21, 31, 0.97)",
          boxShadow: "0 16px 42px rgba(0, 0, 0, 0.42)",
          color: "#e6e8ee",
          padding: "12px 14px",
        }}
      >
        <div>
          <h2
            id="version-refresh-title"
            style={{
              margin: 0,
              color: "#54e0c7",
              fontSize: "0.95rem",
              lineHeight: 1.2,
            }}
          >
            New version available
          </h2>
          <p
            id="version-refresh-description"
            style={{
              margin: "4px 0 0",
              color: "#cdd6ea",
              fontSize: "0.78rem",
              lineHeight: 1.3,
            }}
          >
            Refresh to load the latest VibeBots build.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            window.history.scrollRestoration = "manual";
            window.scrollTo(0, 0);
            window.location.replace(
              cacheBustedMineUrl("vibebots_refresh", staleVersion).toString(),
            );
          }}
          style={{
            minHeight: 38,
            borderRadius: 8,
            border: "1px solid #54e0c7",
            background: "#123833",
            color: "#9ff4e6",
            cursor: "pointer",
            fontSize: "0.8rem",
            fontWeight: 800,
            padding: "0 14px",
          }}
        >
          Refresh
        </button>
      </section>
    </div>
  );
}
