import { describe, expect, it } from "vitest";
import {
  assessVersionPolicy,
  evaluateVector,
  fieldDifferences,
  type JsonValue,
  loadManifests,
  loadVectors,
  stableStringify,
  validateManifestLink,
} from "./harness";

const loaded = loadVectors();
const manifests = loadManifests();
const kinds = ["combat", "economy", "mining", "replay", "world"];

describe("deterministic golden vectors", () => {
  it("uses unique stable IDs and complete versioned inputs", () => {
    const ids = loaded.map(({ vector }) => vector.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { vector } of loaded) {
      expect(vector.schemaVersion).toBe(1);
      expect(vector.id).toMatch(/^GOLDEN-[A-Z]+-\d{4}$/);
      expect(kinds).toContain(vector.kind);
      expect(Number.isInteger(vector.seed)).toBe(true);
      expect(Number.isInteger(vector.stepCount)).toBe(true);
      expect(vector.stepCount).toBeGreaterThan(0);
      expect(Number.isInteger(vector.simVersion)).toBe(true);
      expect(Array.isArray(vector.actionLog)).toBe(true);
      expect(
        vector.actionLog.every((action) => typeof action === "string"),
      ).toBe(true);
      if (["economy", "mining", "replay"].includes(vector.kind)) {
        expect(Number.isInteger(vector.mineVersion)).toBe(true);
        expect(vector.actionLog.length).toBe(vector.stepCount);
      }
      validateManifestLink(vector, manifests);
    }
  });

  for (const { vector } of loaded) {
    it(`${vector.id} ${vector.kind}`, async () => {
      if (!vector.expected) {
        throw new Error(
          `${vector.id} has no baseline. Run pnpm test:goldens:update -- --reason <text>.`,
        );
      }
      const actual = await evaluateVector(vector);
      const differences = fieldDifferences(
        JSON.parse(JSON.stringify(vector.expected)) as JsonValue,
        JSON.parse(JSON.stringify(actual)) as JsonValue,
      );
      let policyError = "";
      try {
        const policy = assessVersionPolicy(vector, differences.length > 0);
        if (policy.kind === "warning" && policy.message) {
          console.warn(`GOLDEN REVIEW WARNING: ${policy.message}`);
        }
      } catch (error) {
        policyError = error instanceof Error ? error.message : String(error);
      }
      if (differences.length > 0 || policyError) {
        const fieldReport = differences
          .map(
            (difference) =>
              `${difference.path}\n  expected: ${stableStringify(
                difference.expected ?? null,
              )}\n  actual:   ${stableStringify(difference.actual ?? null)}`,
          )
          .join("\n");
        throw new Error(
          [
            `${vector.id} deterministic golden mismatch`,
            `seed: ${vector.seed}`,
            `steps: ${vector.stepCount}`,
            `inputs: ${stableStringify(
              JSON.parse(
                JSON.stringify({
                  actionLog: vector.actionLog,
                  consumableInputs: vector.consumableInputs,
                  designInputs: vector.designInputs,
                  gearInputs: vector.gearInputs,
                  worldDiffInput: vector.worldDiffInput,
                }),
              ) as JsonValue,
            )}`,
            policyError,
            fieldReport,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    });
  }
});
