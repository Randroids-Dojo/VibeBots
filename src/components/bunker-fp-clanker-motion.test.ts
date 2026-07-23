import { wrapAngle } from "@randroids-dojo/vibekit";
import { describe, expect, it } from "vitest";
import type { BunkerFootprint } from "@/sim/bunker";
import {
  dampAngleToward,
  fpClankerInsideRoom,
  fpClankerTravelPitch,
  fpClankerTravelYaw,
} from "./bunker-fp-clanker-motion";

const FOOTPRINT: BunkerFootprint = { col: 5, row: 5, width: 7, height: 5 };

describe("fpClankerTravelYaw", () => {
  // The authored body faces world +x at yaw 0, and a three.js rotation.y
  // of a maps that forward onto (cos a, 0, -sin a). Each cardinal hop
  // must produce the yaw whose forward IS the travel direction.
  const cardinals: Array<{ name: string; dx: number; dz: number }> = [
    { name: "+x (right along the room)", dx: 1, dz: 0 },
    { name: "-x (left along the room)", dx: -1, dz: 0 },
    { name: "-z (deeper into the claim)", dx: 0, dz: -1 },
    { name: "+z (back toward the mine face)", dx: 0, dz: 1 },
  ];
  for (const { name, dx, dz } of cardinals) {
    it(`faces travel ${name}`, () => {
      const yaw = fpClankerTravelYaw(dx, dz, 0);
      expect(Math.cos(yaw)).toBeCloseTo(dx, 10);
      expect(-Math.sin(yaw)).toBeCloseTo(dz, 10);
    });
  }

  it("keeps the caller's yaw on a purely vertical hop", () => {
    expect(fpClankerTravelYaw(0, 0, 1.234)).toBe(1.234);
  });
});

describe("fpClankerTravelPitch", () => {
  it("is level on a horizontal hop", () => {
    expect(fpClankerTravelPitch(1, 0, 0)).toBe(0);
    expect(fpClankerTravelPitch(0, 0, -1)).toBe(0);
  });

  it("noses straight up climbing a row", () => {
    expect(fpClankerTravelPitch(0, 1, 0)).toBeCloseTo(Math.PI / 2, 10);
  });

  it("noses straight down descending a row", () => {
    expect(fpClankerTravelPitch(0, -1, 0)).toBeCloseTo(-Math.PI / 2, 10);
  });

  it("slopes for mixed motion", () => {
    expect(fpClankerTravelPitch(1, 1, 0)).toBeCloseTo(Math.PI / 4, 10);
  });
});

describe("dampAngleToward", () => {
  it("converges onto the target without overshooting", () => {
    let angle = 0;
    for (let i = 0; i < 120; i += 1) {
      angle = dampAngleToward(angle, Math.PI / 2, 10, 1 / 60);
      expect(angle).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    }
    expect(angle).toBeCloseTo(Math.PI / 2, 3);
  });

  it("crosses the wrap instead of spinning the long way", () => {
    // From just below +PI toward just above -PI: one small forward step,
    // not a near-full backward revolution.
    const next = dampAngleToward(3.1, -3.1, 10, 1 / 60);
    expect(next).toBeGreaterThan(3.1);
    expect(wrapAngle(-3.1 - next)).toBeGreaterThan(0);
  });

  it("holds still at zero delta time", () => {
    expect(dampAngleToward(1, 2, 10, 0)).toBe(1);
  });
});

describe("fpClankerInsideRoom", () => {
  it("is true across the footprint interior", () => {
    expect(fpClankerInsideRoom(FOOTPRINT, 5, 5)).toBe(true);
    expect(fpClankerInsideRoom(FOOTPRINT, 11, 9)).toBe(true);
    expect(fpClankerInsideRoom(FOOTPRINT, 8, 7.4)).toBe(true);
  });

  it("flips exactly at the rock face on an enter hop", () => {
    // Hop from approach col 4 into edge col 5: the shared face plane sits
    // at col 4.5. Outside until the center clears the face, inside after.
    expect(fpClankerInsideRoom(FOOTPRINT, 4.4, 7)).toBe(false);
    expect(fpClankerInsideRoom(FOOTPRINT, 4.5, 7)).toBe(false);
    expect(fpClankerInsideRoom(FOOTPRINT, 4.6, 7)).toBe(true);
    // Same on the far column and both row edges.
    expect(fpClankerInsideRoom(FOOTPRINT, 11.5, 7)).toBe(false);
    expect(fpClankerInsideRoom(FOOTPRINT, 11.4, 7)).toBe(true);
    expect(fpClankerInsideRoom(FOOTPRINT, 8, 4.5)).toBe(false);
    expect(fpClankerInsideRoom(FOOTPRINT, 8, 4.6)).toBe(true);
    expect(fpClankerInsideRoom(FOOTPRINT, 8, 9.5)).toBe(false);
    expect(fpClankerInsideRoom(FOOTPRINT, 8, 9.4)).toBe(true);
  });
});
