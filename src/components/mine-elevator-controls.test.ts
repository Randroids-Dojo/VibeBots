import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MineElevatorControls } from "./mine-elevator-controls";

function renderControls(row: number, bottomRow = 20) {
  return renderToStaticMarkup(
    createElement(MineElevatorControls, {
      stage: "choosing",
      ride: null,
      row,
      bottomRow,
      onRide: vi.fn(),
    }),
  );
}

describe("MineElevatorControls", () => {
  it("renders nothing while the elevator interaction is idle", () => {
    const markup = renderToStaticMarkup(
      createElement(MineElevatorControls, {
        stage: "idle",
        ride: null,
        row: 5,
        bottomRow: 20,
        onRide: vi.fn(),
      }),
    );

    expect(markup).toBe("");
  });

  it("offers both destinations from an intermediate floor", () => {
    const markup = renderControls(7);

    expect(markup).toContain('data-stage="choosing"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Choose top or bottom");
    expect(markup).toContain(
      '<fieldset aria-label="Choose elevator destination">',
    );
    expect(markup).toContain('aria-label="Go to top"');
    expect(markup).toContain('aria-label="Go to bottom"');
    expect(markup).toContain("Bottom 20");
  });

  it("offers only the bottom destination from the surface", () => {
    const markup = renderControls(0);

    expect(markup).not.toContain('aria-label="Go to top"');
    expect(markup).toContain('aria-label="Go to bottom"');
  });

  it("offers only the top destination from the bottom", () => {
    const markup = renderControls(20);

    expect(markup).toContain('aria-label="Go to top"');
    expect(markup).not.toContain('aria-label="Go to bottom"');
  });
});
