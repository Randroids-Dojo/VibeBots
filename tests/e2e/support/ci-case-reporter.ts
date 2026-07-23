import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { CI_CAPABILITY_TAGS, CI_POLICY_TAGS } from "./ci-case";

type ReporterOptions = { outputFile?: string };
const capabilityTags = new Set<string>(CI_CAPABILITY_TAGS);
const policyTags = new Set<string>(CI_POLICY_TAGS);

export default class CiCaseReporter implements Reporter {
  private readonly outputFile: string;
  private readonly records: Record<string, unknown>[] = [];

  constructor(options: ReporterOptions = {}) {
    this.outputFile =
      options.outputFile ?? "playwright-report/ci-case-results.json";
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const caseId = test.annotations.find(
      (annotation) => annotation.type === "case-id",
    )?.description;
    const tags = test.tags.map((tag) =>
      tag.startsWith("@") ? tag : `@${tag}`,
    );
    this.records.push({
      caseId: caseId ?? null,
      capability: tags.find((tag) => capabilityTags.has(tag)) ?? null,
      policyTags: tags.filter((tag) => policyTags.has(tag)),
      project: test.parent.project()?.name ?? null,
      file: test.location.file,
      titlePath: test.titlePath(),
      attempt: result.retry + 1,
      durationMs: result.duration,
      outcome: result.status,
      startedAt: result.startTime.toISOString(),
    });
  }

  onEnd(result: FullResult): void {
    const output = path.resolve(this.outputFile);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(
      output,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          commitSha: process.env.GITHUB_SHA ?? null,
          status: result.status,
          records: this.records,
        },
        null,
        2,
      )}\n`,
    );
  }
}
