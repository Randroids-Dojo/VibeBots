import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SaveConflictPopup } from "./mine-save-conflict-popup";

describe("SaveConflictPopup", () => {
  it("renders nothing while there is no conflict", () => {
    const markup = renderToStaticMarkup(
      createElement(SaveConflictPopup, {
        open: false,
        onResolve: vi.fn(),
      }),
    );

    expect(markup).toBe("");
  });

  it("offers the sync and keep-playing choices for a conflict", () => {
    const markup = renderToStaticMarkup(
      createElement(SaveConflictPopup, {
        open: true,
        onResolve: vi.fn(),
      }),
    );

    expect(markup).toContain("Save updated on another device");
    expect(markup).toContain("Sync now (discard this run)");
    expect(markup).toContain("Keep playing");
    expect(markup).toContain("cannot be merged");
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-describedby="save-conflict-description"');
    expect(markup).toContain('id="save-conflict-description"');
    expect(markup).toContain("data-save-conflict-dialog");
  });
});
