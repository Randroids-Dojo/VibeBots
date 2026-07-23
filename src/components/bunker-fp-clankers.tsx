"use client";

import { useFrame } from "@react-three/fiber";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import {
  BoxGeometry,
  Color,
  type Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three/webgpu";
import {
  BUNKER_RAID_TIER_CAP,
  type BunkerFootprint,
  type ClankerKind,
} from "@/sim/bunker";
import { liveRaidWaveSize } from "@/sim/bunker-raid-live";
import {
  dampAngleToward,
  FP_CLANKER_TURN_RATE,
  fpClankerInsideRoom,
  fpClankerTravelPitch,
  fpClankerTravelYaw,
} from "./bunker-fp-clanker-motion";
import { type FpRaidRuntime, fpRaidInterpFactor } from "./bunker-fp-raid";
import {
  animateClankerBody,
  ClankerBody,
  type ClankerParts,
  driveDissipatingGroup,
} from "./clanker-visual";
import {
  CLANKER_BURST_VISIBLE_SECONDS,
  transientAnimationActive,
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

/** How long the rock-dust puff lingers when a Clanker burrows through the
 * room's rock face (entering from the exterior approach, or tunneling back
 * out to flank). Short: it covers the crossing, not the walk. */
const FP_EMERGE_DUST_SECONDS = 0.45;

// Shared burrow-dust geometries (one per shape, like the mine's block
// geometries): the materials stay per-slot because each slot's dust
// fades independently, but the shapes carry no per-slot state.
const FP_DUST_PUFF_GEOMETRY = new SphereGeometry(0.26, 10, 7);
const FP_DUST_SHARD_GEOMETRY = new BoxGeometry(0.11, 0.07, 0.08);

/** Fixed shard offsets for the burrow dust, world-unit scale 1. */
const FP_DUST_SHARDS = [
  { x: -0.16, y: 0.1, z: 0.06, angle: 0.5 },
  { x: 0.18, y: 0.02, z: -0.08, angle: -0.4 },
  { x: 0.02, y: 0.22, z: 0.1, angle: 1.1 },
  { x: -0.06, y: -0.12, z: -0.12, angle: -0.9 },
] as const;

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

/** One pooled Clanker's stable refs plus its per-slot animation clocks and
 * damped travel pose. Built once so the frame loop allocates nothing. */
interface FpClankerSlot {
  group: RefObject<Group | null>;
  yaw: RefObject<Group | null>;
  pitch: RefObject<Group | null>;
  wobble: RefObject<Group | null>;
  burst: RefObject<Group | null>;
  dust: RefObject<Group | null>;
  parts: ClankerParts;
  /** Seconds since this Clanker died, or -1 while alive/idle. */
  deathElapsed: number;
  /** Seconds since it last burrowed through the room's rock face, or -1. */
  dustElapsed: number;
  /** Whether the body was inside the visible room last frame: 1 in, 0 out
   * in the approach (buried in shell rock), -1 not yet known. */
  inRoom: number;
  /** Damped travel heading, applied to the yaw and pitch groups. */
  yawAngle: number;
  pitchAngle: number;
}

function resetSlot(slot: FpClankerSlot): void {
  slot.deathElapsed = -1;
  slot.dustElapsed = -1;
  slot.inRoom = -1;
  slot.yawAngle = 0;
  slot.pitchAngle = 0;
}

function createSlot(): FpClankerSlot {
  const slot: FpClankerSlot = {
    group: { current: null },
    yaw: { current: null },
    pitch: { current: null },
    wobble: { current: null },
    burst: { current: null },
    dust: { current: null },
    parts: {
      body: { current: null },
      legs: { current: [] },
      mandibles: { current: [] },
      sensor: { current: null },
      eye: { current: null },
    },
    // Clock and pose idle values are owned by resetSlot (single source).
    deathElapsed: 0,
    dustElapsed: 0,
    inRoom: 0,
    yawAngle: 0,
    pitchAngle: 0,
  };
  resetSlot(slot);
  return slot;
}

/**
 * Renders the live raid inside the first-person bunker: a fixed pool of
 * Clanker bodies tweened between their sim cells, and an instanced layer
 * of uncollected XP pickups. Both read the shared raid runtime the rig
 * steps, so this owns no raid logic. When no raid runs the pool hides
 * itself and costs nothing to draw.
 *
 * Travel presentation: each body yaws to face its horizontal heading and
 * pitches into vertical hops (the sim navigates all six axes), with both
 * angles damped so corners read as turns. A Clanker out in the exterior
 * approach is buried in the claim's shell rock and is NOT drawn; when its
 * center burrows through the rock face into the room it appears with a
 * rock-dust puff at the crossing point instead of ghosting through the
 * rendered wall (and it dusts again if it tunnels back out to flank).
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
  // Per-slot clocks and pose survive across frames but must not leak from
  // one raid into the next wave's fresh spawns.
  const raidIdRef = useRef<string | null>(null);
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
    // A new raid means fresh spawns: drop the per-slot clocks and poses so
    // last wave's death animation, dust, or heading never bleeds in.
    const raidId = runtime ? runtime.state.raidId : null;
    if (raidId !== raidIdRef.current) {
      raidIdRef.current = raidId;
      for (let index = 0; index < slots.length; index += 1) {
        resetSlot(slots[index]);
      }
    }
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

      // The burrow dust outlives the state that fired it, so it advances
      // before the alive/dead branching (it hides with everything else
      // when the raid clears).
      const dust = slot.dust.current;
      if (dust) {
        if (!view || slot.dustElapsed < 0) {
          dust.visible = false;
          slot.dustElapsed = -1;
        } else {
          slot.dustElapsed += delta;
          if (
            !driveDissipatingGroup(
              dust,
              slot.dustElapsed,
              FP_EMERGE_DUST_SECONDS,
              0.35,
              0.85,
            )
          ) {
            slot.dustElapsed = -1;
          }
        }
      }

      if (!view) {
        group.visible = false;
        slot.deathElapsed = -1;
        continue;
      }
      if (view.alive) {
        slot.deathElapsed = -1;
        // Interpolate in grid coordinates first: the room-visibility test
        // is a grid-space rule (face planes at half-cell bounds).
        const colF = view.fromCol + (view.toCol - view.fromCol) * factor;
        const rowF = view.fromRow + (view.toRow - view.fromRow) * factor;
        const depthF =
          view.fromDepth + (view.toDepth - view.fromDepth) * factor;
        const inRoom = fpClankerInsideRoom(footprint, colF, rowF) ? 1 : 0;
        const x = worldX(colF);
        const y = worldY(rowF) + FP_CLANKER_FLOOR_LIFT;
        const z = -depthF;
        if (slot.inRoom >= 0 && inRoom !== slot.inRoom) {
          // Crossing the rock face: kick a dust puff at the crossing point
          // so the body reads as burrowing through, not ghosting. The dust
          // block above renders it from the next frame.
          slot.dustElapsed = 0;
          if (dust) dust.position.set(x, y, z);
        }
        slot.inRoom = inRoom;
        group.visible = inRoom === 1;
        // Travel heading: yaw onto the horizontal direction, pitch into
        // vertical hops, both damped so corners read as turns. World y
        // grows as sim rows shrink, and world z is negative depth.
        const dxw = view.toCol - view.fromCol;
        const dyw = view.fromRow - view.toRow;
        const dzw = view.fromDepth - view.toDepth;
        slot.yawAngle = dampAngleToward(
          slot.yawAngle,
          fpClankerTravelYaw(dxw, dzw, slot.yawAngle),
          FP_CLANKER_TURN_RATE,
          delta,
        );
        slot.pitchAngle = dampAngleToward(
          slot.pitchAngle,
          fpClankerTravelPitch(dxw, dyw, dzw),
          FP_CLANKER_TURN_RATE,
          delta,
        );
        if (inRoom === 0) continue;
        drawn += 1;
        if (slot.parts.body.current) slot.parts.body.current.visible = true;
        group.position.set(x, y, z);
        const yawGroup = slot.yaw.current;
        if (yawGroup) yawGroup.rotation.y = slot.yawAngle;
        const pitchGroup = slot.pitch.current;
        if (pitchGroup) pitchGroup.rotation.z = slot.pitchAngle;
        const moving = dxw !== 0 || dyw !== 0 || dzw !== 0;
        const wobble = slot.wobble.current;
        if (wobble) animateClankerBody(wobble, slot.parts, elapsed, moving, 0);
        if (slot.burst.current) slot.burst.current.visible = false;
      } else {
        // A death out in the approach happened inside shell rock: nothing
        // to show, and no burst may bleed through the wall.
        if (!fpClankerInsideRoom(footprint, view.toCol, view.toRow)) {
          group.visible = false;
          slot.deathElapsed = -1;
          continue;
        }
        if (view.justDied && slot.deathElapsed < 0) slot.deathElapsed = 0;
        if (slot.deathElapsed < 0) {
          // Died before this layer saw the transition: just hide it.
          group.visible = false;
          continue;
        }
        // Pin the burst to the terminal cell: the sim killed it ON
        // view.to, so the death animation must not linger at whatever
        // interpolated point the last alive frame happened to draw.
        group.position.set(
          worldX(view.toCol),
          worldY(view.toRow) + FP_CLANKER_FLOOR_LIFT,
          -view.toDepth,
        );
        slot.deathElapsed += delta;
        const burst = slot.burst.current;
        const active = burst
          ? driveDissipatingGroup(
              burst,
              slot.deathElapsed,
              CLANKER_BURST_VISIBLE_SECONDS,
              0.6,
              1.05,
            )
          : transientAnimationActive(
              slot.deathElapsed,
              CLANKER_BURST_VISIBLE_SECONDS,
            );
        group.visible = active;
        if (active) drawn += 1;
        if (slot.parts.body.current) slot.parts.body.current.visible = false;
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
          // A Clanker that drained out in the approach dropped its pickup
          // inside shell rock, where the player can never walk: draw
          // nothing there (integer cell centers, so the room test holds).
          if (!fpClankerInsideRoom(footprint, pickup.col, pickup.row)) {
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
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size pool, stable order.
        <group key={`fp-clanker:${index}`}>
          <group ref={slot.group} visible={false} scale={FP_CLANKER_SCALE}>
            <group ref={slot.yaw}>
              <group ref={slot.pitch}>
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
          </group>
          {/* Burrow dust: positioned at the rock-face crossing point, a
              sibling of the body group so it stays visible while the body
              is still buried on the far side of the face. */}
          <group ref={slot.dust} visible={false}>
            <mesh geometry={FP_DUST_PUFF_GEOMETRY}>
              <meshStandardMaterial
                color="#8a8177"
                roughness={0.95}
                metalness={0.02}
                flatShading
              />
            </mesh>
            {FP_DUST_SHARDS.map((shard) => (
              <mesh
                key={`dust:${shard.x}:${shard.y}`}
                geometry={FP_DUST_SHARD_GEOMETRY}
                position={[shard.x, shard.y, shard.z]}
                rotation={[shard.angle, 0.3, shard.angle * 0.7]}
              >
                <meshStandardMaterial
                  color="#6f675c"
                  roughness={0.9}
                  metalness={0.04}
                  flatShading
                />
              </mesh>
            ))}
          </group>
        </group>
      ))}
      <group ref={xpGroupRef} />
    </>
  );
}
