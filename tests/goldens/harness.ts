import fs from "node:fs";
import path from "node:path";
import { SIM_VERSION } from "../../src/sim/constants";
import type { BotDesign } from "../../src/sim/design";
import { fnv1a64 } from "../../src/sim/hash";
import type { MineAction } from "../../src/sim/mine/actions";
import type { WorldDiff } from "../../src/sim/mine/cells";
import type { MineConsumables } from "../../src/sim/mine/consumables";
import { MINE_VERSION } from "../../src/sim/mine/consumables";
import type { MineGear } from "../../src/sim/mine/gear";
import { replayTrip } from "../../src/sim/mine/replay";
import { resolveMatch } from "../../src/sim/resolve";
import { runSim } from "../../src/sim/run";

export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type GoldenKind = "combat" | "economy" | "mining" | "replay" | "world";

export interface GoldenResult {
  snapshotHash: string;
  outcomes: JsonValue;
}

export interface GoldenVector {
  schemaVersion: 1;
  id: string;
  kind: GoldenKind;
  seed: number;
  stepCount: number;
  simVersion: number;
  mineVersion?: number;
  designInputs?: [BotDesign, BotDesign];
  gearInputs?: MineGear;
  consumableInputs?: MineConsumables;
  worldDiffInput?: WorldDiff;
  actionLog: MineAction[];
  expected: GoldenResult | null;
  manifestId: string | null;
}

export interface GoldenChange {
  vectorId: string;
  kind: GoldenKind;
  changedFields: string[];
  oldSnapshotHash: string | null;
  newSnapshotHash: string;
  oldOutcomes: JsonValue | null;
  newOutcomes: JsonValue;
  versionDecision: {
    constant: "MINE_VERSION" | "SIM_VERSION";
    from: number | null;
    to: number;
  };
}

export interface GoldenChangeManifest {
  id: string;
  createdAt: string;
  reason: string;
  changes: GoldenChange[];
}

export interface LoadedVector {
  filePath: string;
  vector: GoldenVector;
}

export interface FieldDifference {
  path: string;
  expected: JsonValue | undefined;
  actual: JsonValue | undefined;
}

const GOLDEN_ROOT = path.resolve(process.cwd(), "tests/goldens");
const VECTOR_ROOT = path.join(GOLDEN_ROOT, "vectors");
const MANIFEST_PATH = path.join(GOLDEN_ROOT, "change-manifest.json");
const MINE_KINDS = new Set<GoldenKind>(["economy", "mining", "replay"]);

