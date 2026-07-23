"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Floating "back to the mine village" control for screens entered from
 * the surface (Workshop, Battles, Holodeck). With the top nav gone, the
 * mine surface is the overworld hub and every other screen returns to it.
 *
 * Keyboard players also press Escape to return (F-062). The handler bows
 * out when a dialog, a text field, or another handler is already using
 * Escape, so it only fires the return from the plain building view.
 */
export function BackToMine() {
  const router = useRouter();
  const linkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const link = linkRef.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      // A modal open on this screen owns Escape for its own close.
      if (
        document.querySelector(
          '[role="dialog"], [aria-modal="true"], dialog[open]',
        )
      ) {
        return;
      }
      event.preventDefault();
      router.push("/mine");
    };
    window.addEventListener("keydown", onKey);
    link?.setAttribute("data-escape-ready", "true");
    return () => {
      window.removeEventListener("keydown", onKey);
      link?.removeAttribute("data-escape-ready");
    };
  }, [router]);

  return (
    <Link
      ref={linkRef}
      href="/mine"
      aria-label="Back to mine"
      aria-keyshortcuts="Escape"
      style={{
        position: "absolute",
        top: 14,
        left: 16,
        zIndex: 10,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderRadius: 999,
        border: "2px solid #54e0c7",
        background: "rgba(17, 21, 31, 0.92)",
        color: "#54e0c7",
        fontWeight: 700,
        fontSize: "0.9rem",
        textDecoration: "none",
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.45)",
      }}
    >
      <span aria-hidden>{"⛏\u{FE0F}"}</span> Back to mine
    </Link>
  );
}
