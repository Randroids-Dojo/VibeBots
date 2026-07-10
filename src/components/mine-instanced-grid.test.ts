import {
  BoxGeometry,
  Group,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
} from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
  beginBlockPlan,
  createBlockInstancePlan,
  pushBlockInstance,
} from "./mine-block-plan";
import { InstancedBlockGrid } from "./mine-instanced-grid";

const BLOCK_GEOMETRY = new BoxGeometry(1, 1, 1);
const BLOCK_MATERIAL = new MeshStandardMaterial();
const VEIL_GEOMETRY = new PlaneGeometry(1.08, 1.08);
const VEIL_MATERIAL = new MeshBasicMaterial({ transparent: true });

function instancePosition(
  group: Group,
  bucket: number,
  index: number,
): Vector3 {
  const mesh = group.children[bucket] as import("three/webgpu").InstancedMesh;
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new Vector3().setFromMatrixPosition(matrix);
}

describe("InstancedBlockGrid", () => {
  it("writes each instance's class z offset into its matrix", () => {
    const group = new Group();
    const grid = new InstancedBlockGrid(group);
    const plan = beginBlockPlan(createBlockInstancePlan());
    pushBlockInstance(plan, BLOCK_GEOMETRY, BLOCK_MATERIAL, 3, -7, 0, 0, 0, 0);
    pushBlockInstance(plan, VEIL_GEOMETRY, VEIL_MATERIAL, 4, -7, 0.72, 0, 0, 0);
    grid.apply(plan);

    expect(grid.bucketCount).toBe(2);
    const body = instancePosition(group, 0, 0);
    expect(body).toMatchObject({ x: 3, y: -7, z: 0 });
    // The matrix buffer is float32, so compare the veil's z approximately.
    const veil = instancePosition(group, 1, 0);
    expect(veil.x).toBe(4);
    expect(veil.y).toBe(-7);
    expect(veil.z).toBeCloseTo(0.72, 5);
  });

  it("draws a transparent bucket after the default transparent pass", () => {
    const group = new Group();
    const grid = new InstancedBlockGrid(group);
    const plan = beginBlockPlan(createBlockInstancePlan());
    pushBlockInstance(plan, BLOCK_GEOMETRY, BLOCK_MATERIAL, 0, 0, 0, 0, 0, 0);
    pushBlockInstance(plan, VEIL_GEOMETRY, VEIL_MATERIAL, 0, 0, 0.72, 0, 0, 0);
    grid.apply(plan);

    const [blocks, veil] = group.children;
    expect(blocks.renderOrder).toBe(0);
    expect(veil.renderOrder).toBe(1);
  });

  it("sizes buckets to demand and drops unused buckets to zero", () => {
    const group = new Group();
    const grid = new InstancedBlockGrid(group);
    const plan = beginBlockPlan(createBlockInstancePlan());
    for (let i = 0; i < 3; i++) {
      pushBlockInstance(plan, BLOCK_GEOMETRY, BLOCK_MATERIAL, i, 0, 0, 0, 0, 0);
    }
    pushBlockInstance(plan, VEIL_GEOMETRY, VEIL_MATERIAL, 0, 0, 0.72, 0, 0, 0);
    grid.apply(plan);
    const meshes = group.children as import("three/webgpu").InstancedMesh[];
    expect(meshes[0].count).toBe(3);
    expect(meshes[1].count).toBe(1);

    beginBlockPlan(plan);
    pushBlockInstance(plan, BLOCK_GEOMETRY, BLOCK_MATERIAL, 9, -1, 0, 0, 0, 0);
    grid.apply(plan);
    expect(meshes[0].count).toBe(1);
    expect(meshes[1].count).toBe(0);
  });
});
