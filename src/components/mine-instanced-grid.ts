/**
 * Imperative instanced grid for the mine cell block bodies (F-075
 * escalation). The per-cell React grid mounted and unmounted a three.js
 * mesh for every solid cell that scrolled through the view window; a
 * fall or a ladder descent scrolls a whole row per action, so React
 * reconciled a row of mounts and a row of unmounts every tick, and the
 * scene-graph churn (plus the garbage it made) is the residual mine lag
 * the F-075 element cache could not reach. This draws the dominant mass,
 * the static solid blocks (dirt, ore bodies, rock, metal), as a handful
 * of InstancedMeshes whose instance buffers are rewritten in place, the
 * same shape as the W3 instanced particle pass. Scrolling the window no
 * longer touches the scene graph: only matrices and counts change.
 *
 * One InstancedMesh per (geometry, material) bucket. Materials are the
 * shared uniform-tinted singletons from mine-block-materials.ts, so the
 * blocks render pixel-identical to the React path (the per-cell tint
 * jitter already rides positionWorld in the shader, which includes the
 * instance transform); only the allocation and the reconciliation change.
 *
 * Frame-loop rule: apply() runs at input cadence (once per store tick /
 * render), never per frame. It reuses module scratch and the caller's
 * pooled plan (mine-block-plan.ts), so steady-state application allocates
 * nothing; a new InstancedMesh is built only the first time a material
 * bucket appears (crossing a stratum or biome), which is rare and bounded.
 */

import {
  type BufferGeometry,
  DynamicDrawUsage,
  Euler,
  type Group,
  InstancedMesh,
  Matrix4,
  type MeshStandardNodeMaterial,
  Quaternion,
  Vector3,
} from "three/webgpu";
import type { BlockInstancePlan } from "./mine-block-plan";

export {
  type BlockInstance,
  type BlockInstancePlan,
  beginBlockPlan,
  createBlockInstancePlan,
  instancedBlockDraw,
  pushBlockInstance,
} from "./mine-block-plan";

interface BlockPool {
  mesh: InstancedMesh;
  geometry: BufferGeometry;
  material: MeshStandardNodeMaterial;
  capacity: number;
  /** Instances this bucket needs this apply(): counted in pass 1, then
   * reused as the write cursor in pass 2. */
  written: number;
}

const INITIAL_POOL_CAPACITY = 512;

// Module scratch: apply() runs at input cadence and reuses these across
// every instance and every tick, so writing matrices allocates nothing.
const SCRATCH_MATRIX = new Matrix4();
const SCRATCH_QUATERNION = new Quaternion();
const SCRATCH_EULER = new Euler();
const SCRATCH_POSITION = new Vector3();
const SCRATCH_SCALE = new Vector3(1, 1, 1);
const IDENTITY_QUATERNION = new Quaternion();

/**
 * Owns the InstancedMeshes for the block grid, parented to one group in
 * the R3F scene. Buckets are keyed by material identity (the shared
 * singletons are 1:1 with their geometry), created lazily, and reused.
 */
export class InstancedBlockGrid {
  private readonly group: Group;
  private readonly pools = new Map<MeshStandardNodeMaterial, BlockPool>();

  constructor(group: Group) {
    this.group = group;
  }

  private poolFor(
    geometry: BufferGeometry,
    material: MeshStandardNodeMaterial,
  ): BlockPool {
    const existing = this.pools.get(material);
    if (existing) return existing;
    const pool: BlockPool = {
      mesh: this.buildMesh(geometry, material, INITIAL_POOL_CAPACITY),
      geometry,
      material,
      capacity: INITIAL_POOL_CAPACITY,
      written: 0,
    };
    this.pools.set(material, pool);
    return pool;
  }

  private buildMesh(
    geometry: BufferGeometry,
    material: MeshStandardNodeMaterial,
    capacity: number,
  ): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, capacity);
    // Instances span the whole window, so a per-mesh bounding sphere would
    // cull wrong; the window itself is the cull (matches the particle pass).
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.group.add(mesh);
    return mesh;
  }

  /** Replace a bucket's mesh with a larger one. Only called in the sizing
   * pass, before any matrix is written this apply(), so there is nothing to
   * copy across. The old buffer is disposed; geometry/material are shared. */
  private grow(pool: BlockPool, needed: number): void {
    let capacity = pool.capacity;
    while (capacity < needed) capacity *= 2;
    this.group.remove(pool.mesh);
    pool.mesh.dispose();
    pool.mesh = this.buildMesh(pool.geometry, pool.material, capacity);
    pool.capacity = capacity;
  }

  /** Rewrite every bucket from the plan in two passes: pass 1 tallies each
   * bucket's demand (creating pools for new materials) and grows undersized
   * buffers before any write; pass 2 streams the matrices. Splitting them
   * keeps a mid-write grow from ever dropping matrices, and buckets no cell
   * used this tick fall to count 0. */
  apply(plan: BlockInstancePlan): void {
    // Pass 1: demand per bucket.
    this.pools.forEach((pool) => {
      pool.written = 0;
    });
    for (let i = 0; i < plan.count; i++) {
      const item = plan.items[i];
      this.poolFor(item.geometry, item.material).written += 1;
    }
    // Size every bucket to its demand up front (no matrices written yet).
    this.pools.forEach((pool) => {
      if (pool.written > pool.capacity) this.grow(pool, pool.written);
      pool.written = 0;
    });
    // Pass 2: stream matrices, advancing each bucket's write cursor.
    for (let i = 0; i < plan.count; i++) {
      const item = plan.items[i];
      const pool = this.poolFor(item.geometry, item.material);
      SCRATCH_POSITION.set(item.x, item.y, 0);
      if (item.rotated) {
        SCRATCH_EULER.set(item.rotX, item.rotY, item.rotZ);
        SCRATCH_QUATERNION.setFromEuler(SCRATCH_EULER);
        SCRATCH_MATRIX.compose(
          SCRATCH_POSITION,
          SCRATCH_QUATERNION,
          SCRATCH_SCALE,
        );
      } else {
        SCRATCH_MATRIX.compose(
          SCRATCH_POSITION,
          IDENTITY_QUATERNION,
          SCRATCH_SCALE,
        );
      }
      pool.mesh.setMatrixAt(pool.written, SCRATCH_MATRIX);
      pool.written += 1;
    }
    this.pools.forEach((pool) => {
      pool.mesh.count = pool.written;
      pool.mesh.instanceMatrix.needsUpdate = true;
    });
  }

  /** Count of live InstancedMeshes (draw buckets); for diagnostics/tests. */
  get bucketCount(): number {
    return this.pools.size;
  }

  /** Detach and free every bucket's instance buffer. The shared geometry
   * and material singletons are intentionally left alive. */
  dispose(): void {
    this.pools.forEach((pool) => {
      this.group.remove(pool.mesh);
      pool.mesh.dispose();
    });
    this.pools.clear();
  }
}
