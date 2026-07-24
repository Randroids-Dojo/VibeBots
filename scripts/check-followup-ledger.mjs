#!/usr/bin/env node
// Followup ledger current-priority validation (F-157 / F-178).
//
// data-priority on a primary followup is authoritative; the physical bucket
// layout is historical and append-only. This check validates the non-primary
// priority-pointer layer that exposes current priority without moving any
// committed record. Node core modules only.
//
// Rules enforced:
//   - A primary is a <section> carrying data-f and no data-role. data-f is
//     unique across primaries. The single historical exception allowed to
//     carry data-f on a non-primary is the F-033 closure record.
//   - Document ids are globally unique.
//   - Priority pointers are elements with data-role="priority-pointer" and
//     data-f-ref="F-NNN". They never carry data-f or an id. Each targets
//     exactly one existing primary, sits physically under the bucket that
//     matches the target's data-priority, and is unique per target.
//   - Every primary whose physical container disagrees with its
//     data-priority must have exactly one pointer; correctly placed
//     primaries must have none (a redundant pointer fails).
//   - Placement grandfathering: the 70 mismatches audited at cutoff
//     ac99bcf1 (32 under a wrong named bucket, 38 outside every bucket)
//     plus the recorded post-cutoff violations below are tolerated but must
//     be pointer-covered. Any OTHER mismatch fails.
//   - data-f-successor appears only on a <dt> that also carries data-f-ref,
//     maps one distinct source to one distinct target, both resolving to
//     primaries, and is unique per source.
//
// Usage:
//   node scripts/check-followup-ledger.mjs                # real ledger
//   node scripts/check-followup-ledger.mjs --file <path> \
//        [--grandfathered F-001,F-002] [--known F-003]    # fixtures
import { readFileSync } from "node:fs";

// The 70 container mismatches audited at cutoff ac99bcf1 (F-157/F-178).
const GRANDFATHERED = new Set(
  (
    "F-012 F-013 F-014 F-015 F-016 F-017 F-018 F-019 F-020 F-021 F-022 " +
    "F-024 F-025 F-031 F-032 F-033 F-034 F-035 F-036 F-037 F-038 F-039 " +
    "F-040 F-041 F-042 F-043 F-044 F-045 F-046 F-047 F-048 F-049 F-077 " +
    "F-080 F-081 F-082 F-083 F-084 F-085 F-086 F-087 F-088 F-090 F-093 " +
    "F-094 F-095 F-096 F-097 F-098 F-099 F-100 F-104 F-105 F-106 F-107 " +
    "F-108 F-109 F-110 F-111 F-112 F-113 F-120 F-121 F-122 F-123 F-124 " +
    "F-125 F-129 F-133 F-144"
  ).split(/\s+/),
);

// Post-cutoff placement violations that are already committed history.
// F-161 is the recorded PR #221 case; the rest were observed and recorded by
// the 2026-07-23 audit that landed this check. They stay reported, must be
// pointer-covered, and the list only grows through an explicit ledger
// decision recorded in FOLLOWUPS.
const KNOWN_POST_CUTOFF = new Set(
  "F-161 F-163 F-197 F-209 F-212 F-214 F-215 F-216".split(/\s+/),
);

// Current-truth corrections that must stay present and accurate: each entry
// requires a correction dt with the given data-f-ref and data-f-successor
// whose dd contains the pinned phrase (F-180/F-149: the elevator closeout
// sequence correction).
const CURRENT_TRUTH_CORRECTIONS = [
  { ref: "F-123", successor: "F-149", phrase: "calls the car first" },
];

const BUCKETS = ["blocks-release", "nice-to-have", "polish"];
const CLOSURE_EXCEPTION_ID = "F-033-closure-2026-06-25";

