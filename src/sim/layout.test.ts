import { describe, expect, it } from "vitest";
import type { BotDesign } from "./design";
import { computeLayout, quatMultiply, quatRotate, YAW_QUATS } from "./layout";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);

describe("layout orientation", () => {
  it("rotates vectors by exact yaw quaternions", () => {
    // 90 degrees yaw maps +z to +x (right-handed, y up).
    const v = quatRotate(YAW_QUATS[90], { x: 0, y: 0, z: 1 });
    close(v.x, 1);
    close(v.y, 0);
    close(v.z, 0);
    const back = quatRotate(YAW_QUATS[270], { x: 1, y: 0, z: 0 });
    close(back.z, 1);
  });

  it("composes quarter turns exactly", () => {
    const q = quatMultiply(YAW_QUATS[90], YAW_QUATS[90]);
    close(Math.abs(q.y), 1);
    close(q.w, 0);
  });

  it("places an oriented child by its rotated anchor", () => {
    // A spike mounted on the cross-frame's east connector, yawed 90:
    // its mount anchor (0,0,0.2) rotates to (0.2,0,0), so the spike body
    // sits at east (0.35,0,0) minus (0.2,0,0) = (0.15,0,0) relative to
    // the frame, pointing its tip along -x... rotated 90 yaw.
    const design: BotDesign = {
      name: "oriented",
      parts: [
        { iid: "core", partId: "core-cube" },
        { iid: "frame", partId: "cross-frame" },
        { iid: "spike", partId: "ram-spike" },
      ],
      connections: [
        {
          parentIid: "core",
          parentConnector: "top",
          childIid: "frame",
          childConnector: "bottom",
        },
        {
          parentIid: "frame",
          parentConnector: "east",
          childIid: "spike",
          childConnector: "mount",
          orientation: 90,
        },
      ],
    };
    const layout = computeLayout(design);
    const frame = layout.get("frame");
    const spike = layout.get("spike");
    expect(frame).toBeDefined();
    expect(spike).toBeDefined();
    if (!frame || !spike) return;
    close(frame.position.y, 0.38);
    close(spike.position.x, frame.position.x + 0.35 - 0.2);
    close(spike.position.y, frame.position.y);
    close(spike.position.z, frame.position.z);
    close(Math.abs(spike.rotation.y), Math.sqrt(0.5));
  });

  it("keeps unoriented layouts bit-identical to the identity rotation", () => {
    const design: BotDesign = {
      name: "plain",
      parts: [
        { iid: "core", partId: "core-cube" },
        { iid: "spike", partId: "ram-spike" },
      ],
      connections: [
        {
          parentIid: "core",
          parentConnector: "front",
          childIid: "spike",
          childConnector: "mount",
        },
      ],
    };
    const layout = computeLayout(design);
    const spike = layout.get("spike");
    expect(spike?.position).toEqual({ x: 0, y: 0, z: -0.5 });
    expect(spike?.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});
