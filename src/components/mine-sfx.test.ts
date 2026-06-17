import { describe, expect, it } from "vitest";
import type { MoveResult } from "@/sim/mine";
import { mineResultSfxEvents, mineShopNoteSfxEvent } from "./mine-sfx";

const ok = {
  ok: true,
  dug: null,
  dugOre: null,
  found: null,
  collapsed: false,
} satisfies MoveResult;

describe("mining sfx event mapping", () => {
  it("maps plain movement to a step cue", () => {
    expect(mineResultSfxEvents(ok, "left")).toEqual(["step"]);
  });

  it("maps different mined elements to distinct cues", () => {
    expect(
      mineResultSfxEvents(
        {
          ...ok,
          dug: "ore",
          dugOre: "ruby",
        },
        "down",
      ),
    ).toEqual(["dig-ore-ruby", "ore-pickup"]);

    expect(
      mineResultSfxEvents(
        {
          ...ok,
          dug: "part-cache",
          found: "core-cube",
        },
        "down",
      ),
    ).toEqual(["dig-cache", "cache-fanfare"]);
  });

  it("maps consumables and hazards to action-specific cues", () => {
    expect(
      mineResultSfxEvents(
        { ...ok, dynamitePlanted: { col: 0, row: 1 } },
        "dynamite-down",
      ),
    ).toEqual([]);
    expect(
      mineResultSfxEvents(
        { ...ok, blasted: 4, vented: 2, exploded: { col: 0, row: 1 } },
        "left",
      ),
    ).toEqual(["step", "dynamite", "gas"]);

    expect(mineResultSfxEvents({ ...ok, recalled: true }, "recall")).toEqual([
      "recall",
    ]);

    expect(
      mineResultSfxEvents({ ...ok, collapsed: true, crushed: true }, "down"),
    ).toEqual(["step", "crush"]);
  });

  it("maps structural consumables and transport cues", () => {
    expect(mineResultSfxEvents({ ...ok, laddered: true }, "up")).toEqual([
      "step",
      "ladder",
    ]);
    expect(
      mineResultSfxEvents(
        { ...ok, plankPlaced: { col: 1, row: 2 } },
        "plank-right",
      ),
    ).toEqual(["plank"]);
    expect(mineResultSfxEvents(ok, "place-beacon")).toEqual(["beacon"]);
    expect(mineResultSfxEvents(ok, "warp-home")).toEqual(["warp"]);
    expect(mineResultSfxEvents(ok, "ride-up")).toEqual(["elevator"]);
  });

  it("maps shop notes to commerce cues", () => {
    expect(mineShopNoteSfxEvent("+1 dynamite packed (1 owned)")).toBe("buy");
    expect(mineShopNoteSfxEvent("not enough vibes")).toBe("deny");
    expect(
      mineShopNoteSfxEvent("the depot ledger is offline; nothing was charged"),
    ).toBe("deny");
  });
});
