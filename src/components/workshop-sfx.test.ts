import { describe, expect, it } from "vitest";
import { workshopSfxTones } from "./workshop-sfx";

describe("workshop sfx tones", () => {
  it("plays a distinct recipe per event", () => {
    const place = workshopSfxTones("place");
    const merge = workshopSfxTones("merge");
    expect(place).not.toEqual(merge);
    expect(place.length).toBeGreaterThan(0);
    expect(merge.length).toBeGreaterThan(0);
  });

  it("gives the merge chime rising pitch and the snap falling pitch", () => {
    const merge = workshopSfxTones("merge");
    expect(merge[1].start).toBeGreaterThan(merge[0].start);
    expect(merge[1].delay).toBeGreaterThan(0);
    const [snap] = workshopSfxTones("place");
    expect(snap.end).toBeLessThan(snap.start);
  });

  it("keeps every tone short and quiet enough for UI feedback", () => {
    for (const event of ["place", "merge"] as const) {
      for (const step of workshopSfxTones(event)) {
        expect(step.len).toBeLessThanOrEqual(0.2);
        expect(step.gain).toBeLessThanOrEqual(0.15);
      }
    }
  });
});