const args = process.argv.slice(2);
let file = "docs/FOLLOWUPS.html";
let grandfathered = GRANDFATHERED;
let knownPostCutoff = KNOWN_POST_CUTOFF;
let corrections = CURRENT_TRUTH_CORRECTIONS;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--file") {
    file = args[++i];
    grandfathered = new Set();
    knownPostCutoff = new Set();
    corrections = [];
  } else if (args[i] === "--grandfathered") {
    grandfathered = new Set(args[++i].split(",").filter(Boolean));
  } else if (args[i] === "--known") {
    knownPostCutoff = new Set(args[++i].split(",").filter(Boolean));
  } else if (args[i] === "--correction") {
    const [ref, successor, ...phrase] = args[++i].split(":");
    corrections = corrections.concat([
      { ref, successor, phrase: phrase.join(":") },
    ]);
  } else {
    console.error(`unknown argument: ${args[i]}`);
    process.exit(2);
  }
}

let html;
try {
  html = readFileSync(file, "utf8");
} catch (err) {
  console.error(`cannot read ${file}: ${err.message}`);
  process.exit(2);
}

// Require a whitespace boundary before the attribute name so e.g. asking
// for id cannot match data-testid, and data-f cannot match data-f-ref.
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
};

const errors = [];
const notes = [];

// Balanced <section> ranges.
const sectionTokens = [...html.matchAll(/<section\b[^>]*>|<\/section>/g)];
const stack = [];
const sections = [];
for (const m of sectionTokens) {
  if (m[0].startsWith("</")) {
    if (stack.length === 0) {
      errors.push("unbalanced </section>");
      break;
    }
    const open = stack.pop();
    sections.push({ start: open.index, end: m.index, tag: open.tag });
  } else {
    stack.push({ index: m.index, tag: m[0] });
  }
}
if (stack.length > 0) errors.push(`${stack.length} unclosed <section> tag(s)`);

const bucketRanges = {};
for (const s of sections) {
  const id = attr(s.tag, "id");
  if (BUCKETS.includes(id)) bucketRanges[id] = s;
}

const containerOf = (pos) => {
  for (const b of BUCKETS) {
    const r = bucketRanges[b];
    if (r && pos > r.start && pos < r.end) return b;
  }
  return "outside";
};

// Primaries and the data-f exception scan.
const primaries = new Map(); // F-id -> {priority, container, pos}
for (const s of sections) {
  const f = attr(s.tag, "data-f");
  if (!f) continue;
  const role = attr(s.tag, "data-role");
  if (role) {
    if (attr(s.tag, "id") !== CLOSURE_EXCEPTION_ID) {
      errors.push(
        `non-primary section with data-f="${f}" (role ${role}); use data-f-ref`,
      );
    }
    continue;
  }
  if (primaries.has(f)) {
    errors.push(`duplicate primary data-f="${f}"`);
    continue;
  }
  primaries.set(f, {
    priority: attr(s.tag, "data-priority"),
    container: containerOf(s.start),
    pos: s.start,
  });
}

// Global id uniqueness.
const ids = new Map();
for (const m of html.matchAll(/<[a-zA-Z][^>]*\sid="([^"]+)"[^>]*>/g)) {
  const id = m[1];
  if (ids.has(id)) errors.push(`duplicate document id "${id}"`);
  ids.set(id, m.index);
}

// Priority pointers (any element).
const pointers = new Map(); // target -> {container}
for (const m of html.matchAll(
  /<[a-zA-Z][^>]*data-role="priority-pointer"[^>]*>/g,
)) {
  const tag = m[0];
  const ref = attr(tag, "data-f-ref");
  if (!ref) {
    errors.push(`priority-pointer without data-f-ref: ${tag}`);
    continue;
  }
  if (attr(tag, "data-f")) errors.push(`pointer to ${ref} carries data-f`);
  if (attr(tag, "id")) errors.push(`pointer to ${ref} carries a document id`);
  if (pointers.has(ref)) {
    errors.push(`duplicate priority pointer for ${ref}`);
    continue;
  }
  const target = primaries.get(ref);
  if (!target) {
    errors.push(`pointer targets missing or non-primary ${ref}`);
    continue;
  }
  const container = containerOf(m.index);
  if (container !== target.priority) {
    errors.push(
      `pointer for ${ref} sits under ${container}, target data-priority is ${target.priority}`,
    );
  }
  pointers.set(ref, { container });
}

