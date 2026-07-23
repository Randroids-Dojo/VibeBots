export const CAPABILITY_TAGS = ["@functional", "@render", "@visual", "@soak"];

export const POLICY_TAGS = ["@critical", "@preview", "@serial"];

const KNOWN_TAGS = new Set([...CAPABILITY_TAGS, ...POLICY_TAGS]);
const CASE_ID_PATTERN = /^E2E-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{4}$/;
const FUNCTIONAL_PIXEL_PATTERN =
  /\.screenshot\s*\(|toHaveScreenshot\s*\(|Buffer\.compare\s*\(|getImageData\s*\(|imagePixel|countRedPixels|countBrightPixels/;

function normalizeTag(tag) {
  return tag.startsWith("@") ? tag : `@${tag}`;
}

function suiteTitlePath(parents, specTitle) {
  return [...parents.filter((title) => !title.endsWith(".spec.ts")), specTitle];
}

export function collectCases(report) {
  const cases = [];

  function visitSuite(suite, parents = []) {
    const nextParents = suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs ?? []) {
      const tags = [...new Set((spec.tags ?? []).map(normalizeTag))];
      const projects = spec.tests ?? [];
      const annotations = projects[0]?.annotations ?? [];
      cases.push({
        file: spec.file,
        line: spec.line,
        titlePath: suiteTitlePath(nextParents, spec.title),
        tags,
        annotations,
        projectNames: projects.map((project) => project.projectName),
      });
    }
    for (const child of suite.suites ?? []) {
      visitSuite(child, nextParents);
    }
  }

  for (const suite of report.suites ?? []) {
    visitSuite(suite);
  }
  return cases;
}

export function validateInventory(cases, quarantine, options = {}) {
  const errors = [];
  const seenIds = new Map();
  const normalizedCases = [];
  const sourceByLocation = options.sourceByLocation;

  for (const item of cases) {
    const location = `${item.file}:${item.line}`;
    const capabilityTags = item.tags.filter((tag) =>
      CAPABILITY_TAGS.includes(tag),
    );
    const policyTags = item.tags.filter((tag) => POLICY_TAGS.includes(tag));
    const unknownTags = item.tags.filter((tag) => !KNOWN_TAGS.has(tag));
    const caseAnnotations = item.annotations.filter(
      (annotation) => annotation.type === "case-id",
    );

    if (capabilityTags.length !== 1) {
      errors.push(
        `${location} must have exactly one capability tag, found ${capabilityTags.length}`,
      );
    }
    if (unknownTags.length > 0) {
      errors.push(`${location} has unknown tags: ${unknownTags.join(", ")}`);
    }
    if (caseAnnotations.length !== 1) {
      errors.push(
        `${location} must have exactly one case-id annotation, found ${caseAnnotations.length}`,
      );
    }

    const caseId = caseAnnotations[0]?.description ?? "";
    if (caseId && !CASE_ID_PATTERN.test(caseId)) {
      errors.push(`${location} has invalid case id ${caseId}`);
    }
    if (caseId) {
      const firstLocation = seenIds.get(caseId);
      if (firstLocation) {
        errors.push(
          `${location} duplicates case id ${caseId} from ${firstLocation}`,
        );
      } else {
        seenIds.set(caseId, location);
      }
    }

    const capability = capabilityTags[0] ?? null;
    if (policyTags.includes("@critical") && capability !== "@functional") {
      errors.push(`${location} uses @critical outside @functional`);
    }
    const source = sourceByLocation?.get(location);
    if (sourceByLocation && source === undefined) {
      errors.push(`${location} could not be matched to its source test call`);
    }
    if (
      capability === "@functional" &&
      source !== undefined &&
      FUNCTIONAL_PIXEL_PATTERN.test(source)
    ) {
      errors.push(`${location} uses pixel assertions inside @functional`);
    }

    normalizedCases.push({
      caseId,
      capability,
      policyTags,
      file: item.file,
      line: item.line,
      titlePath: item.titlePath,
      projectNames: item.projectNames,
    });
  }

  validateQuarantine(quarantine, normalizedCases, errors, options.today);

  return {
    errors,
    cases: normalizedCases.sort((a, b) => a.caseId.localeCompare(b.caseId)),
  };
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function validateQuarantine(quarantine, cases, errors, todayOverride) {
  if (quarantine?.schemaVersion !== 1 || !Array.isArray(quarantine.entries)) {
    errors.push(
      "tests/e2e/quarantine.json must use schemaVersion 1 and entries[]",
    );
    return;
  }

  const today = parseIsoDate(
    todayOverride ?? new Date().toISOString().slice(0, 10),
  );
  const casesById = new Map(cases.map((item) => [item.caseId, item]));
  const seen = new Set();

  for (const entry of quarantine.entries) {
    const label = `quarantine ${entry.caseId ?? "<missing>"}`;
    if (!entry.caseId || seen.has(entry.caseId)) {
      errors.push(`${label} is missing or duplicated`);
    }
    seen.add(entry.caseId);
    const testCase = casesById.get(entry.caseId);
    if (!testCase) {
      errors.push(`${label} does not match a discovered case`);
    }
    if (testCase && entry.capability !== testCase.capability) {
      errors.push(`${label} capability does not match the discovered case`);
    }
    for (const field of [
      "owner",
      "tracking",
      "failureFingerprint",
      "reason",
      "disposition",
    ]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        errors.push(`${label} requires ${field}`);
      }
    }
    if (!Array.isArray(entry.evidenceRuns) || entry.evidenceRuns.length === 0) {
      errors.push(`${label} requires evidenceRuns`);
    }
    const added = parseIsoDate(entry.addedDate);
    const expiry = parseIsoDate(entry.expiresOn);
    if (!added || !expiry) {
      errors.push(`${label} requires ISO addedDate and expiresOn values`);
      continue;
    }
    const lifetimeDays = (expiry.valueOf() - added.valueOf()) / 86_400_000;
    if (lifetimeDays < 0 || lifetimeDays > 14) {
      errors.push(`${label} expiry must be within 14 days of addedDate`);
    }
    if (today && expiry < today) {
      errors.push(`${label} expired on ${entry.expiresOn}`);
    }
  }
}

export function summarizeInventory(cases) {
  const capabilities = Object.fromEntries(
    CAPABILITY_TAGS.map((tag) => [tag, 0]),
  );
  const policies = Object.fromEntries(POLICY_TAGS.map((tag) => [tag, 0]));
  for (const item of cases) {
    if (item.capability) capabilities[item.capability] += 1;
    for (const tag of item.policyTags) policies[tag] += 1;
  }
  return { total: cases.length, capabilities, policies };
}
