"use client";

import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 60_000;
const INITIAL_DELAY_MS = 30_000;

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

export function VersionRefreshPrompt({
  currentVersion,
}: {
  currentVersion: string;
}) {
  const [staleVersion, setStaleVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!currentVersion || currentVersion === "dev") return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function checkVersion() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const version = versionFromPayload(await res.json());
        if (!version || version === "dev" || version === currentVersion) {
          return;
        }
        if (!cancelled) setStaleVersion(version);
      } catch {
        return;
      }
    }

    const initial = setTimeout(() => {
      void checkVersion();
      interval = setInterval(() => void checkVersion(), POLL_INTERVAL_MS);
    }, INITIAL_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(initial);
      if (interval) clearInterval(interval);
    };
  }, [currentVersion]);

  if (!staleVersion) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="version-refresh-title"
      aria-describedby="version-refresh-description"
      aria-live="polite"
      data-version-refresh-prompt={staleVersion}
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        zIndex: 80,
        width: "min(92vw, 420px)",
        transform: "translateX(-50%)",
        border: "1px solid #54e0c7",
        borderRadius: 8,
        background: "rgba(17, 21, 31, 0.97)",
        boxShadow: "0 16px 42px rgba(0, 0, 0, 0.42)",
        color: "#e6e8ee",
        padding: "12px 14px",
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          alignItems: "center",
          gap: 12,
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
          onClick={() => window.location.reload()}
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
      </div>
    </div>
  );
}
