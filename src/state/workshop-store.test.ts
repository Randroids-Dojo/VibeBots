import { beforeEach, describe, expect, it } from "vitest";
import { validateDesign } from "@/sim/design";
import { DRIVE_WHEEL, PART_CATALOG, SPIN_MOUNT } from "@/sim/parts";
import {
  CAROUSEL_PART_IDS,
  findFreeConnectors,
  planAddPart,
  planMergeSelectedPart,
  STARTER_DESIGN,
  useWorkshopStore,
  validSlotsFor,
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

describe("W2 tap-to-place slots", () => {
  beforeEach(() => {
    store().reset();
  });

  it("enumerates every valid slot, each a distinct validated design", () => {
    const slots = validSlotsFor(STARTER_DESIGN, DRIVE_WHEEL);
    // The starter core exposes more than one axle mount for a wheel.
    expect(slots.length).toBeGreaterThan(1);
    for (const slot of slots) {
      expect(validateDesign(slot.next).ok).toBe(true);
      expect(slot.next.parts).toHaveLength(STARTER_DESIGN.parts.length + 1);
      expect(slot.next.parts.some((p) => p.iid === slot.iid)).toBe(true);
    }
    // Distinct parent connectors: no two ghosts point at the same mount.
    const mounts = new Set(
      slots.map((s) => `${s.parentIid}:${s.parentConnector}`),
    );
    expect(mounts.size).toBe(slots.length);
    // planAddPart agrees with the first enumerated slot.
    expect(planAddPart(STARTER_DESIGN, DRIVE_WHEEL)?.iid).toBe(slots[0].iid);
  });

  it("arms and toggles the placement part", () => {
    store().armPart("drive-wheel");
    expect(store().armedPartId).toBe("drive-wheel");
    // Re-arming the same part disarms it.
    store().armPart("drive-wheel");
    expect(store().armedPartId).toBeNull();
    // A different part swaps the armed selection.
    store().armPart("drive-wheel");
    store().armPart("ram-spike");
    expect(store().armedPartId).toBe("ram-spike");
    store().armPart(null);
    expect(store().armedPartId).toBeNull();
  });

  it("places a part at the exact tapped slot and disarms", () => {
    store().armPart("drive-wheel");
    const slots = validSlotsFor(store().design, DRIVE_WHEEL);
    const target = slots[slots.length - 1];
    store().placeAtSlot(target);
    const design = store().design;
    expect(design.parts).toHaveLength(2);
    // The new part hangs off exactly the connector the slot named.
    expect(
      design.connections.some(
        (c) =>
          c.parentIid === target.parentIid &&
          c.parentConnector === target.parentConnector &&
          c.childIid === store().selectedIid,
      ),
    ).toBe(true);
    expect(store().armedPartId).toBeNull();
    store().undo();
    expect(store().design.parts).toHaveLength(1);
  });

  it("refuses a slot whose parent connector is already taken", () => {
    store().armPart("drive-wheel");
    const slot = validSlotsFor(store().design, DRIVE_WHEEL)[0];
    store().placeAtSlot(slot);
    expect(store().design.parts).toHaveLength(2);
    // Replaying the same slot (now occupied) is a no-op, not a double-mount.
    store().placeAtSlot(slot);
    expect(store().design.parts).toHaveLength(2);
  });
});

describe("W4 merge as placement", () => {
  beforeEach(() => {
    store().reset();
  });

  it("merges a specific placed part by iid and disarms", () => {
    store().addPart("drive-wheel");
    const wheelIid = store().selectedIid;
    expect(wheelIid).not.toBeNull();
    if (!wheelIid) return;
    // Arm the same part, then merge the existing copy instead of placing.
    store().armPart("drive-wheel");
    store().mergePart(wheelIid);
    const merged = store().design.parts.find((p) => p.iid === wheelIid);
    expect(merged?.mergeLevel).toBe(2);
    // The merge spends the arming and selects the upgraded part.
    expect(store().armedPartId).toBeNull();
    expect(store().selectedIid).toBe(wheelIid);
    // History captured it: undo returns to level 1.
    store().undo();
    expect(
      store().design.parts.find((p) => p.iid === wheelIid)?.mergeLevel,
    ).toBeUndefined();
  });

  it("refuses to merge a maxed or non-mergeable part", () => {
    store().addPart("ram-spike");
    const spikeIid = store().selectedIid;
    if (!spikeIid) return;
    store().mergePart(spikeIid); // level 2
    store().mergePart(spikeIid); // level 3 (max)
    const before = store().design;
    store().mergePart(spikeIid); // no-op at max
    expect(store().design).toBe(before);
    // The core never merges.
    store().mergePart("core");
    expect(store().design.parts[0].mergeLevel).toBeUndefined();
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

describe("N1 build carousel", () => {
  beforeEach(() => {
    useWorkshopStore.setState({
      browsePartId: CAROUSEL_PART_IDS[0],
      buildActive: true,
    });
  });

  it("lists every non-core part and starts on the first", () => {
    expect(CAROUSEL_PART_IDS.length).toBeGreaterThan(0);
    for (const id of CAROUSEL_PART_IDS) {
      expect(PART_CATALOG[id].category).not.toBe("core");
    }
    expect(store().browsePartId).toBe(CAROUSEL_PART_IDS[0]);
  });

  it("steps forward and backward and wraps at both ends", () => {
    const last = CAROUSEL_PART_IDS[CAROUSEL_PART_IDS.length - 1];
    store().browseBy(1);
    expect(store().browsePartId).toBe(CAROUSEL_PART_IDS[1]);
    // Wrap past the start when stepping back from the first entry.
    store().browseBy(-1);
    store().browseBy(-1);
    expect(store().browsePartId).toBe(last);
    // And wrap past the end back to the first.
    store().browseBy(1);
    expect(store().browsePartId).toBe(CAROUSEL_PART_IDS[0]);
  });

  it("toggles the build-active flag for the hero part", () => {
    expect(store().buildActive).toBe(true);
    store().setBuildActive(false);
    expect(store().buildActive).toBe(false);
    store().setBuildActive(true);
    expect(store().buildActive).toBe(true);
  });
});
