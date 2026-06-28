"use client";

import { useEffect, useMemo, useRef } from "react";
import { reportClientError } from "./app-error-telemetry";

type BoundaryError = Error & { digest?: string };

export function AppErrorScreen({
  error,
  reset,
  source,
}: {
  error: BoundaryError;
  reset?: () => void;
  source: "app" | "global";
}) {
  const loggedRef = useRef(false);
  const digest = error.digest ?? null;
  const supportCode = useMemo(() => {
    if (digest) return digest.slice(0, 12);
    let hash = 0;
    const input = `${error.name}:${error.message}`;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16).padStart(8, "0").slice(0, 12);
  }, [digest, error.message, error.name]);

  useEffect(() => {
    if (loggedRef.current) return;
    loggedRef.current = true;
    reportClientError({
      code: "react_error_boundary",
      source,
      message: error.message || "React error boundary rendered",
      digest,
      stack: error.stack,
    });
  }, [digest, error.message, error.stack, source]);

  const reload = () => window.location.reload();
  const goMine = () => {
    window.location.assign("/mine");
  };

  return (
    <main className="app-error-screen">
      <section className="app-error-panel" aria-labelledby="app-error-title">
        <div className="app-error-mark" aria-hidden="true">
          !
        </div>
        <div className="app-error-copy">
          <p className="app-error-kicker">VibeBots</p>
          <h1 id="app-error-title">Something broke on this screen</h1>
          <p>
            The crash was logged. Reload the game, or return to the mine if this
            screen keeps failing.
          </p>
          <p className="app-error-code">Code {supportCode}</p>
        </div>
        <div className="app-error-actions">
          {reset && (
            <button
              type="button"
              className="app-error-action-primary"
              onClick={reset}
            >
              Try again
            </button>
          )}
          <button
            type="button"
            className="app-error-action-secondary"
            onClick={reload}
          >
            Reload
          </button>
          <button
            type="button"
            className="app-error-action-secondary"
            onClick={goMine}
          >
            Mine
          </button>
        </div>
      </section>
    </main>
  );
}
