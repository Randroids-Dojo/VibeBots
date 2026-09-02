import { describe, expect, it } from "vitest";
import { validateDesign } from "@/sim/design";
import { DRIVE_WHEEL } from "@/sim/parts";
import { validSlotsFor } from "@/state/workshop-store";
import {
  clearWorkshopGuideDone,
  GUIDE_CARDS,
  GUIDED_COMPLETE_PART_COUNT,
  GUIDED_PART_ID,
  GUIDED_START_DESIGN,
  type GuideStorage,
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
    expect(GUIDED_START_DESIGN.parts).toHaveLength(
      GUIDED_COMPLETE_PART_COUNT - 1,
    );
    // The guided part has exactly one legal placement: the free left axle.
    const slots = validSlotsFor(GUIDED_START_DESIGN, DRIVE_WHEEL);
    expect(slots).toHaveLength(1);
    expect(slots[0].parentConnector).toBe("axle-left");
    expect(DRIVE_WHEEL.id).toBe(GUIDED_PART_ID);
  });

  it("advances each step only on its own demonstration, never backward", () => {
    const idle = { partCount: 3, fightStarted: false, shopOpened: false };
    expect(nextGuideStep("place", idle)).toBe("place");
    expect(nextGuideStep("place", { ...idle, partCount: 4 })).toBe("fight");
    expect(nextGuideStep("fight", { ...idle, partCount: 4 })).toBe("fight");
    expect(
      nextGuideStep("fight", { ...idle, partCount: 4, fightStarted: true }),
    ).toBe("shop");
    expect(nextGuideStep("shop", { ...idle, partCount: 4 })).toBe("shop");
    expect(nextGuideStep("shop", { ...idle, shopOpened: true })).toBe("done");
    expect(nextGuideStep("done", idle)).toBe("done");
    // Removing the wheel after the fact does not reopen the place step.
    expect(nextGuideStep("fight", { ...idle, partCount: 1 })).toBe("fight");
  });

  it("lets a later demonstration clear the earlier steps in one pass", () => {
    // A player who loads a blueprint and fights it has placed and fought.
    expect(
      nextGuideStep("place", {
        partCount: 5,
        fightStarted: true,
        shopOpened: false,
      }),
    ).toBe("shop");
    expect(
      nextGuideStep("place", {
        partCount: 5,
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
      expect(GUIDE_CARDS[step].line).not.toMatch(/[–—]/);
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
