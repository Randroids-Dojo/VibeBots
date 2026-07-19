import { describe, expect, it } from "vitest";
import {
  advanceFirstFrameGate,
  type FirstFrameGatePhase,
  SENTINEL_DRAW_CALLS,
} from "./canvas-draw-call-probe";

function runFrames(frames: number[]): FirstFrameGatePhase {
  let phase: FirstFrameGatePhase = "waiting";
  for (const drawCalls of frames) {
    phase = advanceFirstFrameGate(phase, drawCalls);
  }
  return phase;
}

describe("advanceFirstFrameGate", () => {
  it("stays waiting while frames draw only the probe sentinel", () => {
    expect(runFrames([0])).toBe("waiting");
    expect(runFrames([SENTINEL_DRAW_CALLS])).toBe("waiting");
    expect(
      runFrames([
        SENTINEL_DRAW_CALLS,
        SENTINEL_DRAW_CALLS,
        SENTINEL_DRAW_CALLS,
      ]),
    ).toBe("waiting");
  });

  it("needs one frame past the first content frame before firing", () => {
    expect(runFrames([SENTINEL_DRAW_CALLS, 24])).toBe("content-seen");
  });

  it("fires on the frame after content was seen", () => {
    expect(runFrames([SENTINEL_DRAW_CALLS, 24, SENTINEL_DRAW_CALLS])).toBe(
      "fired",
    );
    expect(runFrames([2, 2])).toBe("fired");
  });

  it("never leaves fired", () => {
    expect(runFrames([9, 9, 0, 0])).toBe("fired");
  });
});
