import { beforeEach, describe, expect, it } from "vitest";
import { validateDesign } from "@/sim/design";
import { DRIVE_WHEEL, PART_CATALOG, SPIN_MOUNT } from "@/sim/parts";
import {
  findFreeConnectors,
  planAddPart,
  planMergeSelectedPart,
  STARTER_DESIGN,
  useWorkshopStore,
} from "./workshop-store";

const store = () => useWorkshopStore.getState();

describe("workshop store", () => {
  beforeEach(() => {
    store().reset();
  });

  it("starts with a valid one-core design", () => {
    expect(validateDesign(store().design).ok).toBe(true);
    expect(store().design.parts).toHaveLength(1);
  });

  it("adds parts onto free compatible connectors deterministically", () => {
    store().addPart("drive-wheel");
    store().addPart("drive-wheel");
    const design = store().design;
    expect(design.parts).toHaveLength(3);
    expect(validateDesign(design).ok).toBe(true);
    // Both axle connectors are now taken: a third wheel has nowhere to go.
    expect(findFreeConnectors(design, DRIVE_WHEEL)).toHaveLength(0);
    store().addPart("drive-wheel");
    expect(store().design.parts).toHaveLength(3);
  });

  it("refuses additions that would break the power budget", () => {
    // Core supply 100: two wheels (20) + spike (5) fit; keep adding spikes
    // until connectors or power stop it, and the design must stay valid.
    store().addPart("drive-wheel");
    store().addPart("drive-wheel");
    for (let i = 0; i < 10; i++) {
      store().addPart("ram-spike");
    }
    expect(validateDesign(store().design).ok).toBe(true);
  });

  it("removes only selected leaf parts, never the core", () => {
    store().addPart("ram-spike");
    const spikeIid = store().selectedIid;
    expect(spikeIid).not.toBeNull();
    store().removeSelected();
    expect(store().design.parts).toHaveLength(1);

    store().select("core");
    store().removeSelected();
    expect(store().design.parts).toHaveLength(1);
  });

  it("undoes and redoes whole design snapshots", () => {
    store().addPart("drive-wheel");
    store().addPart("ram-spike");
    expect(store().design.parts).toHaveLength(3);
    store().undo();
    expect(store().design.parts).toHaveLength(2);
    store().undo();
    expect(store().design.parts).toHaveLength(1);
    store().redo();
    expect(store().design.parts).toHaveLength(2);
  });

  it("rotates the selected part through quarter turns with undo", () => {
    store().addPart("sensor-head");
    const headIid = store().selectedIid;
    expect(headIid).not.toBeNull();
    store().rotateSelected();
    let conn = store().design.connections.find((c) => c.childIid === headIid);
    expect(conn?.orientation).toBe(90);
    store().rotateSelected();
    conn = store().design.connections.find((c) => c.childIid === headIid);
    expect(conn?.orientation).toBe(180);
    store().undo();
    conn = store().design.connections.find((c) => c.childIid === headIid);
    expect(conn?.orientation).toBe(90);
  });

  it("merges selected duplicate parts into stronger levels with undo", () => {
    store().addPart("ram-spike");
    const spikeIid = store().selectedIid;
    expect(spikeIid).not.toBeNull();

    store().mergeSelectedPart();
    let spike = store().design.parts.find((p) => p.iid === spikeIid);
    expect(spike?.mergeLevel).toBe(2);

    store().mergeSelectedPart();
    spike = store().design.parts.find((p) => p.iid === spikeIid);
    expect(spike?.mergeLevel).toBe(3);
    expect(planMergeSelectedPart(store().design, spikeIid)).toBeNull();

    store().undo();
    spike = store().design.parts.find((p) => p.iid === spikeIid);
    expect(spike?.mergeLevel).toBe(2);
  });

  it("never merges the core part", () => {
    store().select("core");
    store().mergeSelectedPart();
    expect(store().design.parts[0].mergeLevel).toBeUndefined();
  });

  it("refuses to rotate axle-mounted parts", () => {
    store().addPart("drive-wheel");
    const wheelIid = store().selectedIid;
    store().rotateSelected();
    const conn = store().design.connections.find(
      (c) => c.childIid === wheelIid,
    );
    expect(conn?.orientation ?? 0).toBe(0);
  });

  it("keeps every reachable catalog part addable somewhere", () => {
    // Some parts need their enabling mount placed first (the saw blade
    // only fits a spin-mount spindle); those must be addable one step
    // deep, so no shop item is ever a dead end.
    const mounted = planAddPart(STARTER_DESIGN, SPIN_MOUNT);
    expect(mounted).not.toBeNull();
    for (const part of Object.values(PART_CATALOG)) {
      if (part.category === "core") continue;
      const direct = planAddPart(STARTER_DESIGN, part);
      const viaMount = mounted ? planAddPart(mounted.next, part) : null;
      expect(direct ?? viaMount, `${part.id} has no legal slot`).not.toBeNull();
    }
  });
});

describe("B3 temperament", () => {
  it("sets behavior with neutral fill and history undo", () => {
    store().setBehavior({ aggression: 0.9 });
    expect(store().design.behavior).toEqual({
      aggression: 0.9,
      flankBias: 0.5,
      patience: 0.5,
    });
    store().setBehavior({ patience: 0.1 });
    expect(store().design.behavior?.patience).toBe(0.1);
    expect(store().design.behavior?.aggression).toBe(0.9);
    store().undo();
    expect(store().design.behavior?.patience).toBe(0.5);
    // The tuned design still validates for combat.
    expect(validateDesign(store().design).ok).toBe(true);
  });
});
