"use client";

import { useEffect } from "react";

/**
 * Runs the handler whenever the page returns to the foreground: window
 * focus, pageshow (BFCache restores), and visibilitychange back to visible.
 * Hidden-state changes are filtered out so handlers only fire when the
 * player can actually see the result.
 */
export function useForegroundReturn(onReturn: () => void): void {
  useEffect(() => {
    const handle = () => {
      if (document.visibilityState === "hidden") return;
      onReturn();
    };
    window.addEventListener("focus", handle);
    window.addEventListener("pageshow", handle);
    document.addEventListener("visibilitychange", handle);
    return () => {
      window.removeEventListener("focus", handle);
      window.removeEventListener("pageshow", handle);
      document.removeEventListener("visibilitychange", handle);
    };
  }, [onReturn]);
}
