/**
 * Shape of the mine options menu.
 *
 * The menu had grown to ten flat rows plus two paragraphs of body copy:
 * progression sat next to save state sat next to attribution sat next to
 * a developer bench, and on a phone the last rows were reachable only by
 * dragging. The redesign (docs/research/mine-options-menu-2026-07.html)
 * groups it into a root of five rows with three folders one level down.
 *
 * The rules that design commits to are enforced here by
 * `mine-settings-menu-model.test.ts` rather than by review: exactly two
 * levels, no folder holding fewer than two members, every leaf placed
 * exactly once, and every folder row naming its own contents.
 */

export type MineMenuLeafId =
  | "stamp-book"
  | "load-game"
  | "account"
  | "release-notes"
  | "replay-tutorial"
  | "feedback"
  | "credits"
  | "holodeck"
  | "update-alerts"
  | "performance-telemetry";

export type MineMenuFolderId = "saves" | "about" | "advanced";

/**
 * The two toggles render their own labels (they change with state), so
 * these names are what the folder summaries and the e2e helper use.
 */
export const MINE_MENU_LEAF_LABELS: Record<MineMenuLeafId, string> = {
  "stamp-book": "Stamp Book",
  "load-game": "Load game",
  account: "Account",
  "release-notes": "Release notes",
  "replay-tutorial": "Replay bunker tutorial",
  feedback: "Feedback",
  credits: "Credits",
  holodeck: "Holodeck",
  "update-alerts": "Update alerts",
  "performance-telemetry": "Performance telemetry",
};

export type MineMenuFolder = {
  readonly id: MineMenuFolderId;
  readonly label: string;
  readonly items: readonly MineMenuLeafId[];
};

export const MINE_MENU_FOLDERS: readonly MineMenuFolder[] = [
  { id: "saves", label: "Saves and account", items: ["load-game", "account"] },
  {
    id: "about",
    label: "About and help",
    items: ["release-notes", "replay-tutorial", "feedback", "credits"],
  },
  {
    id: "advanced",
    label: "Advanced",
    items: ["holodeck", "performance-telemetry"],
  },
];

export type MineMenuRootRow =
  | { readonly kind: "leaf"; readonly id: MineMenuLeafId }
  | { readonly kind: "folder"; readonly id: MineMenuFolderId };

/**
 * Stamp Book stays one tap: burying the headline collection feature to
 * win tidiness is the trade the research warns against. Update alerts is
 * player-facing and is the only notification control, and a one-member
 * folder is a tap tax, so it stays at the root as an inline toggle.
 */
export const MINE_MENU_ROOT: readonly MineMenuRootRow[] = [
  { kind: "leaf", id: "stamp-book" },
  { kind: "folder", id: "saves" },
  { kind: "folder", id: "about" },
  { kind: "folder", id: "advanced" },
  { kind: "leaf", id: "update-alerts" },
];

/**
 * What a folder row says about itself. Derived from the member labels so
 * a summary cannot drift away from what the folder actually holds, which
 * is the direct answer to the nested-doll critique: the player reads the
 * folder without opening it.
 */
export function mineMenuFolderSummary(folder: MineMenuFolder): string {
  return folder.items.map((id) => MINE_MENU_LEAF_LABELS[id]).join(", ");
}

export function findMineMenuFolder(id: MineMenuFolderId): MineMenuFolder {
  const folder = MINE_MENU_FOLDERS.find((entry) => entry.id === id);
  if (!folder) throw new Error(`Unknown options folder: ${id}`);
  return folder;
}

/** The folder holding a leaf, or null when the leaf sits at the root. */
export function mineMenuFolderOf(id: MineMenuLeafId): MineMenuFolder | null {
  return MINE_MENU_FOLDERS.find((folder) => folder.items.includes(id)) ?? null;
}
