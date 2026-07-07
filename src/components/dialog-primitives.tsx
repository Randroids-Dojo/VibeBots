"use client";

import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
} from "react";

/**
 * Shared building blocks for the mine's modal dialogs (account, save
 * conflict, ...): the dimmed backdrop, the card, the accent action button,
 * and the focus trap. Dialog components own their copy and layout; the
 * shared pieces keep the look and keyboard behavior identical.
 */

export const DIALOG_BACKDROP_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 34,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "rgba(3, 6, 12, 0.72)",
  pointerEvents: "auto",
};

export function dialogCardStyle(maxWidthPx: number): CSSProperties {
  return {
    width: `min(${maxWidthPx}px, 100%)`,
    borderRadius: 12,
    border: "1px solid #384564",
    background: "rgba(16, 20, 31, 0.98)",
    boxShadow: "0 18px 60px rgba(0, 0, 0, 0.58)",
    color: "#e6e8ee",
    padding: 18,
  };
}

export function DialogActionButton({
  accent,
  disabled = false,
  onClick,
  children,
}: {
  accent: { border: string; background: string; color: string };
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        minHeight: 38,
        borderRadius: 10,
        border: `1px solid ${accent.border}`,
        background: disabled ? "#151a26" : accent.background,
        color: disabled ? "#5e6880" : accent.color,
        fontSize: "0.88rem",
        fontWeight: 800,
        cursor: disabled ? "default" : "pointer",
        padding: "0 12px",
      }}
    >
      {children}
    </button>
  );
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Given the focusable count, the currently focused item index (-1 when focus
// sits outside the dialog), and whether Shift was held, return the index Tab
// should wrap to, or null to let the browser move focus normally.
export function nextFocusTrapIndex(
  count: number,
  activeIndex: number,
  shiftKey: boolean,
): number | null {
  if (count <= 0) return null;
  const insideDialog = activeIndex >= 0;
  if (shiftKey) {
    if (!insideDialog || activeIndex === 0) return count - 1;
    return null;
  }
  if (!insideDialog || activeIndex === count - 1) return 0;
  return null;
}

export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const getFocusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const focusables = getFocusable();
    (focusables[0] ?? container).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = getFocusable();
      if (items.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const activeIndex = items.indexOf(document.activeElement as HTMLElement);
      const target = nextFocusTrapIndex(
        items.length,
        activeIndex,
        event.shiftKey,
      );
      if (target !== null) {
        event.preventDefault();
        items[target].focus();
      }
    };
    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [active, containerRef]);
}
