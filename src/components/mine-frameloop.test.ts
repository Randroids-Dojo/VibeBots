import { describe, expect, it } from "vitest";
import { mineFrameloopFor, PAUSED_FRAME_INTERVAL_MS } from "./mine-frameloop";

describe("mine frameloop (F-255)", () => {
  it("never renders before the warm pass, runs free after it, and stops under a modal", () => {
    expect(mineFrameloopFor(false, false)).toBe("never");
    expect(mineFrameloopFor(false, true)).toBe("never");
    expect(mineFrameloopFor(true, false)).toBe("always");
    expect(mineFrameloopFor(true, true)).toBe("never");
  });

  it("ticks under five frames a second while paused (the acceptance line)", () => {
    expect(1000 / PAUSED_FRAME_INTERVAL_MS).toBeLessThan(5);
    expect(1000 / PAUSED_FRAME_INTERVAL_MS).toBeGreaterThanOrEqual(2);
  });
});
