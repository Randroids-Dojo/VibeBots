import { describe, expect, it } from "vitest";
import {
  type MineContextActionInput,
  pickContextAction,
} from "./mine-context-action";

const NONE: MineContextActionInput = {
  canEnterBunker: false,
  canWarpHome: false,
  canJump: false,
  interactive: true,
};

const at = (overrides: Partial<MineContextActionInput> = {}) =>
  pickContextAction({ ...NONE, ...overrides });

describe("pickContextAction", () => {
  it("keeps the button in place with nothing to do when no verb is live", () => {
    const action = at();
    expect(action.verb).toBeNull();
    expect(action.enabled).toBe(false);
    // Still labelled, so the control never becomes an unexplained blank.
    expect(action.label).toBeTruthy();
  });

  it("falls back to jump when only jump is available", () => {
    const action = at({ canJump: true });
    expect(action.verb).toBe("jump");
    expect(action.label).toBe("Jump");
    expect(action.enabled).toBe(true);
  });

  it("prefers entering a bunker over every other verb", () => {
    const action = at({
      canEnterBunker: true,
      canWarpHome: true,
      canJump: true,
    });
    expect(action.verb).toBe("enter-bunker");
    expect(action.ariaLabel).toBe("Enter bunker");
  });

  it("prefers warping home over jumping", () => {
    const action = at({ canWarpHome: true, canJump: true });
    expect(action.verb).toBe("warp-home");
  });

  it("never lets a rarely-used verb shadow jump", () => {
    // Regression: claiming a bunker is legal on nearly every underground
    // cell, so as a context verb it hid Jump for the whole run.
    const action = at({ canJump: true });
    expect(action.verb).toBe("jump");
    expect(action.ariaLabel).toBe("Jump jets");
  });

  it("keeps the verb but disables it while something else owns input", () => {
    const action = at({ canJump: true, interactive: false });
    expect(action.verb).toBe("jump");
    expect(action.enabled).toBe(false);
  });

  it("gives every verb a distinct face and aria label", () => {
    const verbs = [
      at({ canEnterBunker: true }),
      at({ canWarpHome: true }),
      at({ canJump: true }),
    ];
    expect(new Set(verbs.map((v) => v.label)).size).toBe(3);
    expect(new Set(verbs.map((v) => v.ariaLabel)).size).toBe(3);
    for (const v of verbs) expect(v.ariaLabel.length).toBeGreaterThan(0);
  });
});
