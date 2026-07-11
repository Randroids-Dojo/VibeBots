import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StampAlertCard } from "./stamp-collect-alert";

describe("stamp collect alert", () => {
  it("announces a collected stamp with its art and title", () => {
    const markup = renderToStaticMarkup(
      createElement(StampAlertCard, { achievementId: "tool-depot-regular" }),
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain('data-stamp-alert="tool-depot-regular"');
    expect(markup).toContain("Stamp collected");
    expect(markup).toContain("Depot Regular");
    expect(markup).toContain("<svg");
  });

  it("renders nothing for an id outside the stamp catalog", () => {
    expect(
      renderToStaticMarkup(
        createElement(StampAlertCard, { achievementId: "not-a-stamp" }),
      ),
    ).toBe("");
  });

  it("keeps the animation-owned lifetime with a reaper fallback", () => {
    // The lifetime contract that keeps alerts from sticking on devices
    // where the CSS animation stalls or never starts (same trap the
    // stratum banner hit; see the comment in the component).
    const source = readFileSync(
      join(process.cwd(), "src/components/stamp-collect-alert.tsx"),
      "utf8",
    );
    expect(source).toContain("onAnimationEnd={shiftStampAlert}");
    expect(source).toContain("armReaper(STAMP_ALERT_MS + 400)");
    expect(source).toContain("armReaper(STAMP_ALERT_MS * 2)");

    const css = readFileSync(join(process.cwd(), "src/app/mine.css"), "utf8");
    expect(css).toContain("@keyframes mine-stamp-alert-pop");
    expect(css).toMatch(/mine-stamp-alert-pop 3000ms [^;]*forwards/);
    // Reduced motion must still clear the alert: the animation is off,
    // so the class has to be inside the reduced-motion override list.
    expect(css).toMatch(/prefers-reduced-motion[^}]*\{[^{]*\.mine-stamp-alert,/);
  });
});
