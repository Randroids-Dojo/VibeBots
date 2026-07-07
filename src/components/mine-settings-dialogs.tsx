"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FEEDBACK_CATEGORY_OPTIONS,
  type FeedbackCategory,
} from "@/lib/feedback";
import {
  PERF_ANALYZER_CHANGED_EVENT,
  perfAnalyzerEnabled,
  persistPerfAnalyzerEnabled,
} from "@/lib/perf-analyzer-settings";
import { MINE_VERSION } from "@/sim/mine";
import { useMineStore } from "@/state/mine-store";
import { DismissibleDialogFrame } from "./dismissible-dialog-frame";

const FALLING_ROCK_ALERT_DISMISSED_KEY =
  "vibebots-falling-rock-alert-dismissed";
const LADDER_GRAVITY_FEEDBACK_NEVER_KEY =
  "vibebots-ladder-gravity-feedback-never";
const IOS_HOME_SCREEN_PROMPT_NEVER_KEY =
  "vibebots-ios-home-screen-prompt-never";

interface NotificationConfig {
  configured: boolean;
  vapidPublicKey: string | null;
  releaseNoticeId: string;
  releaseSummary: string;
}

type NotificationUiState =
  | "checking"
  | "unsupported"
  | "ios-install"
  | "unconfigured"
  | "default"
  | "enabled"
  | "denied"
  | "saving"
  | "error";

type FeedbackSource = "pause" | "ladder-gravity";

export interface FeedbackContext {
  source: FeedbackSource;
  prompt?: string;
}

