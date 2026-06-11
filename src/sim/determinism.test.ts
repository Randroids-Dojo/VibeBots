import { describe, expect, it } from "vitest";
import { runSim } from "./run";

describe("sim determinism", () => {
  it("produces the same hash for the same seed across fresh worlds", async () => {
    const a = await runSim({ seed: 42, steps: 600 });
    const b = await runSim({ seed: 42, steps: 600 });
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(b.hash).toBe(a.hash);
  });

  it("produces different hashes for different seeds", async () => {
    const a = await runSim({ seed: 1, steps: 300 });
    const b = await runSim({ seed: 2, steps: 300 });
    expect(b.hash).not.toBe(a.hash);
  });

  it("evolves the hash as steps advance", async () => {
    const short = await runSim({ seed: 7, steps: 60 });
    const long = await runSim({ seed: 7, steps: 120 });
    expect(long.hash).not.toBe(short.hash);
  });

  it("stays deterministic across the periodic respawn boundary", async () => {
    const a = await runSim({ seed: 9, steps: 500 });
    const b = await runSim({ seed: 9, steps: 500 });
    expect(b.hash).toBe(a.hash);
  });
});
