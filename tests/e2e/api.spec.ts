import { expect, test } from "@playwright/test";
import { SIM_VERSION } from "../../src/sim/constants";
import { CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN } from "../../src/sim/design";
import { ciCase } from "./support/ci-case";

test(
  "match resolve API returns a deterministic official result",
  ciCase("E2E-API-0001", "@functional"),
  async ({ request }) => {
    const payload = {
      designs: [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
      simVersion: SIM_VERSION,
      timeLimitTicks: 600,
    };
    const first = await request.post("/api/match/resolve", { data: payload });
    expect(first.ok()).toBeTruthy();
    const a = await first.json();
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(a.status.over).toBe(true);

    const second = await request.post("/api/match/resolve", { data: payload });
    const b = await second.json();
    expect(b.hash).toBe(a.hash);
  },
);

test(
  "sim verify API returns a stable deterministic hash",
  ciCase("E2E-API-0002", "@functional"),
  async ({ request }) => {
    const first = await request.get("/api/sim/verify?seed=42&steps=300");
    expect(first.ok()).toBeTruthy();
    const a = await first.json();
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(a.simVersion).toBe(SIM_VERSION);

    const second = await request.get("/api/sim/verify?seed=42&steps=300");
    const b = await second.json();
    expect(b.hash).toBe(a.hash);
  },
);
