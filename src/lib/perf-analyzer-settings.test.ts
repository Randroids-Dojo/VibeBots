import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PERF_AB_VARIANT_STORAGE_KEY,
  PERF_ANALYZER_STORAGE_KEY,
  perfAnalyzerEnabled,
  persistPerfAnalyzerEnabled,
  readPerfAbVariant,
} from "./perf-analyzer-settings";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

function stubWindow(search: string, storage = fakeStorage()) {
  vi.stubGlobal("window", {
    localStorage: storage,
    location: { search },
  });
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("perfAnalyzerEnabled", () => {
  it("is false without a window", () => {
    expect(perfAnalyzerEnabled()).toBe(false);
  });

  it("reads the stored flag", () => {
    const storage = stubWindow("", fakeStorage());
    expect(perfAnalyzerEnabled()).toBe(false);
    storage.setItem(PERF_ANALYZER_STORAGE_KEY, "on");
    expect(perfAnalyzerEnabled()).toBe(true);
    storage.setItem(PERF_ANALYZER_STORAGE_KEY, "off");
    expect(perfAnalyzerEnabled()).toBe(false);
  });

  it("is false when storage throws", () => {
    stubWindow("", {
      ...fakeStorage(),
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(perfAnalyzerEnabled()).toBe(false);
  });
});

describe("persistPerfAnalyzerEnabled", () => {
  it("writes on and off values", () => {
    const storage = stubWindow("");
    persistPerfAnalyzerEnabled(true);
    expect(storage.data.get(PERF_ANALYZER_STORAGE_KEY)).toBe("on");
    persistPerfAnalyzerEnabled(false);
    expect(storage.data.get(PERF_ANALYZER_STORAGE_KEY)).toBe("off");
  });

  it("swallows unavailable storage", () => {
    stubWindow("", {
      ...fakeStorage(),
      setItem: () => {
        throw new Error("private mode");
      },
    });
    expect(() => persistPerfAnalyzerEnabled(true)).not.toThrow();
  });
});

describe("readPerfAbVariant", () => {
  it("is null without a window", () => {
    expect(readPerfAbVariant()).toBeNull();
  });

  it("persists and returns the query param variant", () => {
    const storage = stubWindow("?perfVariant=shadows-off");
    expect(readPerfAbVariant()).toBe("shadows-off");
    expect(storage.data.get(PERF_AB_VARIANT_STORAGE_KEY)).toBe("shadows-off");
  });

  it("truncates the variant to 40 characters", () => {
    const long = "v".repeat(60);
    stubWindow(`?perfVariant=${long}`);
    expect(readPerfAbVariant()).toBe("v".repeat(40));
  });

  it("clears the stored variant on an empty query param", () => {
    const storage = stubWindow(
      "?perfVariant=",
      fakeStorage({ [PERF_AB_VARIANT_STORAGE_KEY]: "old" }),
    );
    expect(readPerfAbVariant()).toBeNull();
    expect(storage.data.has(PERF_AB_VARIANT_STORAGE_KEY)).toBe(false);
  });

  it("falls back to the stored variant without a query param", () => {
    stubWindow("", fakeStorage({ [PERF_AB_VARIANT_STORAGE_KEY]: "baseline" }));
    expect(readPerfAbVariant()).toBe("baseline");
  });

  it("is null when storage throws", () => {
    stubWindow("?perfVariant=shadows-off", {
      ...fakeStorage(),
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readPerfAbVariant()).toBeNull();
  });
});
