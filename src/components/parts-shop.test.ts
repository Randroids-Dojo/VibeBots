import { describe, expect, it } from "vitest";
import { PART_CATALOG } from "@/sim/parts";
import { shopRowsFor } from "./parts-shop";

describe("shopRowsFor", () => {
  it("orders a family cheapest first regardless of payload order", () => {
    const payload = [
      {
        id: "frame-plate",
        name: "Frame Plate",
        category: "structure",
        priceEmeralds: 3,
      },
      {
        id: "hardened-plate",
        name: "Hardened Plate",
        category: "structure",
        priceEmeralds: 18,
      },
      {
        id: "drive-wheel",
        name: "Drive Wheel",
        category: "mobility",
        priceEmeralds: 6,
      },
      {
        id: "light-plate",
        name: "Light Plate",
        category: "structure",
        priceEmeralds: 2,
      },
      { id: "skid", name: "Skid", category: "structure", priceEmeralds: 3 },
    ];
    expect(shopRowsFor(payload, "structure").map((p) => p.id)).toEqual([
      "light-plate",
      "frame-plate",
      "skid",
      "hardened-plate",
    ]);
    expect(shopRowsFor(payload, "mobility").map((p) => p.id)).toEqual([
      "drive-wheel",
    ]);
    expect(shopRowsFor(payload, "weapon")).toEqual([]);
  });

  it("puts every catalog ladder in tier order", () => {
    const catalog = Object.values(PART_CATALOG).filter(
      (p) => p.category !== "core",
    );
    const drive = shopRowsFor(catalog, "mobility").map((p) => p.id);
    expect(drive.indexOf("drive-wheel")).toBeLessThan(
      drive.indexOf("grip-wheel"),
    );
    expect(drive.indexOf("grip-wheel")).toBeLessThan(
      drive.indexOf("super-wheel"),
    );
    const frame = shopRowsFor(catalog, "structure").map((p) => p.id);
    expect(frame.indexOf("light-plate")).toBeLessThan(
      frame.indexOf("frame-plate"),
    );
    expect(frame.indexOf("frame-plate")).toBeLessThan(
      frame.indexOf("hardened-plate"),
    );
  });
});
