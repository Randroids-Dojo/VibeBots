/**
 * The one thing you can do right here.
 *
 * Jump, Enter bunker, Warp home, and Claim bunker were four persistent
 * buttons in four screen locations whose valid situations barely overlap,
 * and Jump sat at the right edge at 50% height, which is the middle of the
 * area the float-where-you-tap thumbstick expects to own. This picks the
 * single live verb for one context action button
 * (docs/research/mine-hud-redesign-2026-07.html section 4.7).
 *
 * Pure: no react, no three, no store.
 */

export type MineContextVerb = "enter-bunker" | "warp-home" | "jump";

export type MineContextActionInput = {
  /** Standing inside an editable claim, so the fp builder can open. */
  canEnterBunker: boolean;
  /** Standing on a planted beacon that is inside Warpcoil range. */
  canWarpHome: boolean;
  /** Jump jets owned and the cell above is legal. */
  canJump: boolean;
  /** Scene ready, no elevator ride or modal owning input. */
  interactive: boolean;
};

export type MineContextAction = {
  verb: MineContextVerb | null;
  label: string;
  /** Screen-reader label, more specific than the button face. */
  ariaLabel: string;
  enabled: boolean;
};

const LABELS: Record<MineContextVerb, { label: string; ariaLabel: string }> = {
  "enter-bunker": { label: "Enter", ariaLabel: "Enter bunker" },
  "warp-home": { label: "Warp", ariaLabel: "Warp home" },
  jump: { label: "Jump", ariaLabel: "Jump jets" },
};

/**
 * Fixed priority, most specific first. A published order is what keeps a
 * context button from feeling arbitrary when two contexts overlap: being
 * inside your own claim beats a beacon on the same cell, and both beat
 * the always-available jump.
 *
 * Claiming a bunker is deliberately NOT here. "Could claim" is true on
 * almost every underground cell, so as a context verb it permanently
 * shadowed Jump, which is a movement primitive the player uses constantly.
 * It keeps its own pill.
 */
const PRIORITY: MineContextVerb[] = ["enter-bunker", "warp-home", "jump"];

export function pickContextAction(
  input: MineContextActionInput,
): MineContextAction {
  const available: Record<MineContextVerb, boolean> = {
    "enter-bunker": input.canEnterBunker,
    "warp-home": input.canWarpHome,
    jump: input.canJump,
  };
  const verb = PRIORITY.find((candidate) => available[candidate]) ?? null;
  if (!verb) {
    // The button keeps its slot rather than unmounting, so the control
    // under the thumb never moves. It just has nothing to do.
    return {
      verb: null,
      label: "Jump",
      ariaLabel: "No action here",
      enabled: false,
    };
  }
  return { ...LABELS[verb], verb, enabled: input.interactive };
}