function isRecord(value: JsonValue | undefined): value is {
  [key: string]: JsonValue;
} {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stableStringify(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashJson(value: JsonValue): string {
  return fnv1a64(new TextEncoder().encode(stableStringify(value)));
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function loadVectors(): LoadedVector[] {
  return fs
    .readdirSync(VECTOR_ROOT)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const filePath = path.join(VECTOR_ROOT, name);
      return {
        filePath,
        vector: JSON.parse(fs.readFileSync(filePath, "utf8")) as GoldenVector,
      };
    });
}

export function loadManifests(): GoldenChangeManifest[] {
  return JSON.parse(
    fs.readFileSync(MANIFEST_PATH, "utf8"),
  ) as GoldenChangeManifest[];
}

export function relevantVersion(vector: GoldenVector): {
  constant: "MINE_VERSION" | "SIM_VERSION";
  current: number;
  stored: number;
} {
  if (MINE_KINDS.has(vector.kind)) {
    if (vector.mineVersion === undefined) {
      throw new Error(`${vector.id} is missing MINE_VERSION`);
    }
    return {
      constant: "MINE_VERSION",
      current: MINE_VERSION,
      stored: vector.mineVersion,
    };
  }
  return {
    constant: "SIM_VERSION",
    current: SIM_VERSION,
    stored: vector.simVersion,
  };
}

export function assessVersionPolicy(
  vector: GoldenVector,
  outputChanged: boolean,
): { kind: "ok" | "warning"; message?: string } {
  const version = relevantVersion(vector);
  if (vector.expected === null) return { kind: "ok" };
  if (outputChanged && version.current === version.stored) {
    throw new Error(
      `${vector.id}: deterministic output changed while ${version.constant} stayed at ${version.current}. Bump ${version.constant} before updating this golden.`,
    );
  }
  if (!outputChanged && version.current !== version.stored) {
    return {
      kind: "warning",
      message: `${vector.id}: ${version.constant} changed from ${version.stored} to ${version.current}, but this vector did not change. Review whether the version bump is necessary or coverage is missing.`,
    };
  }
  return { kind: "ok" };
}

export function fieldDifferences(
  expected: JsonValue | undefined,
  actual: JsonValue | undefined,
  currentPath = "$",
): FieldDifference[] {
  if (Object.is(expected, actual)) return [];
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const differences: FieldDifference[] = [];
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index++) {
      differences.push(
        ...fieldDifferences(
          expected[index],
          actual[index],
          `${currentPath}[${index}]`,
        ),
      );
    }
    return differences;
  }
  if (isRecord(expected) && isRecord(actual)) {
    const differences: FieldDifference[] = [];
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of [...keys].sort()) {
      differences.push(
        ...fieldDifferences(
          expected[key],
          actual[key],
          `${currentPath}.${key}`,
        ),
      );
    }
    return differences;
  }
  return [{ path: currentPath, expected, actual }];
}

export async function evaluateVector(
  vector: GoldenVector,
): Promise<GoldenResult> {
  if (vector.kind === "world") {
    const result = await runSim({
      seed: vector.seed,
      steps: vector.stepCount,
    });
    return {
      snapshotHash: result.hash,
      outcomes: asJson({
        seed: result.seed,
        simVersion: result.simVersion,
        steps: result.steps,
      }),
    };
  }

  if (vector.kind === "combat") {
    if (!vector.designInputs) {
      throw new Error(`${vector.id} is missing designInputs`);
    }
    const result = await resolveMatch(vector.designInputs, vector.stepCount);
    return {
      snapshotHash: result.hash,
      outcomes: asJson({
        rewards: result.rewards,
        status: result.status,
        tick: result.tick,
      }),
    };
  }

  if (!vector.gearInputs || !vector.consumableInputs) {
    throw new Error(`${vector.id} is missing mine gear or consumable inputs`);
  }
  const result = replayTrip(
    vector.seed,
    vector.actionLog,
    vector.gearInputs,
    vector.consumableInputs,
    vector.worldDiffInput,
  );
  const snapshotHash = hashJson(asJson(result.diff));

  if (vector.kind === "economy") {
    return {
      snapshotHash,
      outcomes: asJson({
        bankedCredits: result.bankedCredits,
        bankedParts: result.bankedParts,
        payout: result.soldHaul ?? null,
      }),
    };
  }
  if (vector.kind === "mining") {
    return {
      snapshotHash,
      outcomes: asJson({
        collapsesSurvived: result.collapsesSurvived,
        granted: result.granted,
        maxDepth: result.maxDepth,
        moves: result.moves,
        roofRescues: result.roofRescues,
        used: result.used,
        worldCells: result.diff.length,
      }),
    };
  }
  return {
    snapshotHash,
    outcomes: asJson({
      bagDrops: result.bagDrops,
      bankedCredits: result.bankedCredits,
      bankedParts: result.bankedParts,
      collapsesSurvived: result.collapsesSurvived,
      elevatorRides: result.elevatorRides,
      granted: result.granted,
      maxDepth: result.maxDepth,
      moves: result.moves,
      payout: result.soldHaul ?? null,
      roofRescues: result.roofRescues,
      used: result.used,
      worldCells: result.diff.length,
    }),
  };
}

