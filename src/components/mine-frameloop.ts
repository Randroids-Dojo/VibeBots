/**
 * How fast the mine canvas renders (F-255).
 *
 * The canvas mounts at frameloop "never" and runs "always" once the
 * material warm pass settles (F-081). While a modal dialog covers the
 * mine (Settings, Credits, the Account dialog, the save slots, the Stamp
 * Book, Feedback) play is paused or the player is reading, so full frames
 * behind the dialog are battery spent on a scene nobody is looking at:
 * the loop goes back to "never" and PausedFrameTicker in
 * mine-frame-ticker.tsx advances a frame by hand at a slow fixed rate, so
 * the translucent backdrop still breathes and the first frame after the
 * dialog closes is at most one tick stale.
 *
 * The frameloop prop must change through React state (see
 * compile-gate.tsx), which is why this is a pure function of two booleans
 * the canvas holds in state and props.
 */
export type MineFrameloop = "always" | "never";

/** Milliseconds between hand-advanced frames under a modal: four a second. */
export const PAUSED_FRAME_INTERVAL_MS = 250;

export function mineFrameloopFor(
  warmed: boolean,
  paused: boolean,
): MineFrameloop {
  if (!warmed) return "never";
  return paused ? "never" : "always";
}
