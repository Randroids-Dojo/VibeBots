"use client";

import { useFrame } from "@react-three/fiber";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import {
  Color,
  type Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from "three/webgpu";
import {
  BUNKER_RAID_TIER_CAP,
  type BunkerFootprint,
  type ClankerKind,
} from "@/sim/bunker";
import { liveRaidWaveSize } from "@/sim/bunker-raid-live";
import { type FpRaidRuntime, fpRaidInterpFactor } from "./bunker-fp-raid";
import {
  animateClankerBody,
  ClankerBody,
  type ClankerParts,
  setGroupMaterialOpacity,
} from "./clanker-visual";
import {
  CLANKER_BURST_VISIBLE_SECONDS,
  dissipatingOpacity,
  transientAnimationActive,
  transientAnimationProgress,
} from "./mine-transient-animation";

/** The biggest wave the raid can field (tier cap), so the render pool is
 * sized once and slots toggle visibility instead of mounting per raid. */
const FP_MAX_CLANKERS = liveRaidWaveSize(BUNKER_RAID_TIER_CAP);
const FP_XP_CAPACITY = FP_MAX_CLANKERS;

// Orientation of the shared ClankerBody (authored lying in the 2D xy-plane
// facing +x, top toward +z) into the upright first-person room: tip it so
// its top faces up, sit it just above the cell floor, and shrink it to fit
// a one-unit cell.
const FP_CLANKER_TILT_X = -Math.PI / 2;
const FP_CLANKER_SCALE = 0.62;
const FP_CLANKER_FLOOR_LIFT = 0.32;

/** How long a Clanker's breach emergence plays as it crosses into the
 * room: the body scales up from the wall while a burrow burst flares and
 * fades, so an arrival reads as an event instead of a pop-in (F-218). */
const FP_BREACH_SECONDS = 0.7;

const UP_AXIS = new Vector3(0, 1, 0);

// Shared XP-pickup singletons and reused scratch (frame-loop rule: no
// per-frame allocation).
const XP_GEOMETRY = new OctahedronGeometry(0.24, 0);
const XP_MATERIAL = new MeshStandardMaterial({
  color: "#39ff14",
  emissive: new Color("#1f8f10"),
  emissiveIntensity: 0.9,
  roughness: 0.3,
  metalness: 0.1,
});
const xpMatrix = new Matrix4();
const xpPosition = new Vector3();
const xpQuaternion = new Quaternion();
const xpScale = new Vector3(1, 1, 1);

/** One pooled Clanker's stable refs plus its death clock (seconds since it
 * died, or -1 while alive/idle). Built once so the frame loop allocates
 * nothing. */
interface FpClankerSlot {
  group: RefObject<Group | null>;
  yaw: RefObject<Group | null>;
  wobble: RefObject<Group | null>;
  burst: RefObject<Group | null>;
  parts: ClankerParts;
  deathElapsed: number;
  /** Seconds since this Clanker breached into the room, or -1 when no
   * emergence is playing (still outside, or long since arrived). */
  breachElapsed: number;
}

function createSlot(): FpClankerSlot {
  return {
    group: { current: null },
    yaw: { current: null },
    wobble: { current: null },
    burst: { current: null },
    parts: {
      body: { current: null },
      legs: { current: [] },
      mandibles: { current: [] },
      sensor: { current: null },
      eye: { current: null },
    },
    deathElapsed: -1,
    breachElapsed: -1,
  };
}

/**
 * Renders the live raid inside the first-person bunker: a fixed pool of
 * Clanker bodies tweened between their sim cells, and an instanced layer
 * of uncollected XP pickups. Both read the shared raid runtime the rig
 * steps, so this owns no raid logic. When no raid runs the pool hides
 * itself and costs nothing to draw.
 */
export function FpClankerLayer({
  runtimeRef,
  footprint,
}: {
  runtimeRef: RefObject<FpRaidRuntime | null>;
  footprint: BunkerFootprint;
}) {
  const slotsRef = useRef<FpClankerSlot[]>([]);
  if (slotsRef.current.length === 0) {
    slotsRef.current = Array.from({ length: FP_MAX_CLANKERS }, createSlot);
  }
  const slots = slotsRef.current;
  const xpGroupRef = useRef<Group | null>(null);
  const xpMeshRef = useRef<InstancedMesh | null>(null);
  // How many Clanker bodies this layer is currently drawing, mirrored to a
  // dataset probe so tests can prove the wave renders (not just that the HUD
  // counts it). Only written when it changes, so the frame loop allocates no
  // strings in steady state.
  const drawnCountRef = useRef(-1);
  // Per-slot Clanker kind so breachers and tanks wear their specialist
  // carapace tint (F-159), matching the flat raid. Stable within a raid and
  // only changes when a new wave assigns different kinds, so it lives in
  // state that the frame loop refreshes at most once per raid (guarded by
  // kindsRef), never per frame.
  const [kinds, setKinds] = useState<ClankerKind[]>(() =>
    Array.from({ length: FP_MAX_CLANKERS }, () => "standard" as ClankerKind),
  );
  const kindsRef = useRef(kinds);

  useLayoutEffect(() => {
    const group = xpGroupRef.current;
    if (!group) return;
    const mesh = new InstancedMesh(XP_GEOMETRY, XP_MATERIAL, FP_XP_CAPACITY);
    mesh.frustumCulled = false;
    mesh.count = 0;
    group.add(mesh);
    xpMeshRef.current = mesh;
    return () => {
      group.remove(mesh);
      mesh.dispose();
      xpMeshRef.current = null;
    };
  }, []);

  const bottomRow = footprint.row + footprint.height - 1;
  const worldX = (col: number) => col - footprint.col;
  const worldY = (row: number) => bottomRow - row;

  useFrame((state, delta) => {
    const runtime = runtimeRef.current;
    const elapsed = state.clock.elapsedTime;
    const factor = runtime ? fpRaidInterpFactor(runtime) : 0;
    // Refresh the specialist tints only when a wave actually assigns new
    // kinds (raid start), never per frame. The scan and the equality check
    // allocate nothing; the replacement array is built once, on a change.
    if (runtime) {
      const current = kindsRef.current;
      let kindsChanged = false;
      for (let index = 0; index < FP_MAX_CLANKERS; index += 1) {
        if (current[index] !== (runtime.views[index]?.kind ?? "standard")) {
          kindsChanged = true;
          break;
        }
      }
      if (kindsChanged) {
        const next = Array.from(
          { length: FP_MAX_CLANKERS },
          (_, index) => runtime.views[index]?.kind ?? "standard",
        );
        kindsRef.current = next;
        setKinds(next);
        // Mirror the distinct kinds this wave fields so a test can prove the
        // specialist tints reach the render layer. Sourced from `next`, the
        // exact array the slot JSX indexes for its `kind` prop (over the live
        // wave range), so the probe tracks what the bodies render, not the raw
        // sim views. Built once per raid, in this change branch, so the frame
        // loop stays allocation-free.
        const distinct = new Set<string>();
        for (let index = 0; index < runtime.views.length; index += 1) {
          distinct.add(next[index]);
        }
        state.gl.domElement.dataset.fpClankerKinds = Array.from(distinct)
          .sort()
          .join(",");
      }
    }
    let drawn = 0;
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      const group = slot.group.current;
      if (!group) continue;
      const view = runtime?.views[index];
      if (!view) {
        group.visible = false;
        slot.deathElapsed = -1;
        slot.breachElapsed = -1;
        continue;
      }
      if (view.alive) {
        slot.deathElapsed = -1;
        if (!view.inside) {
          // Still burrowing through the mine rock outside the claim. All
          // six room faces are solid, so there is nothing to draw yet.
          group.visible = false;
          slot.breachElapsed = -1;
          continue;
        }
        if (view.justEntered) slot.breachElapsed = 0;
        group.visible = true;
        drawn += 1;
        if (slot.parts.body.current) slot.parts.body.current.visible = true;
        const fx = worldX(view.fromCol);
        const fy = worldY(view.fromRow);
        const fz = -view.fromDepth;
        const tx = worldX(view.toCol);
        const ty = worldY(view.toRow);
        const tz = -view.toDepth;
        const x = fx + (tx - fx) * factor;
        const y = fy + (ty - fy) * factor;
        const z = fz + (tz - fz) * factor;
        group.position.set(x, y + FP_CLANKER_FLOOR_LIFT, z);
        // Breach emergence: the body scales up out of the wall while the
        // burrow burst flares and fades, then the clock disarms.
        const burst = slot.burst.current;
        if (slot.breachElapsed >= 0) {
          slot.breachElapsed += delta;
          const progress = Math.min(1, slot.breachElapsed / FP_BREACH_SECONDS);
          group.scale.setScalar(FP_CLANKER_SCALE * (0.25 + 0.75 * progress));
          if (burst) {
            burst.visible = progress < 1;
            burst.scale.setScalar(0.5 + progress * 0.9);
            setGroupMaterialOpacity(burst, 1 - progress);
          }
          if (progress >= 1) slot.breachElapsed = -1;
        } else {
          group.scale.setScalar(FP_CLANKER_SCALE);
          if (burst) burst.visible = false;
        }
        const moving = tx !== fx || tz !== fz || ty !== fy;
        const yawGroup = slot.yaw.current;
        if (yawGroup && (tx !== fx || tz !== fz)) {
          yawGroup.rotation.y = Math.atan2(tx - fx, tz - fz);
        }
        const wobble = slot.wobble.current;
        if (wobble) animateClankerBody(wobble, slot.parts, elapsed, moving, 0);
      } else {
        slot.breachElapsed = -1;
        if (view.justDied && slot.deathElapsed < 0) slot.deathElapsed = 0;
        if (slot.deathElapsed < 0 || !view.inside) {
          // Died before this layer saw the transition, or died out in the
          // rock where the burst could never be seen: just hide it.
          group.visible = false;
          continue;
        }
        slot.deathElapsed += delta;
        const active = transientAnimationActive(
          slot.deathElapsed,
          CLANKER_BURST_VISIBLE_SECONDS,
        );
        group.visible = active;
        if (active) drawn += 1;
        if (slot.parts.body.current) slot.parts.body.current.visible = false;
        const burst = slot.burst.current;
        if (burst) {
          burst.visible = active;
          if (active) {
            const progress = transientAnimationProgress(
              slot.deathElapsed,
              CLANKER_BURST_VISIBLE_SECONDS,
            );
            burst.scale.setScalar(0.6 + progress * 1.05);
            setGroupMaterialOpacity(
              burst,
              dissipatingOpacity(
                slot.deathElapsed,
                CLANKER_BURST_VISIBLE_SECONDS,
              ),
            );
          }
        }
      }
    }

    // Uncollected XP pickups: rebuild the small instance set each frame,
    // reusing scratch so nothing allocates.
    const xpMesh = xpMeshRef.current;
    if (xpMesh) {
      let count = 0;
      if (runtime) {
        const pickups = runtime.state.xpPickups;
        for (let p = 0; p < pickups.length; p += 1) {
          const pickup = pickups[p];
          if (pickup.collected) continue;
          // A Clanker that died out in the rock drops its pickup outside
          // the claim, where the player can never walk: nothing to draw.
          if (
            pickup.col < footprint.col ||
            pickup.col >= footprint.col + footprint.width ||
            pickup.row < footprint.row ||
            pickup.row >= footprint.row + footprint.height
          ) {
            continue;
          }
          if (count >= FP_XP_CAPACITY) break;
          xpPosition.set(
            worldX(pickup.col),
            worldY(pickup.row) - 0.2 + Math.sin(elapsed * 2 + count) * 0.05,
            -pickup.depth,
          );
          xpQuaternion.setFromAxisAngle(UP_AXIS, elapsed * 1.6 + count);
          xpMatrix.compose(xpPosition, xpQuaternion, xpScale);
          xpMesh.setMatrixAt(count, xpMatrix);
          count += 1;
        }
      }
      xpMesh.count = count;
      xpMesh.instanceMatrix.needsUpdate = true;
    }

    if (drawn !== drawnCountRef.current) {
      drawnCountRef.current = drawn;
      state.gl.domElement.dataset.fpClankersVisible = String(drawn);
    }
  });

  return (
    <>
      {slots.map((slot, index) => (
        <group
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size pool, stable order.
          key={`fp-clanker:${index}`}
          ref={slot.group}
          visible={false}
        >
          <group ref={slot.yaw}>
            <group rotation={[FP_CLANKER_TILT_X, 0, 0]}>
              <group ref={slot.wobble}>
                <ClankerBody
                  kind={kinds[index]}
                  parts={slot.parts}
                  burstRef={slot.burst}
                />
              </group>
            </group>
          </group>
        </group>
      ))}
      <group ref={xpGroupRef} />
    </>
  );
}
