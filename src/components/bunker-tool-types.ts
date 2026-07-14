import type { BasePartId } from "@/sim/bunker";

/**
 * Shared bunker tool state types. Since the 2D hammer flow retired,
 * every tool selection is made inside the first-person view: the fp
 * hotbar owns the part slots, pick, and pry toggle; mine-panel owns
 * the state so exits and forced exits can reset it.
 */

/** "dig" is the fp pick slot; a part id arms the build ghost for that
 * part; "pry" returns the crosshair part straight to inventory. */
export type BunkerToolSelection = BasePartId | "pry" | "dig" | null;
export type BunkerToolAction = "build" | "pry" | "dig";

/** Target-highlight tint per tool action (the first-person outline
 * materials). */
export const BUNKER_TOOL_HIGHLIGHT: Record<BunkerToolAction, string> = {
  build: "#54e0c7",
  pry: "#f59e0b",
  dig: "#e2e8f0",
};
