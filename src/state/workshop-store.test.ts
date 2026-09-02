import { beforeEach, describe, expect, it } from "vitest";
import { validateDesign } from "@/sim/design";
import { designPartCounts } from "@/sim/inventory";
import { DRIVE_WHEEL, PART_CATALOG, SAW_BLADE, SPIN_MOUNT } from "@/sim/parts";
import {
  CAROUSEL_PART_IDS,
  CORE_PART_IDS,
  carouselIdsFor,
  currentCoreId,
  findFreeConnectors,
  mirrorSlotFor,
  planAddPart,
  planMergeSelectedPart,
  STARTER_DESIGN,
  subtreeIids,
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

  it("removes a selected part, never the core", () => {
    store().addPart("ram-spike");
    const spikeIid = store().selectedIid;
    expect(spikeIid).not.toBeNull();
    store().removeSelected();
    expect(store().design.parts).toHaveLength(1);

    store().select("core");
    store().removeSelected();
    expect(store().design.parts).toHaveLength(1);
  });

  it("collects a part plus everything hung off it (subtreeIids)", () => {
    // core -> A -> B, core -> C. Removing A must take B; removing the core
    // takes everything.
    const design = {
      ...STARTER_DESIGN,
      parts: [
        { iid: "core", partId: "core-cube" },
        { iid: "A", partId: "spin-mount" },
        { iid: "B", partId: "sensor-head" },
        { iid: "C", partId: "ram-spike" },
      ],
      connections: [
        {
          parentIid: "core",
          parentConnector: "top",
          childIid: "A",
          childConnector: "base",
        },
        {
          parentIid: "A",
          parentConnector: "mount",
          childIid: "B",
          childConnector: "base",
        },
        {
          parentIid: "core",
          parentConnector: "front",
          childIid: "C",
          childConnector: "base",
        },
      ],
    };
    expect([...subtreeIids(design, "A")].sort()).toEqual(["A", "B"]);
    expect([...subtreeIids(design, "C")]).toEqual(["C"]);
    expect([...subtreeIids(design, "core")].sort()).toEqual([
      "A",
      "B",
      "C",
      "core",
    ]);
  });

  it("removing a part in a stack drops its subtree and refunds it", () => {
    // Build core -> spin mount -> saw blade (the blade only fits the mount's
    // spindle), then remove the mount: the blade rides along, and both parts
    // return to available inventory (the used count is what the design
    // consumes, so dropping them refunds).
    store().addPart("spin-mount");
    const mountIid = store().selectedIid;
    expect(mountIid).not.toBeNull();
    const mountSlot = validSlotsFor(store().design, SAW_BLADE).find(
      (s) => s.parentIid === mountIid,
    );
    expect(mountSlot).toBeDefined();
    if (mountSlot) store().placeAtSlot(mountSlot);
    expect(store().design.parts).toHaveLength(3);
    const used = designPartCounts(store().design);
    expect(used.get(SPIN_MOUNT.id)).toBe(1);
    expect(used.get(SAW_BLADE.id)).toBe(1);

    store().select(mountIid);
    store().removeSelected();
    expect(store().design.parts).toHaveLength(1);
    const refunded = designPartCounts(store().design);
    expect(refunded.get(SPIN_MOUNT.id)).toBeUndefined();
    expect(refunded.get(SAW_BLADE.id)).toBeUndefined();

    // Undo restores the whole subtree and its used counts.
    store().undo();
    expect(store().design.parts).toHaveLength(3);
    const restored = designPartCounts(store().design);
    expect(restored.get(SPIN_MOUNT.id)).toBe(1);
    expect(restored.get(SAW_BLADE.id)).toBe(1);
  });

  it("toggles browse-part stats and clears any placed selection (G)", () => {
    store().addPart("drive-wheel");
    expect(store().selectedIid).not.toBeNull();
    expect(store().browseStatsOpen).toBe(false);

    // Tapping the hero opens its stats and drops the placed selection, so
    // only one bottom panel shows at a time.
    store().toggleBrowseStats();
    expect(store().browseStatsOpen).toBe(true);
    expect(store().selectedIid).toBeNull();

    // Tapping again hides the stats.
    store().toggleBrowseStats();
    expect(store().browseStatsOpen).toBe(false);
  });

  it("closes browse stats when a placed part is selected or added (G)", () => {
    store().toggleBrowseStats();
    expect(store().browseStatsOpen).toBe(true);
    store().select("core");
    expect(store().browseStatsOpen).toBe(false);

    store().toggleBrowseStats();
    store().addPart("drive-wheel");
    expect(store().browseStatsOpen).toBe(false);
    expect(store().selectedIid).not.toBeNull();
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

  it("places a part at the exact dropped slot", () => {
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
    store().undo();
    expect(store().design.parts).toHaveLength(1);
  });

  it("refuses a slot whose parent connector is already taken", () => {
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

  it("merges a specific placed part by iid", () => {
    store().addPart("drive-wheel");
    const wheelIid = store().selectedIid;
    expect(wheelIid).not.toBeNull();
    if (!wheelIid) return;
    // Merge the existing copy instead of placing a new one.
    store().mergePart(wheelIid);
    const merged = store().design.parts.find((p) => p.iid === wheelIid);
    expect(merged?.mergeLevel).toBe(2);
    // The merge selects the upgraded part.
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

  it("cycles the mount orientation a quarter turn and wraps (N4)", () => {
    expect(store().browseOrientation).toBe(0);
    store().rotateBrowse();
    expect(store().browseOrientation).toBe(90);
    store().rotateBrowse();
    store().rotateBrowse();
    expect(store().browseOrientation).toBe(270);
    store().rotateBrowse();
    expect(store().browseOrientation).toBe(0);
  });

  it("resets the mount orientation when browsing to another part (N4)", () => {
    store().rotateBrowse();
    expect(store().browseOrientation).toBe(90);
    store().browseBy(1);
    expect(store().browseOrientation).toBe(0);
  });

  it("clears a selected placed part when cycling the carousel (P1)", () => {
    store().select("core");
    expect(store().selectedIid).toBe("core");
    store().browseBy(1);
    expect(store().selectedIid).toBeNull();
  });

  it("tracks the owned-out dim flag for the hero part (P3)", () => {
    expect(store().browseDimmed).toBe(false);
    store().setBrowseDimmed(true);
    expect(store().browseDimmed).toBe(true);
    store().setBrowseDimmed(false);
    expect(store().browseDimmed).toBe(false);
  });

  it("tracks the release-to-merge preview level (Slice B)", () => {
    expect(store().mergePreviewLevel).toBeNull();
    store().setMergePreviewLevel(2);
    expect(store().mergePreviewLevel).toBe(2);
    store().setMergePreviewLevel(null);
    expect(store().mergePreviewLevel).toBeNull();
  });
});

describe("N4 oriented placement", () => {
  it("applies a rigid mount orientation to the resulting slots", () => {
    const framePlate = PART_CATALOG["frame-plate"];
    const slots = validSlotsFor(STARTER_DESIGN, framePlate, PART_CATALOG, 90);
    expect(slots.length).toBeGreaterThan(0);
    // Frame Plate mounts on the core's rigid faces, so every slot carries
    // the requested quarter turn and the built design still validates.
    for (const slot of slots) {
      expect(slot.orientation).toBe(90);
      expect(validateDesign(slot.next).ok).toBe(true);
    }
  });

  it("ignores orientation on axle mounts (a rotated wheel still places)", () => {
    const slots = validSlotsFor(STARTER_DESIGN, DRIVE_WHEEL, PART_CATALOG, 90);
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.orientation).toBe(0);
    }
  });
});

describe("I chassis variants", () => {
  beforeEach(() => {
    store().reset();
  });

  it("offers at least three cores, all valid roots", () => {
    expect(CORE_PART_IDS.length).toBeGreaterThanOrEqual(3);
    expect(CORE_PART_IDS).toContain("core-cube");
    expect(CORE_PART_IDS).toContain("wedge-core");
    expect(CORE_PART_IDS).toContain("tower-core");
    for (const id of CORE_PART_IDS) {
      const design = {
        name: "X",
        parts: [{ iid: "core", partId: id }],
        connections: [],
      };
      expect(validateDesign(design).ok).toBe(true);
    }
  });

  it("swaps the chassis to a fresh bot, keeping name and temperament, undoably", () => {
    store().setName("Chomper");
    store().setBehavior({ aggression: 0.9, flankBias: 0.1, patience: 0.4 });
    // Build past the bare core so the reset is observable.
    const wheelSlots = validSlotsFor(store().design, DRIVE_WHEEL);
    store().placeAtSlot(wheelSlots[0]);
    expect(store().design.parts.length).toBe(2);
    expect(currentCoreId(store().design)).toBe("core-cube");

    store().setCore("tower-core");
    expect(currentCoreId(store().design)).toBe("tower-core");
    expect(store().design.parts).toHaveLength(1);
    expect(store().design.name).toBe("Chomper");
    expect(store().design.behavior?.aggression).toBe(0.9);
    expect(store().selectedIid).toBeNull();

    // One Undo restores the full pre-swap build.
    store().undo();
    expect(currentCoreId(store().design)).toBe("core-cube");
    expect(store().design.parts).toHaveLength(2);
  });

  it("ignores setCore for the current core or a non-core id", () => {
    const before = store().history;
    store().setCore("core-cube");
    expect(store().history).toBe(before);
    store().setCore("drive-wheel");
    expect(store().history).toBe(before);
  });
});

describe("L mirror placement", () => {
  beforeEach(() => {
    store().reset();
    if (store().mirrorEnabled) store().toggleMirror();
  });

  it("finds the twin of a core side connector, but not of a center mount", () => {
    // A wheel on axle-left mirrors to axle-right.
    const axleSlots = validSlotsFor(store().design, DRIVE_WHEEL);
    const left = axleSlots.find((s) => s.parentConnector === "axle-left");
    expect(left).toBeDefined();
    if (left) {
      const twin = mirrorSlotFor(left.next, left);
      expect(twin?.parentConnector).toBe("axle-right");
    }
    // A front-mounted spike sits on the x=0 plane, so it has no twin.
    const spikeSlots = validSlotsFor(store().design, PART_CATALOG["ram-spike"]);
    const front = spikeSlots.find((s) => s.parentConnector === "front");
    expect(front).toBeDefined();
    if (front) expect(mirrorSlotFor(front.next, front)).toBeNull();
  });

  it("mirrors a side placement into both twins in one undoable step", () => {
    store().toggleMirror();
    expect(store().mirrorEnabled).toBe(true);
    const axleSlots = validSlotsFor(store().design, DRIVE_WHEEL);
    const left = axleSlots.find((s) => s.parentConnector === "axle-left");
    expect(left).toBeDefined();
    if (left) store().placeAtSlot(left);
    // Core plus both wheels: the twin filled automatically.
    expect(store().design.parts).toHaveLength(3);
    const usedAxles = store().design.connections.map((c) => c.parentConnector);
    expect(usedAxles).toContain("axle-left");
    expect(usedAxles).toContain("axle-right");
    expect(validateDesign(store().design).ok).toBe(true);

    // One Undo removes both mirrored parts.
    store().undo();
    expect(store().design.parts).toHaveLength(1);
  });

  it("places only one part when mirror is off", () => {
    const axleSlots = validSlotsFor(store().design, DRIVE_WHEEL);
    const left = axleSlots.find((s) => s.parentConnector === "axle-left");
    if (left) store().placeAtSlot(left);
    expect(store().design.parts).toHaveLength(2);
  });
});

describe("G4 carousel categories", () => {
  beforeEach(() => {
    store().reset();
    store().setBrowseCategory("all");
  });

  it("narrows the non-core catalog to one family and back", () => {
    expect(carouselIdsFor("all")).toEqual(CAROUSEL_PART_IDS);
    for (const category of ["structure", "mobility", "weapon"] as const) {
      const ids = carouselIdsFor(category);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(PART_CATALOG[id].category).toBe(category);
    }
    // The three families partition the whole non-core catalog.
    const union = new Set([
      ...carouselIdsFor("structure"),
      ...carouselIdsFor("mobility"),
      ...carouselIdsFor("weapon"),
    ]);
    expect(union.size).toBe(CAROUSEL_PART_IDS.length);
    expect(carouselIdsFor("all")).not.toContain("core-cube");
  });

  it("remembers the chosen chip and cycles inside it", () => {
    store().setBrowseCategory("mobility");
    expect(store().browseCategory).toBe("mobility");
    store().setBrowsableIds(carouselIdsFor("mobility"));
    expect(PART_CATALOG[store().browsePartId].category).toBe("mobility");
    for (let i = 0; i < 6; i++) store().browseBy(1);
    expect(PART_CATALOG[store().browsePartId].category).toBe("mobility");
  });
});

describe("G7 merge nonce", () => {
  beforeEach(() => {
    store().reset();
  });

  it("bumps on a merge by either path and never on a placement", () => {
    const start = store().mergeNonce;
    const slot = validSlotsFor(store().design, DRIVE_WHEEL)[0];
    store().placeAtSlot(slot);
    expect(store().mergeNonce).toBe(start);
    store().mergePart(slot.iid);
    expect(store().mergeNonce).toBe(start + 1);
    store().select(slot.iid);
    store().mergeSelectedPart();
    expect(store().mergeNonce).toBe(start + 2);
    // At the cap a merge is refused and the nonce holds.
    store().mergeSelectedPart();
    expect(store().mergeNonce).toBe(start + 2);
  });
});

describe("G5 paint", () => {
  beforeEach(() => {
    store().reset();
  });

  it("sets, changes, clears, and undoes paint without touching the parts", () => {
    expect(store().design.paint).toBeUndefined();
    const parts = store().design.parts;
    const connections = store().design.connections;
    store().setPaint({ primary: "cobalt", accent: "gold" });
    expect(store().design.paint).toEqual({ primary: "cobalt", accent: "gold" });
    expect(store().design.parts).toBe(parts);
    expect(store().design.connections).toBe(connections);
    expect(validateDesign(store().design).ok).toBe(true);
    // Same paint again is a no-op (no history entry).
    const before = store().history;
    store().setPaint({ primary: "cobalt", accent: "gold" });
    expect(store().history).toBe(before);
    store().setPaint({ primary: "cobalt", accent: "slate" });
    expect(store().design.paint?.accent).toBe("slate");
    store().undo();
    expect(store().design.paint?.accent).toBe("gold");
    store().setPaint(undefined);
    expect("paint" in store().design).toBe(false);
    store().undo();
    expect(store().design.paint).toEqual({ primary: "cobalt", accent: "gold" });
    expect(store().design.parts).toBe(parts);
    expect(store().design.connections).toBe(connections);
  });
});

describe("G6 browseTo", () => {
  beforeEach(() => {
    store().reset();
  });

  it("shows a named non-core part and ignores cores and unknown ids", () => {
    store().browseTo("saw-blade");
    expect(store().browsePartId).toBe("saw-blade");
    store().rotateBrowse();
    store().browseTo("drive-wheel");
    expect(store().browsePartId).toBe("drive-wheel");
    expect(store().browseOrientation).toBe(0);
    store().browseTo("core-cube");
    expect(store().browsePartId).toBe("drive-wheel");
    store().browseTo("no-such-part");
    expect(store().browsePartId).toBe("drive-wheel");
  });
});

describe("G1 view reset nonce", () => {
  beforeEach(() => {
    store().reset();
  });

  it("bumps on recenter, chassis swap, load, and reset, never on a placement", () => {
    const start = store().viewResetNonce;
    const wheelSlots = validSlotsFor(store().design, DRIVE_WHEEL);
    store().placeAtSlot(wheelSlots[0]);
    expect(store().viewResetNonce).toBe(start);
    store().select("drive-wheel-1");
    expect(store().viewResetNonce).toBe(start);

    store().recenterView();
    expect(store().viewResetNonce).toBe(start + 1);
    store().setCore("wedge-core");
    expect(store().viewResetNonce).toBe(start + 2);
    // Same core again is a no-op, so the view does not jump either.
    store().setCore("wedge-core");
    expect(store().viewResetNonce).toBe(start + 2);
    // Undoing the swap restores the cube bot: a different chassis, so the
    // view comes home to it; redo swaps back and comes home again.
    store().undo();
    expect(store().viewResetNonce).toBe(start + 3);
    store().redo();
    expect(store().viewResetNonce).toBe(start + 4);
    // Undoing a plain placement keeps the chassis, so the view holds.
    store().undo();
    store().placeAtSlot(validSlotsFor(store().design, DRIVE_WHEEL)[0]);
    const beforePlacementUndo = store().viewResetNonce;
    store().undo();
    expect(store().viewResetNonce).toBe(beforePlacementUndo);
    store().loadDesign(STARTER_DESIGN);
    expect(store().viewResetNonce).toBe(beforePlacementUndo + 1);
    store().reset();
    expect(store().viewResetNonce).toBe(beforePlacementUndo + 2);
  });
});
