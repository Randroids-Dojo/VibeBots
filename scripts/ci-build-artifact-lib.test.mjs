import { describe, expect, test } from "vitest";
import {
  assertCleanCheckout,
  assertSafeExtractionTarget,
  compareBundleOutput,
  verifyBuildManifest,
} from "./ci-build-artifact-lib.mjs";

const expected = {
  expectedSha: "abc123",
  lockfileHash: "lock123",
  imageDigest: "sha256:image",
};
const manifest = {
  schemaVersion: 1,
  commitSha: expected.expectedSha,
  lockfileSha256: expected.lockfileHash,
  browserRuntime: { imageDigest: expected.imageDigest },
};

describe("CI build artifact contract", () => {
  test("accepts only the exact workflow SHA, lockfile, and runtime", () => {
    expect(verifyBuildManifest(manifest, expected)).toBe(manifest);
    expect(() =>
      verifyBuildManifest(manifest, { ...expected, expectedSha: "wrong" }),
    ).toThrow("does not match workflow SHA");
    expect(() =>
      verifyBuildManifest(manifest, { ...expected, lockfileHash: "wrong" }),
    ).toThrow("lockfile hash");
    expect(() =>
      verifyBuildManifest(manifest, { ...expected, imageDigest: "wrong" }),
    ).toThrow("image digest");
  });

  test("refuses a dirty checkout before building", () => {
    expect(() => assertCleanCheckout(" M package.json\n")).toThrow(
      "dirty paths",
    );
    expect(() => assertCleanCheckout("")).not.toThrow();
  });

  test("limits extraction to the workspace or a temp directory", () => {
    const workspace = "/workspace/vibebots";
    expect(() =>
      assertSafeExtractionTarget(workspace, workspace, ["/safe-temp"]),
    ).not.toThrow();
    expect(() =>
      assertSafeExtractionTarget("/safe-temp/artifact", workspace, [
        "/safe-temp",
      ]),
    ).not.toThrow();
    expect(() =>
      assertSafeExtractionTarget("/safe-temp", workspace, ["/safe-temp"]),
    ).toThrow("workspace or a temp directory");
    expect(() =>
      assertSafeExtractionTarget("/Users/example", workspace, ["/safe-temp"]),
    ).toThrow("workspace or a temp directory");
  });

  test("records route additions, removals, and byte deltas", () => {
    expect(
      compareBundleOutput(
        [
          { route: "/", firstLoadUncompressedJsBytes: 120 },
          { route: "/new", firstLoadUncompressedJsBytes: 50 },
        ],
        {
          schemaVersion: 1,
          sourceCommit: "base",
          routes: { "/": 100, "/old": 25 },
          totalFirstLoadUncompressedJsBytes: 125,
        },
      ),
    ).toMatchObject({
      baselineCommit: "base",
      currentTotalFirstLoadUncompressedJsBytes: 170,
      totalDeltaBytes: 45,
      addedRoutes: ["/new"],
      removedRoutes: ["/old"],
      routes: {
        "/": { baselineBytes: 100, currentBytes: 120, deltaBytes: 20 },
      },
    });
  });

  test("rejects malformed route bundle diagnostics", () => {
    const baseline = {
      schemaVersion: 1,
      sourceCommit: "base",
      routes: { "/": 100 },
      totalFirstLoadUncompressedJsBytes: 100,
    };
    expect(() => compareBundleOutput(null, baseline)).toThrow(
      "must be an array",
    );
    expect(() =>
      compareBundleOutput(
        [{ route: "/", firstLoadUncompressedJsBytes: Number.NaN }],
        baseline,
      ),
    ).toThrow("entry 0 is invalid");
    expect(() =>
      compareBundleOutput(
        [{ route: null, firstLoadUncompressedJsBytes: 100 }],
        baseline,
      ),
    ).toThrow("entry 0 is invalid");
  });
});
