/**
 * Shared first-person input state for the bunker viewer, written by
 * the keyboard listeners here and the touch HUD zones, read by the rig
 * inside the render loop. A mutable module singleton on purpose (the
 * VibeCoded.Games pattern): per-frame reads must not chase React
 * state, and writes at input cadence never allocate.
 */

export interface FpInputState {
  /** -1..1, W/Up positive. */
  forward: number;
  /** -1..1, D/Right positive. */
  strafe: number;
  /** Edge-triggered jump; the rig consumes it each frame. */
  jump: boolean;
  /** Edge-triggered "act with the current tool" (left click while
   * pointer-locked, or a quick tap on the touch look zone). */
  act: boolean;
  /** Held while the primary press is active (left button, or a dig-mode
   * touch on the look zone). The rig only acts on it with the dig tool,
   * where it drives continuous pickaxe mining: a strike repeats on the
   * crosshair cell every swing, so dragging the aim to a new block mines
   * it too (Minecraft hold-to-mine). Distinct from the edge `act`, which
   * fires the first strike and every build placement. */
  actHeld: boolean;
  /** Edge-triggered quick pry (right click), regardless of tool. */
  pryAct: boolean;
  /** Accumulated look deltas (touch drag), consumed each frame. */
  lookX: number;
  lookY: number;
}

export const fpInput: FpInputState = {
  forward: 0,
  strafe: 0,
  jump: false,
  act: false,
  actHeld: false,
  pryAct: false,
  lookX: 0,
  lookY: 0,
};

const held = new Set<string>();

function recompute(): void {
  fpInput.forward =
    (held.has("KeyW") || held.has("ArrowUp") ? 1 : 0) -
    (held.has("KeyS") || held.has("ArrowDown") ? 1 : 0);
  fpInput.strafe =
    (held.has("KeyD") || held.has("ArrowRight") ? 1 : 0) -
    (held.has("KeyA") || held.has("ArrowLeft") ? 1 : 0);
}

const HANDLED_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
]);

export function resetFpInput(): void {
  held.clear();
  fpInput.forward = 0;
  fpInput.strafe = 0;
  fpInput.jump = false;
  fpInput.act = false;
  fpInput.actHeld = false;
  fpInput.pryAct = false;
  fpInput.lookX = 0;
  fpInput.lookY = 0;
}

/** Attaches WASD/arrow movement and Space jump. Returns the detach
 * function; detach also zeroes the input so nothing stays held. */
export function attachFpKeyboard(): () => void {
  const down = (event: KeyboardEvent) => {
    if (event.repeat) return;
    // Typing in a form must never drive the player.
    if (
      event.target instanceof Element &&
      event.target.closest("input, textarea, select, [contenteditable]")
    ) {
      return;
    }
    if (!HANDLED_CODES.has(event.code)) return;
    event.preventDefault();
    if (event.code === "Space") {
      fpInput.jump = true;
      return;
    }
    held.add(event.code);
    recompute();
  };
  const up = (event: KeyboardEvent) => {
    if (!held.has(event.code)) return;
    held.delete(event.code);
    recompute();
  };
  const blur = () => {
    held.clear();
    recompute();
  };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
    resetFpInput();
  };
}
