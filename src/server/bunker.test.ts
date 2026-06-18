import { afterEach, describe, expect, it, vi } from "vitest";
import { finishBunkerRaid } from "./bunker";

describe("bunker server helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not pay a raid reward when the finish row was already claimed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T00:05:00.000Z"));
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const query = strings.join(" ");
      if (query.includes("SELECT raid_id, snapshot")) {
        return [
          {
            raid_id: "raid-1",
            started_at: "2026-06-18T00:00:00.000Z",
            duration_seconds: 180,
            snapshot: {
              raidId: "raid-1",
              tier: 1,
              durationSeconds: 180,
              clankers: [],
              totalPartDurability: 180,
              incomingDamage: 100,
              breached: false,
              survived: true,
              reward: { vibes: 30, defenseXp: 60 },
            },
          },
        ];
      }
      if (query.includes("UPDATE bunker_raids")) return [];
      if (query.includes("UPDATE players")) {
        throw new Error("reward should not be paid");
      }
      return [];
    });

    const result = await finishBunkerRaid(sql as never, "player-1");

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "raid already finished",
    });
  });
});
