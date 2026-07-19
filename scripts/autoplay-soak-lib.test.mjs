import { describe, expect, it } from "vitest";
import {
  boundedError,
  classifyStatus,
  mulberry32,
  pickKey,
} from "./autoplay-soak-lib.mjs";

const ESC = String.fromCharCode(27);

describe("boundedError", () => {
  it("strips ANSI color codes", () => {
    const err = new Error("boom");
    err.stack = `${ESC}[31mError: boom${ESC}[0m\n    at run`;
    expect(boundedError(err)).toBe("Error: boom\n    at run");
  });

  it("collapses an absolute script path to its basename", () => {
    const err = new Error("boom");
    err.stack =
      "Error: boom\n    at /Users/x/Dev/VibeBots/scripts/autoplay-mine.mjs:10:5";
    expect(boundedError(err)).toBe(
      "Error: boom\n    at autoplay-mine.mjs:10:5",
    );
  });

  it("leaves a URL intact (only filesystem paths collapse)", () => {
    const err = new Error("nav");
    err.stack = "page.goto: refused at http://127.0.0.1:59999/mine";
    expect(boundedError(err)).toContain("http://127.0.0.1:59999/mine");
  });

  it("bounds the summary to 600 characters", () => {
    const err = new Error("x".repeat(2000));
    err.stack = "y".repeat(2000);
    expect(boundedError(err).length).toBe(600);
  });

  it("handles a non-Error value", () => {
    expect(boundedError("plain string")).toBe("plain string");
  });
});

describe("classifyStatus", () => {
  it("fails on an exception", () => {
    expect(
      classifyStatus({
        exception: "boom",
        anomalyCount: 0,
        consoleErrorCount: 0,
      }),
    ).toBe("failed");
  });

  it("fails on any anomaly", () => {
    expect(
      classifyStatus({
        exception: null,
        anomalyCount: 1,
        consoleErrorCount: 0,
      }),
    ).toBe("failed");
  });

  it("fails on any console error", () => {
    expect(
      classifyStatus({
        exception: null,
        anomalyCount: 0,
        consoleErrorCount: 3,
      }),
    ).toBe("failed");
  });

  it("passes only when clean", () => {
    expect(
      classifyStatus({
        exception: null,
        anomalyCount: 0,
        consoleErrorCount: 0,
      }),
    ).toBe("passed");
  });
});

describe("mulberry32", () => {
  it("is deterministic for a fixed seed", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("diverges across seeds and stays in [0, 1)", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const first = a();
    expect(first).not.toBe(b());
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("pickKey", () => {
  const fixed = (value) => () => value;

  it("places a plank when a roof is teetering", () => {
    const run = { lateral: 0, lateralKey: "ArrowRight" };
    // rng < 0.6 takes the plank branch.
    expect(pickKey({ teeter: 1, depth: 3, energy: 60 }, run, fixed(0.1))).toBe(
      "plank",
    );
  });

  it("re-descends after banking at the surface with low energy", () => {
    const run = { lateral: 0, lateralKey: "ArrowRight" };
    expect(pickKey({ teeter: 0, depth: 0, energy: 40 }, run, fixed(0.9))).toBe(
      "ArrowDown",
    );
  });

  it("heads home when the climb cost approaches the remaining charge", () => {
    const run = { lateral: 0, lateralKey: "ArrowRight" };
    expect(pickKey({ teeter: 0, depth: 10, energy: 12 }, run, fixed(0.9))).toBe(
      "ArrowUp",
    );
  });

  it("consumes and decrements a lateral streak", () => {
    const run = { lateral: 2, lateralKey: "ArrowLeft" };
    expect(pickKey({ teeter: 0, depth: 5, energy: 60 }, run, fixed(0.9))).toBe(
      "ArrowLeft",
    );
    expect(run.lateral).toBe(1);
  });

  it("digs down by default when nothing else applies", () => {
    const run = { lateral: 0, lateralKey: "ArrowRight" };
    expect(pickKey({ teeter: 0, depth: 5, energy: 60 }, run, fixed(0.9))).toBe(
      "ArrowDown",
    );
  });
});
