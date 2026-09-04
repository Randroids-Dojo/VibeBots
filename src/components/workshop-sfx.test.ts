import { describe, expect, it } from "vitest";
import { workshopSfxTones } from "./workshop-sfx";

describe("workshop sfx tones", () => {
  it("plays a distinct recipe per event", () => {
    const place = workshopSfxTones("place");
    const remove = workshopSfxTones("remove");
    expect(place).not.toEqual(remove);
    expect(place.length).toBeGreaterThan(0);
    expect(remove.length).toBeGreaterThan(0);
  });

  it("gives the snap a falling pitch and the remove a fall too", () => {
    const [snap] = workshopSfxTones("place");
    expect(snap.end).toBeLessThan(snap.start);
    const [whoosh] = workshopSfxTones("remove");
    expect(whoosh.end).toBeLessThan(whoosh.start);
  });

  it("keeps every tone short and quiet enough for UI feedback", () => {
    for (const event of ["place", "remove"] as const) {
      for (const step of workshopSfxTones(event)) {
        expect(step.len).toBeLessThanOrEqual(0.2);
        expect(step.gain).toBeLessThanOrEqual(0.15);
      }
    }
  });
});
