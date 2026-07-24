const CASE_ID_PATTERN = /^E2E-[A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{4}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SHARD_PATTERN = /^([1-9][0-9]*)\/([1-9][0-9]*)$/;

function valueAfter(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

export function parseReproArgs(args) {
  let caseId = null;
  let shard = null;
  let imageDigest = null;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--case") {
      caseId = valueAfter(args, index, "--case");
      index++;
      continue;
    }
    if (argument === "--shard") {
      shard = valueAfter(args, index, "--shard");
      index++;
      continue;
    }
    if (argument === "--image-digest") {
      imageDigest = valueAfter(args, index, "--image-digest");
      index++;
      continue;
    }
    throw new Error(`Unknown ci:repro argument ${argument}`);
  }

  if (Number(Boolean(caseId)) + Number(Boolean(shard)) !== 1) {
    throw new Error("ci:repro requires exactly one of --case or --shard");
  }
  if (caseId && !CASE_ID_PATTERN.test(caseId)) {
    throw new Error(`Invalid case ID ${caseId}`);
  }
  if (shard) {
    const match = SHARD_PATTERN.exec(shard);
    if (!match || Number(match[1]) > Number(match[2])) {
      throw new Error(`Invalid shard ${shard}; use an index/count such as 2/8`);
    }
  }
  if (imageDigest && !DIGEST_PATTERN.test(imageDigest)) {
    throw new Error(`Invalid image digest ${imageDigest}`);
  }

  return { caseId, shard, imageDigest };
}

export function pinnedRuntimeImage(manifest, digestOverride = null) {
  const digest = digestOverride ?? manifest.imageDigest;
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.imageRepository !== "string" ||
    !DIGEST_PATTERN.test(digest ?? "")
  ) {
    throw new Error("ci/browser-runtime/runtime.json is not fully pinned");
  }
  return `${manifest.imageRepository}@${digest}`;
}

export function resolveFunctionalCase(cases, caseId) {
  const testCase = cases.find((entry) => entry.caseId === caseId);
  if (!testCase) {
    throw new Error(`Unknown case ID ${caseId}`);
  }
  if (testCase.capability !== "@functional") {
    throw new Error(
      `${caseId} is ${testCase.capability}, not a required functional case`,
    );
  }
  return `${testCase.file}:${testCase.line}`;
}

export function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
