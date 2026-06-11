import { beforeEach, describe, expect, it } from "vitest";
import { validateDesign } from "@/sim/design";
import { DRIVE_WHEEL, PART_CATALOG } from "@/sim/parts";
import {
  findFreeConnector,
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
    expect(findFreeConnector(design, DRIVE_WHEEL)).toBeNull();
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

  it("keeps every reachable catalog part addable somewhere", () => {
    for (const part of Object.values(PART_CATALOG)) {
      if (part.category === "core") continue;
      expect(findFreeConnector(STARTER_DESIGN, part)).not.toBeNull();
    }
  });
});
