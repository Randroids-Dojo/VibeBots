"use client";

import { HudIcon } from "./mine-hud-icons";
import {
  HUD_BORDER,
  HUD_RADIUS_MEDIUM,
  HUD_SURFACE_SOLID,
  HUD_TEXT,
  HUD_TEXT_MUTED,
  HUD_TOUCH_MIN,
} from "./mine-hud-tokens";
import {
  PerfTelemetryControl,
  ReleaseNotificationControl,
} from "./mine-settings-dialogs";
import {
  findMineMenuFolder,
  MINE_MENU_LEAF_LABELS,
  MINE_MENU_ROOT,
  type MineMenuFolderId,
  type MineMenuLeafId,
  mineMenuFolderSummary,
} from "./mine-settings-menu-model";

/** Leaves that navigate somewhere. The two toggles render themselves. */
export type MineMenuActionId = Exclude<
  MineMenuLeafId,
  "update-alerts" | "performance-telemetry"
>;

const ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  minHeight: HUD_TOUCH_MIN,
  padding: "8px 10px",
  marginBottom: 8,
  borderRadius: HUD_RADIUS_MEDIUM,
  border: `1px solid ${HUD_BORDER}`,
  background: HUD_SURFACE_SOLID,
  color: HUD_TEXT,
  fontSize: "0.9rem",
  fontWeight: 700,
  textAlign: "left",
  cursor: "pointer",
};

/**
 * The one row that keeps a colour: the Stamp Book is the headline
 * collection feature, and the rest of the menu reads as one surface
 * instead of the eight differently tinted buttons it used to be.
 */
const STAMP_BOOK_ROW_STYLE: React.CSSProperties = {
  ...ROW_STYLE,
  border: "1px solid rgb(var(--hud-gold-rgb) / 0.55)",
  background: "rgb(var(--hud-gold-rgb) / 0.1)",
  color: "var(--hud-gold)",
  fontWeight: 800,
};

const SUMMARY_STYLE: React.CSSProperties = {
  display: "block",
  marginTop: 2,
  color: HUD_TEXT_MUTED,
  fontSize: "0.72rem",
  fontWeight: 500,
  lineHeight: 1.25,
};

/**
 * One option, wherever it sits. The two toggles bring their own labels
 * and body copy; everything else is a row that navigates.
 */
function MenuLeaf({
  id,
  onSelect,
  tutorialReplayArmed,
}: {
  id: MineMenuLeafId;
  onSelect: (id: MineMenuActionId) => void;
  tutorialReplayArmed: boolean;
}) {
  if (id === "update-alerts") return <ReleaseNotificationControl />;
  if (id === "performance-telemetry") return <PerfTelemetryControl />;
  const row = (
    <button
      type="button"
      data-testid={
        id === "replay-tutorial" ? "replay-bunker-tutorial" : undefined
      }
      onClick={() => onSelect(id)}
      style={id === "stamp-book" ? STAMP_BOOK_ROW_STYLE : ROW_STYLE}
    >
      {MINE_MENU_LEAF_LABELS[id]}
    </button>
  );
  if (id !== "replay-tutorial" || !tutorialReplayArmed) return row;
  return (
    <>
      {row}
      <div
        role="status"
        style={{
          marginTop: -2,
          marginBottom: 8,
          fontSize: "0.76rem",
          color: HUD_TEXT_MUTED,
          textAlign: "center",
        }}
      >
        Shows the next time you enter your bunker.
      </div>
    </>
  );
}

/**
 * The mine options menu: one root of five rows, three folders one level
 * down. Folder rows carry the names of what they hold, so drilling in is
 * never a guess (docs/research/mine-options-menu-2026-07.html).
 *
 * The open folder is owned by the panel because back (Escape, TV back)
 * has to step up a level before it closes the menu, and the panel is what
 * owns dismissal.
 */
export function MineSettingsMenu({
  menuRef,
  top,
  edgeGap,
  zIndex,
  openFolder,
  onOpenFolder,
  onSelect,
  tutorialReplayArmed,
}: {
  menuRef: React.RefObject<HTMLElement | null>;
  top: number;
  edgeGap: number;
  zIndex: number;
  openFolder: MineMenuFolderId | null;
  onOpenFolder: (id: MineMenuFolderId | null) => void;
  onSelect: (id: MineMenuActionId) => void;
  tutorialReplayArmed: boolean;
}) {
  const folder = openFolder === null ? null : findMineMenuFolder(openFolder);

  return (
    <section
      ref={menuRef}
      aria-label="Settings"
      data-options-folder={openFolder ?? "root"}
      style={{
        position: "absolute",
        top,
        right: edgeGap,
        zIndex,
        width: 238,
        // The shell clips at its bottom edge (overflow hidden), so on a
        // short viewport the menu scrolls instead of losing its lower
        // rows past the edge. The folders exist so it rarely has to.
        maxHeight: `calc(100% - ${top + edgeGap}px)`,
        overflowY: "auto",
        border: `1px solid ${HUD_BORDER}`,
        borderRadius: 12,
        background: "rgb(var(--hud-surface-rgb) / 0.96)",
        boxShadow: "0 12px 34px rgba(0, 0, 0, 0.42)",
        padding: 10,
        color: HUD_TEXT,
      }}
    >
      {folder === null ? (
        MINE_MENU_ROOT.map((row) => {
          if (row.kind === "folder") {
            const entry = findMineMenuFolder(row.id);
            const summary = mineMenuFolderSummary(entry);
            return (
              <button
                key={entry.id}
                type="button"
                aria-label={`${entry.label}. ${summary}`}
                onClick={() => onOpenFolder(entry.id)}
                style={ROW_STYLE}
              >
                <span style={{ flex: 1 }}>
                  {entry.label}
                  <span style={SUMMARY_STYLE}>{summary}</span>
                </span>
                <HudIcon name="chevron-right" size={16} />
              </button>
            );
          }
          return (
            <MenuLeaf
              key={row.id}
              id={row.id}
              onSelect={onSelect}
              tutorialReplayArmed={tutorialReplayArmed}
            />
          );
        })
      ) : (
        <>
          <button
            type="button"
            aria-label="Back to options"
            onClick={() => onOpenFolder(null)}
            style={{
              ...ROW_STYLE,
              background: "transparent",
              border: "none",
              minHeight: 36,
              marginBottom: 10,
              padding: "2px 0",
              fontWeight: 800,
            }}
          >
            <HudIcon name="chevron-left" size={16} />
            {folder.label}
          </button>
          {folder.items.map((id) => (
            <MenuLeaf
              key={id}
              id={id}
              onSelect={onSelect}
              tutorialReplayArmed={tutorialReplayArmed}
            />
          ))}
        </>
      )}
    </section>
  );
}