// The recorded lists are not merely permissive: every recorded id must
// still exist as a primary and still be misplaced, so a deleted or moved
// baseline entry cannot vanish from validation silently.
for (const f of [...grandfathered, ...knownPostCutoff]) {
  const p = primaries.get(f);
  if (!p) {
    errors.push(`recorded mismatch ${f} is missing from the ledger`);
  } else if (p.container === p.priority) {
    errors.push(
      `recorded mismatch ${f} is no longer misplaced; update the recorded lists`,
    );
  }
}

// Placement and pointer coverage.
let mismatches = 0;
for (const [f, p] of primaries) {
  const misplaced = p.container !== p.priority;
  if (misplaced) {
    mismatches++;
    if (!grandfathered.has(f) && !knownPostCutoff.has(f)) {
      errors.push(
        `post-cutoff placement violation: ${f} (data-priority ${p.priority}) sits ${p.container === "outside" ? "outside every bucket" : `under ${p.container}`}`,
      );
    } else if (knownPostCutoff.has(f)) {
      notes.push(
        `recorded post-cutoff violation: ${f} under ${p.container}, authoritative ${p.priority}`,
      );
    }
    if (!pointers.has(f)) {
      errors.push(
        `misplaced primary ${f} has no priority pointer exposing ${p.priority}`,
      );
    }
  } else if (pointers.has(f)) {
    errors.push(
      `redundant priority pointer: ${f} already sits under ${p.priority}`,
    );
  }
}

// data-f-successor discipline.
const successorSources = new Set();
const successorMap = new Map();
for (const m of html.matchAll(
  /<[a-zA-Z][^>]*data-f-successor="([^"]+)"[^>]*>/g,
)) {
  const tag = m[0];
  const successor = m[1];
  const ref = attr(tag, "data-f-ref");
  if (!tag.startsWith("<dt")) {
    errors.push(`data-f-successor on a non-dt element: ${tag}`);
    continue;
  }
  if (!ref) {
    errors.push(`data-f-successor="${successor}" without data-f-ref`);
    continue;
  }
  if (ref === successor) errors.push(`self-referential successor edge ${ref}`);
  if (!primaries.has(ref))
    errors.push(`successor edge source ${ref} is not a primary`);
  if (!primaries.has(successor))
    errors.push(`successor edge target ${successor} is not a primary`);
  if (successorSources.has(ref))
    errors.push(`duplicate successor mapping for source ${ref}`);
  successorSources.add(ref);
  if (ref && ref !== successor) successorMap.set(ref, successor);
}

// Multi-node cycles are forbidden, not just self-references.
for (const start of successorMap.keys()) {
  let cur = successorMap.get(start);
  const seen = new Set([start]);
  while (cur !== undefined) {
    if (cur === start) {
      errors.push(`cyclic successor mapping involving ${start}`);
      break;
    }
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = successorMap.get(cur);
  }
}

// Pinned current-truth corrections must exist and carry their phrase.
for (const c of corrections) {
  const re = new RegExp(
    `<dt\\b(?=[^>]*data-f-ref="${c.ref}")(?=[^>]*data-f-successor="${c.successor}")[^>]*>[\\s\\S]*?</dt>\\s*<dd>([\\s\\S]*?)</dd>`,
  );
  const m = html.match(re);
  if (!m) {
    errors.push(
      `missing current-truth correction dt for ${c.ref} (successor ${c.successor})`,
    );
  } else if (!m[1].includes(c.phrase)) {
    errors.push(
      `current-truth correction for ${c.ref} lost its pinned phrase "${c.phrase}"`,
    );
  }
}

for (const n of notes) console.log(`note: ${n}`);
console.log(
  `followup ledger: ${primaries.size} primaries, ${mismatches} container mismatches (${grandfathered.size} grandfathered at cutoff, ${knownPostCutoff.size} recorded post-cutoff), ${pointers.size} priority pointers`,
);
if (errors.length > 0) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  console.error(`followup ledger check FAILED with ${errors.length} error(s)`);
  process.exit(1);
}
console.log("followup ledger check passed");
