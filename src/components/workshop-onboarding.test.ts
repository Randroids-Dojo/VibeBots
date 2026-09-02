import { describe, expect, it } from "vitest";
import { type BotDesign, validateDesign } from "@/sim/design";
import { DRIVE_WHEEL } from "@/sim/parts";
import { validSlotsFor } from "@/state/workshop-store";
import {
  clearWorkshopGuideDone,
  GUIDE_CARDS,
  GUIDED_PART_ID,
  GUIDED_START_DESIGN,
  GUIDED_WHEELS_WHEN_DONE,
  type GuideStorage,
  guideWheelCount,
  isWorkshopGuideDone,
  markWorkshopGuideDone,
  nextGuideStep,
  WORKSHOP_GUIDE_DONE_KEY,
} from "./workshop-onboarding";

function memoryStorage(): GuideStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe("guided first build", () => {
  it("starts from a valid bot that is exactly one wheel from done", () => {
    expect(validateDesign(GUIDED_START_DESIGN).ok).toBe(true);
    expect(guideWheelCount(GUIDED_START_DESIGN)).toBe(
      GUIDED_WHEELS_WHEN_DONE - 1,
    );
    // The guided part has exactly one legal placement: the free left axle.
    const slots = validSlotsFor(GUIDED_START_DESIGN, DRIVE_WHEEL);
    expect(slots).toHaveLength(1);
    expect(slots[0].parentConnector).toBe("axle-left");
    expect(DRIVE_WHEEL.id).toBe(GUIDED_PART_ID);
  });

  it("advances each step only on its own demonstration, never backward", () => {
    const idle = { wheelCount: 1, fightStarted: false, shopOpened: false };
    expect(nextGuideStep("place", idle)).toBe("place");
    expect(nextGuideStep("place", { ...idle, wheelCount: 2 })).toBe("fight");
    expect(nextGuideStep("fight", { ...idle, wheelCount: 2 })).toBe("fight");
    expect(
      nextGuideStep("fight", { ...idle, wheelCount: 2, fightStarted: true }),
    ).toBe("shop");
    expect(nextGuideStep("shop", { ...idle, wheelCount: 2 })).toBe("shop");
    expect(nextGuideStep("shop", { ...idle, shopOpened: true })).toBe("done");
    expect(nextGuideStep("done", idle)).toBe("done");
    // Removing the wheel after the fact does not reopen the place step.
    expect(nextGuideStep("fight", { ...idle, wheelCount: 0 })).toBe("fight");
  });

  it("does not end the place step on some other part", () => {
    // A plate on the top mount raises the part count but not the wheel
    // count: the glowing axle is still empty, so the step stays.
    const withPlate: BotDesign = {
      ...GUIDED_START_DESIGN,
      parts: [
        ...GUIDED_START_DESIGN.parts,
        { iid: "plate", partId: "frame-plate" },
      ],
      connections: [
        ...GUIDED_START_DESIGN.connections,
        {
          parentIid: "core",
          parentConnector: "top",
          childIid: "plate",
          childConnector: "bottom",
        },
      ],
    };
    expect(validateDesign(withPlate).ok).toBe(true);
    expect(withPlate.parts).toHaveLength(4);
    expect(
      nextGuideStep("place", {
        wheelCount: guideWheelCount(withPlate),
        fightStarted: false,
        shopOpened: false,
      }),
    ).toBe("place");
  });

  it("lets a later demonstration clear the earlier steps in one pass", () => {
    // A player who loads a two-wheel blueprint and fights it has placed
    // and fought.
    expect(
      nextGuideStep("place", {
        wheelCount: 2,
        fightStarted: true,
        shopOpened: false,
      }),
    ).toBe("shop");
    expect(
      nextGuideStep("place", {
        wheelCount: 2,
        fightStarted: true,
        shopOpened: true,
      }),
    ).toBe("done");
  });

  it("has a card for every step but done, with a title and one line", () => {
    for (const step of ["place", "fight", "shop"] as const) {
      expect(GUIDE_CARDS[step].step).toBe(step);
      expect(GUIDE_CARDS[step].title.length).toBeGreaterThan(0);
      expect(GUIDE_CARDS[step].line.length).toBeGreaterThan(0);
      expect(GUIDE_CARDS[step].line).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("persists completion and can be cleared to replay", () => {
    const storage = memoryStorage();
    expect(isWorkshopGuideDone(storage)).toBe(false);
    markWorkshopGuideDone(storage);
    expect(storage.data.get(WORKSHOP_GUIDE_DONE_KEY)).toBe("1");
    expect(isWorkshopGuideDone(storage)).toBe(true);
    clearWorkshopGuideDone(storage);
    expect(isWorkshopGuideDone(storage)).toBe(false);
  });

  it("treats a missing or throwing storage as not done", () => {
    expect(isWorkshopGuideDone(null)).toBe(false);
    const broken: GuideStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(isWorkshopGuideDone(broken)).toBe(false);
    expect(() => markWorkshopGuideDone(broken)).not.toThrow();
    expect(() => clearWorkshopGuideDone(broken)).not.toThrow();
  });
});
