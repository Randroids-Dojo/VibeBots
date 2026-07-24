import { describe, expect, test } from "vitest";
import {
  parseReproArgs,
  pinnedRuntimeImage,
  resolveFunctionalCase,
  shellQuote,
} from "./ci-repro-lib.mjs";

describe("ci repro arguments", () => {
  test("accepts one stable case ID", () => {
    expect(parseReproArgs(["--case", "E2E-MINE-CORE-0002"])).toEqual({
      caseId: "E2E-MINE-CORE-0002",
      shard: null,
      imageDigest: null,
    });
  });

  test("accepts a shard and digest override", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(
      parseReproArgs(["--shard", "2/8", "--image-digest", digest]),
    ).toEqual({
      caseId: null,
      shard: "2/8",
      imageDigest: digest,
    });
  });

  test("rejects missing or conflicting selectors", () => {
    expect(() => parseReproArgs([])).toThrow("exactly one");
    expect(() =>
      parseReproArgs(["--case", "E2E-MINE-CORE-0002", "--shard", "1/8"]),
    ).toThrow("exactly one");
  });

  test("rejects an invalid shard", () => {
    expect(() => parseReproArgs(["--shard", "9/8"])).toThrow("Invalid shard");
  });
});

describe("ci repro resolution", () => {
  test("forms an immutable image reference", () => {
    const digest = `sha256:${"b".repeat(64)}`;
    expect(
      pinnedRuntimeImage({
        schemaVersion: 1,
        imageRepository: "ghcr.io/randroids-dojo/vibebots-ci",
        imageDigest: digest,
      }),
    ).toBe(`ghcr.io/randroids-dojo/vibebots-ci@${digest}`);
  });

  test("resolves only required functional cases", () => {
    const cases = [
      {
        caseId: "E2E-MINE-CORE-0002",
        capability: "@functional",
        file: "mine-core.spec.ts",
        line: 66,
      },
      {
        caseId: "E2E-MINE-CORE-0003",
        capability: "@render",
        file: "mine-core.spec.ts",
        line: 100,
      },
    ];
    expect(resolveFunctionalCase(cases, "E2E-MINE-CORE-0002")).toBe(
      "mine-core.spec.ts:66",
    );
    expect(() => resolveFunctionalCase(cases, "E2E-MINE-CORE-0003")).toThrow(
      "not a required functional case",
    );
  });

  test("quotes commands for copy and paste", () => {
    expect(shellQuote("plain:value")).toBe("plain:value");
    expect(shellQuote("/a path/with space")).toBe("'/a path/with space'");
  });
});
