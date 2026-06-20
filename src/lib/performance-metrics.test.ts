import { describe, expect, it } from "vitest";
import { summarizeFrameMetrics } from "./performance-metrics";

describe("performance metrics", () => {
  it("summarizes frame samples into stable percentiles", () => {
    expect(summarizeFrameMetrics([16, 17, 18, 50, 100])).toEqual({
      frameCount: 5,
      avgFrameMs: 40.2,
      p50FrameMs: 18,
      p95FrameMs: 100,
      maxFrameMs: 100,
      longFrameCount: 2,
    });
  });

  it("filters invalid frame samples", () => {
    expect(summarizeFrameMetrics([16.04, Number.NaN, -2, 33.36])).toMatchObject(
      {
        frameCount: 2,
        avgFrameMs: 24.7,
        p50FrameMs: 16,
        p95FrameMs: 33.4,
        maxFrameMs: 33.4,
      },
    );
  });
});
