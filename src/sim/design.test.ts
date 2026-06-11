import { describe, expect, it } from "vitest";
import { type BotDesign, TEST_BOT_DESIGN, validateDesign } from "./design";
import { CORE_CUBE, DRIVE_WHEEL, PART_CATALOG, RAM_SPIKE } from "./parts";

function expectErrors(design: BotDesign, fragment: string) {
  const result = validateDesign(design);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.join("\n")).toContain(fragment);
  }
}

describe("validateDesign", () => {
  it("accepts the starter design and reports stats", () => {
    const result = validateDesign(TEST_BOT_DESIGN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stats.partCount).toBe(4);
      expect(result.stats.powerDraw).toBe(45);
      expect(result.stats.powerSupply).toBe(100);
      expect(result.stats.totalMass).toBeGreaterThan(0);
    }
  });

  it("rejects duplicate instance ids", () => {
    expectErrors(
      {
        name: "dup",
        parts: [
          { iid: "core", partId: "core-cube" },
          { iid: "core", partId: "ram-spike" },
        ],
        connections: [],
      },
      "duplicate instance id",
    );
  });

  it("rejects unknown parts", () => {
    expectErrors(
      {
        name: "ghost",
        parts: [{ iid: "core", partId: "not-a-part" }],
        connections: [],
      },
      "unknown part",
    );
  });

  it("rejects designs without exactly one core", () => {
    expectErrors(
      {
        name: "two-cores",
        parts: [
          { iid: "a", partId: "core-cube" },
          { iid: "b", partId: "core-cube" },
        ],
        connections: [
          {
            parentIid: "a",
            parentConnector: "front",
            childIid: "b",
            childConnector: "back",
          },
        ],
      },
      "exactly one core",
    );
  });

  it("rejects connector kind mismatches", () => {
    expectErrors(
      {
        name: "wheel-on-rigid",
        parts: [
          { iid: "core", partId: "core-cube" },
          { iid: "wheel", partId: "drive-wheel" },
        ],
        connections: [
          {
            parentIid: "core",
            parentConnector: "front",
            childIid: "wheel",
            childConnector: "hub",
          },
        ],
      },
      "kind mismatch",
    );
  });

  it("rejects connector reuse", () => {
    expectErrors(
      {
        name: "crowded-front",
        parts: [
          { iid: "core", partId: "core-cube" },
          { iid: "s1", partId: "ram-spike" },
          { iid: "s2", partId: "ram-spike" },
        ],
        connections: [
          {
            parentIid: "core",
            parentConnector: "front",
            childIid: "s1",
            childConnector: "mount",
          },
          {
            parentIid: "core",
            parentConnector: "front",
            childIid: "s2",
            childConnector: "mount",
          },
        ],
      },
      "used more than once",
    );
  });

  it("rejects parts not connected to the core", () => {
    expectErrors(
      {
        name: "orphan",
        parts: [
          { iid: "core", partId: "core-cube" },
          { iid: "stray", partId: "ram-spike" },
        ],
        connections: [],
      },
      "not connected to the core",
    );
  });

  it("rejects cycles disconnected from the core", () => {
    expectErrors(
      {
        name: "loop",
        parts: [
          { iid: "core", partId: "core-cube" },
          { iid: "a", partId: "frame-plate" },
          { iid: "b", partId: "frame-plate" },
        ],
        connections: [
          {
            parentIid: "a",
            parentConnector: "top",
            childIid: "b",
            childConnector: "bottom",
          },
          {
            parentIid: "b",
            parentConnector: "top",
            childIid: "a",
            childConnector: "bottom",
          },
        ],
      },
      "not connected to the core",
    );
  });

  it("rejects designs over the part cap", () => {
    const parts = [{ iid: "core", partId: "core-cube" }];
    const connections = [];
    let parent = "core";
    let parentConnector = "top";
    for (let i = 0; i < 36; i++) {
      const iid = `plate-${i}`;
      parts.push({ iid, partId: "frame-plate" });
      connections.push({
        parentIid: parent,
        parentConnector,
        childIid: iid,
        childConnector: "bottom",
      });
      parent = iid;
      parentConnector = "top";
    }
    expectErrors({ name: "tower", parts, connections }, "too many parts");
  });

  it("rejects power overdraw", () => {
    const weakCore = { ...CORE_CUBE, powerSupply: 10 };
    const catalog = {
      "core-cube": weakCore,
      "drive-wheel": DRIVE_WHEEL,
      "ram-spike": RAM_SPIKE,
      "frame-plate": PART_CATALOG["frame-plate"],
    };
    const result = validateDesign(TEST_BOT_DESIGN, catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join("\n")).toContain("power overdraw");
    }
  });
});
