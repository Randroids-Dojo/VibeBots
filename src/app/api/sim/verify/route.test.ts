import { describe, expect, it } from "vitest";
import { runSim } from "@/sim/run";
import { GET } from "./route";

describe("GET /api/sim/verify", () => {
  it("returns the same result as a direct sim run", async () => {
    const res = await GET(
      new Request("http://localhost/api/sim/verify?seed=42&steps=300"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const direct = await runSim({ seed: 42, steps: 300 });
    expect(body).toEqual(direct);
  });

  it("applies defaults when no query params are given", async () => {
    const res = await GET(new Request("http://localhost/api/sim/verify"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seed).toBe(42);
    expect(body.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("rejects out-of-range step counts", async () => {
    const res = await GET(
      new Request("http://localhost/api/sim/verify?steps=999999"),
    );
    expect(res.status).toBe(400);
  });
});
