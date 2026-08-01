import { describe, expect, it } from "vitest";
import {
  MINE_MENU_FOLDERS,
  MINE_MENU_LEAF_LABELS,
  MINE_MENU_ROOT,
  type MineMenuLeafId,
  mineMenuFolderOf,
  mineMenuFolderSummary,
} from "./mine-settings-menu-model";

const ALL_LEAVES = Object.keys(MINE_MENU_LEAF_LABELS) as MineMenuLeafId[];

describe("mine options menu model", () => {
  it("places every option exactly once", () => {
    const placed = [
      ...MINE_MENU_ROOT.filter((row) => row.kind === "leaf").map(
        (row) => row.id,
      ),
      ...MINE_MENU_FOLDERS.flatMap((folder) => folder.items),
    ];
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual([...ALL_LEAVES].sort());
  });

  it("keeps the root short enough to fit without scrolling", () => {
    // Five rows is what a 390x844 phone holds under the gear without the
    // menu scrolling, which is the whole point of the folders.
    expect(MINE_MENU_ROOT.length).toBeLessThanOrEqual(5);
  });

  it("never nests deeper than one folder", () => {
    // Every folder member has to be a leaf: the model has no folder-in-a
    // -folder row, and this fails if one is ever added.
    for (const folder of MINE_MENU_FOLDERS) {
      for (const item of folder.items) {
        expect(ALL_LEAVES, `${folder.id} holds ${item}`).toContain(item);
      }
    }
  });

  it("never opens a folder for a single item", () => {
    // A one-member folder is a tap with no organising benefit. This is
    // why update alerts stays at the root instead of earning a
    // "Notifications" folder of its own.
    for (const folder of MINE_MENU_FOLDERS) {
      expect(folder.items.length, `${folder.id}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("makes every folder row name its own contents", () => {
    for (const folder of MINE_MENU_FOLDERS) {
      const summary = mineMenuFolderSummary(folder);
      for (const item of folder.items) {
        expect(summary).toContain(MINE_MENU_LEAF_LABELS[item]);
      }
    }
  });

  it("reports which folder holds an option", () => {
    expect(mineMenuFolderOf("holodeck")?.label).toBe("Advanced");
    expect(mineMenuFolderOf("stamp-book")).toBeNull();
  });
});
