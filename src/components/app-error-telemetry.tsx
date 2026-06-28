"use client";

import { useEffect, useRef } from "react";

type ClientErrorCode =
  | "react_error_boundary"
  | "global_error"
  | "unhandled_rejection";

type ClientErrorSource = "app" | "global" | "window";

interface ClientErrorPayload {
  code: ClientErrorCode;
  source: ClientErrorSource;
  appVersion?: string;
  path?: string;
  message?: string;
  digest?: string | null;
  stack?: string;
}

function appVersion(): string | undefined {
  const value = document
    .querySelector("[data-vibebots-app-version]")
    ?.getAttribute("data-vibebots-app-version");
  return value || undefined;
}

function bounded(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined;
  return value.length > limit ? value.slice(0, limit) : value;
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  return "Unknown client error";
}

function errorStack(reason: unknown): string | undefined {
  return reason instanceof Error ? reason.stack : undefined;
}

function postClientError(payload: ClientErrorPayload): void {
  const body = JSON.stringify({
    ...payload,
    appVersion: payload.appVersion ?? appVersion(),
    path: payload.path ?? window.location.pathname,
    message: bounded(payload.message, 500),
    stack: bounded(payload.stack, 2_000),
  });
  fetch("/api/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body,
  }).catch(() => {});
}

export function reportClientError(payload: ClientErrorPayload): void {
  postClientError(payload);
}

export function ClientErrorTelemetry() {
  const loggedKeysRef = useRef(new Set<string>());

  useEffect(() => {
    const logOnce = (
      code: ClientErrorCode,
      reason: unknown,
      digest?: string | null,
    ) => {
      const message = errorMessage(reason);
      const key = `${code}:${window.location.pathname}:${message}:${digest ?? ""}`;
      if (loggedKeysRef.current.has(key)) return;
      loggedKeysRef.current.add(key);
      postClientError({
        code,
        source: "window",
        message,
        digest,
        stack: errorStack(reason),
      });
    };

    const handleError = (event: ErrorEvent) => {
      logOnce("global_error", event.error ?? event.message);
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      logOnce("unhandled_rejection", event.reason);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