export function validateManifestLink(
  vector: GoldenVector,
  manifests: GoldenChangeManifest[],
): void {
  if (!vector.expected || !vector.manifestId) {
    throw new Error(
      `${vector.id} has no generated golden or manifest link. Run pnpm test:goldens:update -- --reason <text>.`,
    );
  }
  const manifest = manifests.find((entry) => entry.id === vector.manifestId);
  const change = manifest?.changes.find(
    (entry) => entry.vectorId === vector.id,
  );
  if (!manifest || !change) {
    throw new Error(
      `${vector.id} references missing manifest ${vector.manifestId}`,
    );
  }
  if (!manifest.reason.trim()) {
    throw new Error(`${manifest.id} has an empty golden update reason`);
  }
  if (
    change.newSnapshotHash !== vector.expected.snapshotHash ||
    stableStringify(change.newOutcomes) !==
      stableStringify(vector.expected.outcomes)
  ) {
    throw new Error(
      `${vector.id} does not match its machine-readable change manifest`,
    );
  }
  const version = relevantVersion(vector);
  if (
    change.versionDecision.constant !== version.constant ||
    change.versionDecision.to !== version.stored
  ) {
    throw new Error(
      `${vector.id} version does not match its machine-readable change manifest`,
    );
  }
}

function manifestId(createdAt: string): string {
  return `goldens-${createdAt.replace(/[^0-9]/g, "")}`;
}

export async function updateGoldens(reason: string): Promise<{
  changes: GoldenChange[];
  warnings: string[];
}> {
  if (!reason.trim()) {
    throw new Error("Golden updates require --reason with non-empty text.");
  }
  const loaded = loadVectors();
  const manifests = loadManifests();
  const pending: Array<{
    loaded: LoadedVector;
    actual: GoldenResult;
    differences: FieldDifference[];
  }> = [];
  const warnings: string[] = [];

  for (const entry of loaded) {
    const actual = await evaluateVector(entry.vector);
    const differences =
      entry.vector.expected === null
        ? [
            {
              path: "$",
              expected: undefined,
              actual: asJson(actual),
            },
          ]
        : fieldDifferences(asJson(entry.vector.expected), asJson(actual));
    const policy = assessVersionPolicy(entry.vector, differences.length > 0);
    if (policy.kind === "warning" && policy.message) {
      warnings.push(policy.message);
    }
    if (differences.length > 0) {
      pending.push({ loaded: entry, actual, differences });
    }
  }

  if (pending.length === 0) return { changes: [], warnings };

  const createdAt = new Date().toISOString();
  const id = manifestId(createdAt);
  const changes = pending.map(({ loaded, actual, differences }) => {
    const version = relevantVersion(loaded.vector);
    return {
      vectorId: loaded.vector.id,
      kind: loaded.vector.kind,
      changedFields: differences.map((difference) => difference.path),
      oldSnapshotHash: loaded.vector.expected?.snapshotHash ?? null,
      newSnapshotHash: actual.snapshotHash,
      oldOutcomes: loaded.vector.expected?.outcomes ?? null,
      newOutcomes: actual.outcomes,
      versionDecision: {
        constant: version.constant,
        from: loaded.vector.expected === null ? null : version.stored,
        to: version.current,
      },
    } satisfies GoldenChange;
  });

  for (const { loaded, actual } of pending) {
    loaded.vector.expected = actual;
    loaded.vector.manifestId = id;
    loaded.vector.simVersion = SIM_VERSION;
    if (MINE_KINDS.has(loaded.vector.kind)) {
      loaded.vector.mineVersion = MINE_VERSION;
    }
    fs.writeFileSync(
      loaded.filePath,
      `${JSON.stringify(loaded.vector, null, 2)}\n`,
    );
  }
  manifests.push({ id, createdAt, reason: reason.trim(), changes });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifests, null, 2)}\n`);
  return { changes, warnings };
}
