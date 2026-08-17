"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/** Big-tap-target sheet row: icon tile, label, action button. */
export function SheetRow({
  icon,
  name,
  sub,
  badge,
  action,
}: {
  icon: string;
  name: string;
  sub?: string;
  badge?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "42px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid rgba(38, 48, 74, 0.55)",
      }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          background: "rgba(38, 48, 74, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.2rem",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{ display: "block", fontSize: "0.95rem", fontWeight: 600 }}
        >
          {name}
          {badge && (
            <span
              style={{
                marginLeft: 8,
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "#54e0c7",
              }}
            >
              {badge}
            </span>
          )}
        </span>
        {sub && (
          <span
            style={{
              display: "block",
              marginTop: 2,
              fontSize: "0.72rem",
              opacity: 0.62,
            }}
          >
            {sub}
          </span>
        )}
      </span>
      {action}
    </div>
  );
}

export const sheetButtonStyle = (enabled: boolean): CSSProperties => ({
  minWidth: 78,
  minHeight: 42,
  borderRadius: 12,
  border: "1px solid #2c3a5c",
  background: enabled ? "#1d2738" : "rgba(29, 39, 56, 0.4)",
  color: enabled ? "#e6e8ee" : "rgba(230, 232, 238, 0.35)",
  fontWeight: 700,
  fontSize: "0.9rem",
});

/** The one read of the motion preference for the mine's 2D chrome. The
 * canvases use `usePrefersReducedMotion`, which lives next to the R3F
 * scene; the panel cannot import that module without pulling three into
 * its bundle, so the plain query lives here instead of being spelled out
 * at each call site. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function hapticsAllowed(): boolean {
  return !prefersReducedMotion();
}

export function triggerShopHaptic(kind: "press" | "commit" | "deny"): void {
  if (!hapticsAllowed()) return;
  const vibrate = navigator.vibrate?.bind(navigator);
  if (!vibrate) return;
  if (kind === "press") vibrate(12);
  else if (kind === "commit") vibrate([18, 24, 34]);
  else vibrate([28, 18, 28]);
}

const HOLD_TO_BUY_MS = 720;

export function HoldToBuyButton({
  label,
  disabled,
  onCommit,
  ariaLabel,
}: {
  label: string;
  disabled: boolean;
  onCommit: () => void;
  ariaLabel: string;
}) {
  const [holding, setHolding] = useState(false);
  const [committed, setCommitted] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearHold = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHolding(false);
  }, []);

  const beginHold = useCallback(() => {
    if (disabled || timerRef.current !== null) return;
    triggerShopHaptic("press");
    setCommitted(false);
    setHolding(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      setCommitted(true);
      onCommit();
      window.setTimeout(() => setCommitted(false), 520);
    }, HOLD_TO_BUY_MS);
  }, [disabled, onCommit]);

  useEffect(() => clearHold, [clearHold]);

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        beginHold();
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        clearHold();
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        clearHold();
      }}
      onKeyDown={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        beginHold();
      }}
      onKeyUp={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        clearHold();
      }}
      style={{
        ...sheetButtonStyle(!disabled),
        position: "relative",
        overflow: "hidden",
        minWidth: 118,
        borderColor: committed ? "#f5c542" : disabled ? "#2c3a5c" : "#54e0c7",
        background: disabled
          ? "rgba(29, 39, 56, 0.4)"
          : "linear-gradient(180deg, rgba(30, 54, 61, 0.96), rgba(29, 39, 56, 0.96))",
        boxShadow: committed
          ? "0 0 22px rgba(245, 197, 66, 0.28)"
          : "0 8px 20px rgba(0, 0, 0, 0.18)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: holding ? "100%" : committed ? "100%" : "0%",
          background: committed
            ? "rgba(245, 197, 66, 0.28)"
            : "rgba(84, 224, 199, 0.26)",
          transition: holding
            ? `width ${HOLD_TO_BUY_MS}ms linear`
            : "width 140ms ease",
        }}
      />
      <span style={{ position: "relative" }}>
        {disabled ? label : holding ? "Hold..." : committed ? "Buying" : label}
      </span>
    </button>
  );
}