function isIosDevice(): boolean {
  const platform = navigator.platform;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandaloneWebApp(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

function isMobileSafari(): boolean {
  const userAgent = navigator.userAgent;
  return (
    isIosDevice() &&
    /Safari/.test(userAgent) &&
    !/(CriOS|FxiOS|EdgiOS|OPiOS)/.test(userAgent)
  );
}

function notificationPlatform(): string {
  if (isIosDevice()) return "ios";
  if (/Android/.test(navigator.userAgent)) return "android";
  return "desktop";
}

function pushApiSupported(): boolean {
  return (
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

async function loadNotificationConfig(): Promise<NotificationConfig> {
  const res = await fetch("/api/notifications/config", { cache: "no-store" });
  if (!res.ok) throw new Error("notification config unavailable");
  return res.json() as Promise<NotificationConfig>;
}
export function FallingRockHazardAlert() {
  const lastResult = useMineStore((s) => s.lastResult);
  const [visible, setVisible] = useState(false);
  const [suppressedForSession, setSuppressedForSession] = useState(false);

  useEffect(() => {
    if (!lastResult?.ok || !lastResult.fallingRockTriggered) return;
    if (suppressedForSession) return;
    try {
      if (localStorage.getItem(FALLING_ROCK_ALERT_DISMISSED_KEY) === "true") {
        return;
      }
    } catch {
      // Storage blocked: keep showing until this session suppresses it.
    }
    setVisible(true);
  }, [lastResult, suppressedForSession]);

  if (!visible) return null;

  const dismiss = () => setVisible(false);
  const neverShowAgain = () => {
    try {
      localStorage.setItem(FALLING_ROCK_ALERT_DISMISSED_KEY, "true");
    } catch {
      setSuppressedForSession(true);
    }
    setVisible(false);
  };

  return (
    <DismissibleDialogFrame
      onDismiss={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="falling-rock-alert-title"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 34,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(5, 8, 13, 0.6)",
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          width: "min(92vw, 360px)",
          border: "1px solid #f5c542",
          borderRadius: 12,
          background: "rgba(17, 21, 31, 0.97)",
          boxShadow: "0 18px 54px rgba(0, 0, 0, 0.52)",
          color: "#e6e8ee",
          padding: "16px 18px",
        }}
      >
        <h2
          id="falling-rock-alert-title"
          style={{
            margin: 0,
            color: "#f5c542",
            fontSize: "1.02rem",
            lineHeight: 1.2,
          }}
        >
          Falling rock
        </h2>
        <p
          style={{
            margin: "10px 0 14px",
            color: "#dce5f7",
            fontSize: "0.92rem",
            lineHeight: 1.4,
          }}
        >
          The miner must avoid being under the rock in the next 2 turns.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={dismiss}
            style={{
              flex: "1 1 88px",
              minHeight: 40,
              borderRadius: 10,
              border: "1px solid #54e0c7",
              background: "#173033",
              color: "#54e0c7",
              fontSize: "0.9rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Ok
          </button>
          <button
            type="button"
            onClick={neverShowAgain}
            style={{
              flex: "1 1 150px",
              minHeight: 40,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#20283a",
              color: "#e6e8ee",
              fontSize: "0.9rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Never Show Again
          </button>
        </div>
      </section>
    </DismissibleDialogFrame>
  );
}

export function LadderGravityFeedbackPrompt({
  appVersion,
  onFeedbackNow,
}: {
  appVersion: string;
  onFeedbackNow: () => void;
}) {
  const lastResult = useMineStore((s) => s.lastResult);
  const [visible, setVisible] = useState(false);
  const [suppressedForSession, setSuppressedForSession] = useState(false);

  useEffect(() => {
    if (!lastResult?.ok || !lastResult.ladderFalls?.length) return;
    if (suppressedForSession) return;
    try {
      if (localStorage.getItem(LADDER_GRAVITY_FEEDBACK_NEVER_KEY) === "true") {
        return;
      }
    } catch {
      // Storage blocked: keep the prompt session-scoped.
    }
    const timer = setTimeout(() => setVisible(true), 1100);
    return () => clearTimeout(timer);
  }, [lastResult, suppressedForSession]);

  if (!visible) return null;

  const dismiss = () => setVisible(false);
  const neverShowAgain = () => {
    try {
      localStorage.setItem(LADDER_GRAVITY_FEEDBACK_NEVER_KEY, "true");
    } catch {
      setSuppressedForSession(true);
    }
    setVisible(false);
  };
  const feedbackNow = () => {
    setVisible(false);
    onFeedbackNow();
  };

  return (
    <DismissibleDialogFrame
      onDismiss={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ladder-gravity-feedback-title"
      data-app-version={appVersion}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 35,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(5, 8, 13, 0.62)",
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          width: "min(92vw, 390px)",
          border: "1px solid #f0c36b",
          borderRadius: 12,
          background: "rgba(17, 21, 31, 0.98)",
          boxShadow: "0 18px 54px rgba(0, 0, 0, 0.54)",
          color: "#e6e8ee",
          padding: "16px 18px",
        }}
      >
        <h2
          id="ladder-gravity-feedback-title"
          style={{
            margin: 0,
            color: "#f0c36b",
            fontSize: "1.02rem",
            lineHeight: 1.2,
          }}
        >
          Ladders can fall now
        </h2>
        <p
          style={{
            margin: "10px 0 14px",
            color: "#dce5f7",
            fontSize: "0.92rem",
            lineHeight: 1.4,
          }}
        >
          A ladder you unsupported just slid down the shaft. How does this new
          mechanic feel?
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={dismiss}
            style={{
              flex: "1 1 64px",
              minHeight: 40,
              borderRadius: 10,
              border: "1px solid #54e0c7",
              background: "#173033",
              color: "#54e0c7",
              fontSize: "0.88rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Ok
          </button>
          <button
            type="button"
            onClick={feedbackNow}
            style={{
              flex: "1 1 138px",
              minHeight: 40,
              borderRadius: 10,
              border: "1px solid #f5c542",
              background: "#2d2616",
              color: "#f5c542",
              fontSize: "0.88rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Give Feedback Now
          </button>
          <button
            type="button"
            onClick={neverShowAgain}
            style={{
              flex: "1 1 148px",
              minHeight: 40,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#20283a",
              color: "#e6e8ee",
              fontSize: "0.88rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Never Show Again
          </button>
        </div>
      </section>
    </DismissibleDialogFrame>
  );
}

export function FeedbackDialog({
  open,
  context,
  appVersion,
  onClose,
}: {
  open: boolean;
  context: FeedbackContext;
  appVersion: string;
  onClose: () => void;
}) {
  const mine = useMineStore((s) => s.mine);
  const [category, setCategory] = useState<FeedbackCategory>(
    context.source === "ladder-gravity" ? "confusing" : "bug",
  );
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCategory(context.source === "ladder-gravity" ? "confusing" : "bug");
    setComment("");
    setEmail("");
    setState("idle");
    setMessage(null);
  }, [open, context.source]);

  if (!open) return null;

  const close = () => {
    if (state === "saving") return;
    onClose();
  };

  const submit = async () => {
    if (state === "saving") return;
    setState("saving");
    setMessage(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          comment,
          email,
          context: {
            source: context.source,
            prompt: context.prompt,
            appVersion,
            mineVersion: MINE_VERSION,
            depth: mine.miner.row,
            column: mine.miner.col,
          },
        }),
      });
      if (!res.ok) throw new Error("feedback unavailable");
      setState("saved");
      setMessage("Feedback saved. Thank you.");
    } catch {
      setState("error");
      setMessage("Could not save feedback. Try again later.");
    }
  };

  return (
    <DismissibleDialogFrame
      active={state !== "saving"}
      onDismiss={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 38,
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
          maxHeight: "calc(100dvh - 42px)",
          overflowY: "auto",
          borderRadius: 12,
          border: "1px solid #54e0c7",
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
            <h2 id="feedback-title" style={{ margin: 0, fontSize: "1.18rem" }}>
              Feedback
            </h2>
            {context.source === "ladder-gravity" && (
              <p style={{ margin: "6px 0 0", color: "#f5c542" }}>
                Ladder gravity mechanic
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close feedback"
            disabled={state === "saving"}
            onClick={close}
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#182033",
              color: "#e6e8ee",
              fontSize: "1rem",
              fontWeight: 900,
              cursor: state === "saving" ? "progress" : "pointer",
            }}
          >
            X
          </button>
        </header>
        <label
          style={{
            display: "grid",
            gap: 6,
            marginTop: 10,
            color: "#cdd6ea",
            fontSize: "0.84rem",
            fontWeight: 800,
          }}
        >
          Common feedback
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as FeedbackCategory)
            }
            disabled={state === "saving" || state === "saved"}
            style={{
              width: "100%",
              minHeight: 44,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#121827",
              color: "#e6e8ee",
              fontSize: "1rem",
              padding: "0 10px",
            }}
          >
            {FEEDBACK_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label
          style={{
            display: "grid",
            gap: 6,
            marginTop: 12,
            color: "#cdd6ea",
            fontSize: "0.84rem",
            fontWeight: 800,
          }}
        >
          Comment
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={state === "saving" || state === "saved"}
            maxLength={2000}
            rows={5}
            style={{
              width: "100%",
              minHeight: 124,
              resize: "vertical",
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#121827",
              color: "#e6e8ee",
              fontSize: "1rem",
              lineHeight: 1.4,
              padding: 10,
              userSelect: "text",
              WebkitUserSelect: "text",
            }}
          />
        </label>
        <label
          style={{
            display: "grid",
            gap: 6,
            marginTop: 12,
            color: "#cdd6ea",
            fontSize: "0.84rem",
            fontWeight: 800,
          }}
        >
          Email (optional)
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={state === "saving" || state === "saved"}
            style={{
              width: "100%",
              minHeight: 44,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#121827",
              color: "#e6e8ee",
              fontSize: "1rem",
              padding: "0 10px",
              userSelect: "text",
              WebkitUserSelect: "text",
            }}
          />
        </label>
        {message && (
          <p
            role="status"
            style={{
              margin: "12px 0 0",
              color: state === "error" ? "#ff8a8a" : "#54e0c7",
              fontSize: "0.88rem",
              fontWeight: 800,
            }}
          >
            {message}
          </p>
        )}
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 16,
          }}
        >
          <button
            type="button"
            onClick={() => void submit()}
            disabled={state === "saving" || state === "saved"}
            style={{
              flex: "1 1 160px",
              minHeight: 44,
              borderRadius: 10,
              border: "1px solid #54e0c7",
              background: "#173033",
              color: "#54e0c7",
              fontSize: "0.94rem",
              fontWeight: 900,
              cursor:
                state === "saving" || state === "saved"
                  ? "not-allowed"
                  : "pointer",
              opacity: state === "saving" || state === "saved" ? 0.72 : 1,
            }}
          >
            {state === "saving" ? "Saving..." : "Submit feedback"}
          </button>
          <button
            type="button"
            onClick={close}
            disabled={state === "saving"}
            style={{
              flex: "1 1 100px",
              minHeight: 44,
              borderRadius: 10,
              border: "1px solid #384564",
              background: "#20283a",
              color: "#e6e8ee",
              fontSize: "0.94rem",
              fontWeight: 800,
              cursor: state === "saving" ? "progress" : "pointer",
            }}
          >
            Close
          </button>
        </div>
      </section>
    </DismissibleDialogFrame>
  );
}

export function CreditsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <DismissibleDialogFrame
      onDismiss={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="credits-title"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 38,
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
          width: "min(440px, 100%)",
          borderRadius: 12,
          border: "1px solid #f0c36b",
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
            <p
              style={{
                margin: "0 0 4px",
                color: "#f0c36b",
                fontSize: "0.78rem",
                fontWeight: 900,
                letterSpacing: 0,
                textTransform: "uppercase",
              }}
            >
              Special thanks
            </p>
            <h2 id="credits-title" style={{ margin: 0, fontSize: "1.18rem" }}>
              Credits
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close credits"
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
        <p
          style={{
            margin: "0 0 14px",
            color: "#dce5f7",
            fontSize: "0.98rem",
            lineHeight: 1.45,
          }}
        >
          Thank you to Mason and MJ Lutcavich for testing VibeBots, sharing
          feedback, and bringing great ideas to the mine.
        </p>
        <p
          style={{
            margin: "0 0 16px",
            color: "#9fa9bf",
            fontSize: "0.86rem",
            lineHeight: 1.4,
          }}
        >
          Your play sessions are helping shape what the robots dig, build, and
          survive next.
        </p>
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            minHeight: 44,
            borderRadius: 10,
            border: "1px solid #f0c36b",
            background: "#2d2616",
            color: "#f0c36b",
            fontSize: "0.94rem",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Back to the mine
        </button>
      </section>
    </DismissibleDialogFrame>
  );
}

export function IosHomeScreenPrompt({ disabled }: { disabled: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (disabled) {
      setVisible(false);
      return;
    }
    if (localStorage.getItem(IOS_HOME_SCREEN_PROMPT_NEVER_KEY) === "1") {
      return;
    }
    if (!isMobileSafari() || isStandaloneWebApp()) {
      return;
    }
    setVisible(true);
  }, [disabled]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
  };

  const dismissForever = () => {
    localStorage.setItem(IOS_HOME_SCREEN_PROMPT_NEVER_KEY, "1");
    setVisible(false);
  };

  return (
    <DismissibleDialogFrame
      onDismiss={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ios-home-screen-prompt-title"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 29,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(5, 8, 13, 0.5)",
        pointerEvents: "auto",
      }}
    >
      <section
        style={{
          width: "min(92vw, 350px)",
          border: "1px solid #f5c542",
          borderRadius: 12,
          background: "rgba(17, 21, 31, 0.97)",
          boxShadow: "0 18px 54px rgba(0, 0, 0, 0.52)",
          color: "#e6e8ee",
          padding: "16px 18px",
        }}
      >
        <h2
          id="ios-home-screen-prompt-title"
          style={{
            margin: "0 0 8px",
            color: "#f5c542",
            fontSize: "1rem",
            lineHeight: 1.2,
          }}
        >
          Add VibeBots to Home Screen
        </h2>
        <p
          style={{
            margin: "0 0 10px",
            color: "#dce5f7",
            fontSize: "0.88rem",
            lineHeight: 1.35,
          }}
        >
          Mobile Safari needs the Home Screen app before notifications can work.
          Tap Share, then Add to Home Screen.
        </p>
        <p
          style={{
            margin: "0 0 14px",
            color: "#aab3c8",
            fontSize: "0.76rem",
            lineHeight: 1.3,
          }}
        >
          Safari does not let websites open that sheet automatically.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={dismiss}
            style={{
              width: "100%",
              minHeight: 42,
              borderRadius: 10,
              border: "1px solid #f5c542",
              background: "#2d2616",
              color: "#f5c542",
              fontSize: "0.9rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Ok
          </button>
          <button
            type="button"
            onClick={dismissForever}
            style={{
              width: "100%",
              minHeight: 42,
              borderRadius: 10,
              border: "1px solid #8b93a7",
              background: "#20283a",
              color: "#e6e8ee",
              fontSize: "0.86rem",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Never show again
          </button>
        </div>
      </section>
    </DismissibleDialogFrame>
  );
}

/**
 * Opt-in deep performance telemetry toggle (F-054). Flipping it on
 * starts the live collector immediately via the changed event; GPU
 * pass timings additionally require a canvas created after the toggle
 * was on (the next visit), which the note explains.
 */
export function PerfTelemetryControl() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const refresh = () => setEnabled(perfAnalyzerEnabled());
    refresh();
    window.addEventListener(PERF_ANALYZER_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PERF_ANALYZER_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const toggle = () => {
    const next = !enabled;
    persistPerfAnalyzerEnabled(next);
    setEnabled(next);
    window.dispatchEvent(new Event(PERF_ANALYZER_CHANGED_EVENT));
  };

  return (
    <section
      aria-label="Performance telemetry"
      style={{ display: "grid", gap: 6, marginTop: 8 }}
    >
      <button
        type="button"
        aria-pressed={enabled}
        data-perf-telemetry-toggle
        onClick={toggle}
        style={{
          width: "100%",
          minHeight: 40,
          borderRadius: 10,
          border: "1px solid #cdd6ea",
          background: enabled ? "#21301f" : "#20283a",
          color: enabled ? "#8ee06f" : "#e6e8ee",
          fontSize: "0.86rem",
          fontWeight: 800,
          cursor: "pointer",
        }}
      >
        {enabled ? "Performance telemetry on" : "Enable performance telemetry"}
      </button>
      <p
        style={{
          margin: 0,
          color: "#aab3c8",
          fontSize: "0.72rem",
          lineHeight: 1.25,
        }}
      >
        {enabled
          ? "Recording frame timings, scene stats, network request timing, and device info to help fix slowdowns. GPU timings start on your next visit."
          : "Off by default. When on, sends frame timings, scene stats, network request timing, and device info so slowdowns on your device can be fixed."}
      </p>
    </section>
  );
}

export function ReleaseNotificationControl() {
  const [uiState, setUiState] = useState<NotificationUiState>("checking");
  const [summary, setSummary] = useState("");

  const refresh = useCallback(async () => {
    if (!pushApiSupported()) {
      setUiState("unsupported");
      return;
    }
    if (isIosDevice() && !isStandaloneWebApp()) {
      setUiState("ios-install");
      return;
    }
    const config = await loadNotificationConfig();
    setSummary(config.releaseSummary);
    if (!config.configured || !config.vapidPublicKey) {
      setUiState("unconfigured");
      return;
    }
    if (Notification.permission === "denied") {
      setUiState("denied");
      return;
    }
    if (Notification.permission !== "granted") {
      setUiState("default");
      return;
    }
    const registration = await navigator.serviceWorker.register("/sw.js");
    const subscription = await registration.pushManager.getSubscription();
    setUiState(subscription ? "enabled" : "default");
  }, []);

  useEffect(() => {
    refresh().catch(() => setUiState("error"));
  }, [refresh]);

  const enable = async () => {
    setUiState("saving");
    try {
      const config = await loadNotificationConfig();
      setSummary(config.releaseSummary);
      if (!config.configured || !config.vapidPublicKey) {
        setUiState("unconfigured");
        return;
      }
      if (Notification.permission !== "granted") {
        const permission = await Notification.requestPermission();
        if (permission === "denied") {
          setUiState("denied");
          return;
        }
        if (permission !== "granted") {
          setUiState("default");
          return;
        }
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const ready = await navigator.serviceWorker.ready;
      const existing = await ready.pushManager.getSubscription();
      const subscription =
        existing ??
        (await ready.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(config.vapidPublicKey),
        }));
      const res = await fetch("/api/notifications/subscription", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          platform: notificationPlatform(),
        }),
      });
      if (!res.ok) throw new Error("subscription save failed");
      await registration.update();
      setUiState("enabled");
    } catch {
      setUiState("error");
    }
  };

  const disable = async () => {
    setUiState("saving");
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/notifications/subscription", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setUiState(Notification.permission === "granted" ? "default" : "denied");
    } catch {
      setUiState("error");
    }
  };

  const label =
    uiState === "enabled"
      ? "Update alerts on"
      : uiState === "saving"
        ? "Saving alerts"
        : "Enable update alerts";
  const note =
    uiState === "ios-install"
      ? "On iPhone or iPad, add VibeBots to Home Screen and open it there."
      : uiState === "unsupported"
        ? "Notifications are not available in this browser."
        : uiState === "unconfigured"
          ? "Notification keys are not set on this deploy."
          : uiState === "denied"
            ? "Notifications are blocked in browser settings."
            : uiState === "enabled"
              ? "You will get one-line release summaries."
              : uiState === "error"
                ? "Could not save notification settings."
                : summary || "Get one-line release summaries.";

  return (
    <section
      aria-label="Update alerts"
      style={{
        display: "grid",
        gap: 6,
        marginTop: 8,
      }}
    >
      <button
        type="button"
        disabled={
          uiState === "checking" ||
          uiState === "saving" ||
          uiState === "unsupported" ||
          uiState === "ios-install" ||
          uiState === "unconfigured" ||
          uiState === "denied"
        }
        onClick={uiState === "enabled" ? disable : enable}
        style={{
          width: "100%",
          minHeight: 40,
          borderRadius: 10,
          border: "1px solid #cdd6ea",
          background: uiState === "enabled" ? "#21301f" : "#20283a",
          color: uiState === "enabled" ? "#8ee06f" : "#e6e8ee",
          fontSize: "0.86rem",
          fontWeight: 800,
          cursor:
            uiState === "checking" || uiState === "saving"
              ? "progress"
              : "pointer",
          opacity:
            uiState === "unsupported" ||
            uiState === "ios-install" ||
            uiState === "unconfigured" ||
            uiState === "denied"
              ? 0.68
              : 1,
        }}
      >
        {label}
      </button>
      <p
        style={{
          margin: 0,
          color: "#aab3c8",
          fontSize: "0.72rem",
          lineHeight: 1.25,
        }}
      >
        {note}
      </p>
    </section>
  );
}
