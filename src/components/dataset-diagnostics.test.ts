import { describe, expect, it } from "vitest";
import { setDatasetNumber, setDatasetText } from "./dataset-diagnostics";

function trackedDataset(): { dataset: DOMStringMap; writes: () => number } {
  let writes = 0;
  const dataset = new Proxy({} as Record<string, string>, {
    set(target, key, value) {
      writes += 1;
      target[key as string] = value as string;
      return true;
    },
  }) as unknown as DOMStringMap;
  return { dataset, writes: () => writes };
}

describe("setDatasetNumber", () => {
  it("quantizes to each supported decimal count", () => {
    const { dataset } = trackedDataset();
    const cache: Record<string, number | string> = {};
    setDatasetNumber(cache, dataset, "d0", 12.6, 0);
    setDatasetNumber(cache, dataset, "d1", 12.34, 1);
    setDatasetNumber(cache, dataset, "d2", 12.345, 2);
    setDatasetNumber(cache, dataset, "d3", 0.12345, 3);
    setDatasetNumber(cache, dataset, "d4", 0.123456, 4);
    expect(dataset.d0).toBe("13");
    expect(dataset.d1).toBe("12.3");
    expect(dataset.d2).toBe("12.35");
    expect(dataset.d3).toBe("0.123");
    expect(dataset.d4).toBe("0.1235");
  });

  it("skips the DOM write while the quantized value is unchanged", () => {
    const { dataset, writes } = trackedDataset();
    const cache: Record<string, number | string> = {};
    setDatasetNumber(cache, dataset, "v", 0.12341, 4);
    expect(writes()).toBe(1);
    // Different raw value, same 4-decimal quantization: no write.
    setDatasetNumber(cache, dataset, "v", 0.123449, 4);
    expect(writes()).toBe(1);
    // Crosses the quantization step: writes again.
    setDatasetNumber(cache, dataset, "v", 0.1236, 4);
    expect(writes()).toBe(2);
    expect(dataset.v).toBe("0.1236");
  });
});

describe("setDatasetText", () => {
  it("writes only when the value changes", () => {
    const { dataset, writes } = trackedDataset();
    const cache: Record<string, number | string> = {};
    setDatasetText(cache, dataset, "phase", "day");
    setDatasetText(cache, dataset, "phase", "day");
    expect(writes()).toBe(1);
    setDatasetText(cache, dataset, "phase", "night");
    expect(writes()).toBe(2);
    expect(dataset.phase).toBe("night");
  });
});
