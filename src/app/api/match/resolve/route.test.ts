import { describe, expect, it } from "vitest";
import { SIM_VERSION } from "@/sim/constants";
import { CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN } from "@/sim/design";
import { resolveMatch } from "@/sim/resolve";
import { POST } from "./route";

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/match/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/match/resolve", () => {
  it("returns the official result matching an independent local run", async () => {
    const res = await post({
      designs: [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
      simVersion: SIM_VERSION,
      timeLimitTicks: 600,
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // The hybrid-authority assertion: an independent simulation of the
    // same designs produces the identical result hash.
    const local = await resolveMatch(
      [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
      600,
    );
    expect(body.hash).toBe(local.hash);
    expect(local.status.over).toBe(true);
    if (local.status.over) {
      expect(body.status.winner).toBe(local.status.winner);
    }
    expect(body.tick).toBe(local.tick);
    expect(body.rewards[0].credits).toBe(local.rewards[0].credits);
  });

  it("rejects stale sim versions", async () => {
    const res = await post({
      designs: [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
      simVersion: SIM_VERSION - 1,
    });
    expect(res.status).toBe(409);
  });

  it("rejects invalid designs with the validity errors", async () => {
    const res = await post({
      designs: [
        {
          name: "broken",
          parts: [{ iid: "x", partId: "ram-spike" }],
          connections: [],
        },
        TEST_BOT_DESIGN,
      ],
      simVersion: SIM_VERSION,
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.issues.join(" ")).toContain("core");
  });

  it("rejects malformed bodies", async () => {
    const res = await post({ nope: true });
    expect(res.status).toBe(400);
  });
});
