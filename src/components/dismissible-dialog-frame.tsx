"use client";

import {
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from "react";

export function useDismissControls(active: boolean, onDismiss: () => void) {
  const onDismissRef = useRef(onDismiss);
  const gamepadDismissPressedRef = useRef(false);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!active) {
      gamepadDismissPressedRef.current = false;
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onDismissRef.current();
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
      if (dismissPressed && !gamepadDismissPressedRef.current) {
        onDismissRef.current();
      }
      gamepadDismissPressedRef.current = dismissPressed;
      frame = requestAnimationFrame(pollGamepadDismiss);
    };
    frame = requestAnimationFrame(pollGamepadDismiss);
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(frame);
    };
  }, [active]);
}

export function useOutsidePointerDismiss(
  active: boolean,
  isInsideOpenSurface: (
    target: EventTarget | null,
    path: readonly EventTarget[],
  ) => boolean,
  onDismiss: () => void,
) {
  const isInsideOpenSurfaceRef = useRef(isInsideOpenSurface);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    isInsideOpenSurfaceRef.current = isInsideOpenSurface;
    onDismissRef.current = onDismiss;
  }, [isInsideOpenSurface, onDismiss]);

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      if (isInsideOpenSurfaceRef.current(event.target, path)) return;
      event.preventDefault();
      event.stopPropagation();
      onDismissRef.current();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [active]);
}

export function eventInsideRef(
  ref: RefObject<HTMLElement | null>,
  target: EventTarget | null,
  path: readonly EventTarget[],
): boolean {
  const element = ref.current;
  if (!element) return false;
  if (path.includes(element)) return true;
  return target instanceof Node && element.contains(target);
}

export function DismissibleDialogFrame({
  active = true,
  onDismiss,
  children,
  onPointerDown,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  active?: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  useDismissControls(active, onDismiss);
  return (
    <div
      {...props}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (event.defaultPrevented) return;
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      {children}
    </div>
  );
}
