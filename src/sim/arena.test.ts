import { describe, expect, it } from "vitest";
import {
  ARENA_WALL_HALF_EXTENT,
  ARENA_WALL_RESTITUTION,
  ARENAS,
  createArenaWorld,
} from "./arena";
import { CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN } from "./design";
import { fnv1a64 } from "./hash";
import { resolveMatch } from "./resolve";
import { ensureRapier } from "./world";

/**
 * Launch a dynamic block straight at the +z wall and step it. Returns the
 * peak z reached and the z velocity after the bounce, plus a snapshot hash
 * for the determinism check. (F-063: the ring keeps bots in the brawl.)
 */
async function bounceOffWall(steps: number): Promise<{
  hash: string;
  peakZ: number;
  reboundVz: number;
}> {
  const R = await ensureRapier();
  const world = await createArenaWorld();
  try {
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(0, 0.5, ARENA_WALL_HALF_EXTENT - 2)
        .setLinvel(0, 0, 40)
        .setLinearDamping(0)
        .setGravityScale(0),
    );
    world.createCollider(
      R.ColliderDesc.cuboid(0.4, 0.4, 0.4).setRestitution(
        ARENA_WALL_RESTITUTION,
      ),
      body,
    );
    let peakZ = Number.NEGATIVE_INFINITY;
    // The most negative z velocity seen: the launch is pure +z, so any
    // negative reading is the wall having thrown the body back.
    let reboundVz = 0;
    for (let i = 0; i < steps; i++) {
      world.step();
      peakZ = Math.max(peakZ, body.translation().z);
      reboundVz = Math.min(reboundVz, body.linvel().z);
    }
    return {
      hash: fnv1a64(world.takeSnapshot()),
      peakZ,
      reboundVz,
    };
  } finally {
    world.free();
  }
}

describe("arena specs (the arenas program)", () => {
  it("builds the Ring by default, byte for byte the explicit Ring", async () => {
    const byDefault = await createArenaWorld();
    const explicit = await createArenaWorld(ARENAS.ring);
    expect(fnv1a64(byDefault.takeSnapshot())).toBe(
      fnv1a64(explicit.takeSnapshot()),
    );
    byDefault.free();
    explicit.free();
  });

  it("the Pit is a tighter, bouncier ring whose world differs from the Ring's", async () => {
    expect(ARENAS.pit.wallHalfExtent).toBeLessThan(ARENAS.ring.wallHalfExtent);
    expect(ARENAS.pit.wallRestitution).toBeGreaterThan(
      ARENAS.ring.wallRestitution,
    );
    const ring = await createArenaWorld(ARENAS.ring);
    const pit = await createArenaWorld(ARENAS.pit);
    expect(fnv1a64(pit.takeSnapshot())).not.toBe(fnv1a64(ring.takeSnapshot()));
    ring.free();
    pit.free();
  });

  it("a fight names its arena and hashes differently in each", async () => {
    const ring = await resolveMatch([CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN]);
    const pit = await resolveMatch(
      [CPU_BRAWLER_DESIGN, TEST_BOT_DESIGN],
      undefined,
      {
        arenaId: "pit",
      },
    );
    expect(ring.arenaId).toBe("ring");
    expect(pit.arenaId).toBe("pit");
    expect(pit.hash).not.toBe(ring.hash);
  }, 60_000);
});

describe("arena bounce walls (F-063)", () => {
  it("keeps a launched body inside the ring and rebounds it", async () => {
    const { peakZ, reboundVz } = await bounceOffWall(90);
    // The block is stopped at the wall, not tunneled past it: its center
    // never reaches the far side of the wall (a tunneling body would run
    // off to tens of units of z within these steps).
    expect(peakZ).toBeLessThan(ARENA_WALL_HALF_EXTENT + 1);
    // The wall threw it back: the launch was pure +z, so a negative
    // velocity can only come from the rebound.
    expect(reboundVz).toBeLessThan(0);
  });

  it("resolves the wall collision deterministically", async () => {
    const a = await bounceOffWall(90);
    const b = await bounceOffWall(90);
    expect(b.hash).toBe(a.hash);
    expect(b.peakZ).toBe(a.peakZ);
    expect(b.reboundVz).toBe(a.reboundVz);
  });
});
