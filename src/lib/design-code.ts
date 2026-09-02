import {
  type BotDesign,
  botDesignSchema,
  botPaintSchema,
  type Connection,
  type PartInstance,
  validateDesign,
} from "@/sim/design";

/**
 * Share codes (G8, workshop garage program). A design is pure data, so a
 * bot can travel as a short string: paste it into the garage, or open the
 * workshop with it in the URL, and the same design validates and loads.
 *
 * Wire format: a version tag, a dot, then URL-safe base64 of a compact JSON
 * form. The compact form drops key names to positional tuples so a typical
 * bot fits in a chat message; the decoder rebuilds the full design and runs
 * it through the schema and the validator, so a tampered or hand-written
 * code is rejected rather than trusted.
 */

export const DESIGN_CODE_VERSION = "VB1";

/** Codes longer than this are refused before decoding. */
export const MAX_DESIGN_CODE_LENGTH = 8192;

// Compact tuple forms: [iid, partId, mergeLevel?] and
// [parentIid, parentConnector, childIid, childConnector, orientation?, gearRatio?].
type PartTuple = [string, string] | [string, string, number];
type ConnectionTuple =
  | [string, string, string, string]
  | [string, string, string, string, number]
  | [string, string, string, string, number, number];

interface CompactDesign {
  n: string;
  p: PartTuple[];
  c: ConnectionTuple[];
  b?: BotDesign["behavior"];
  w?: string;
  /** Paint as [body, trim] palette ids (G5). */
  k?: [string, string];
}

const BASE64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** URL-safe base64 without padding, over UTF-8 bytes. Runs in Node and browsers. */
export function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64URL[(triple >> 18) & 63];
    out += BASE64URL[(triple >> 12) & 63];
    if (i + 1 < bytes.length) out += BASE64URL[(triple >> 6) & 63];
    if (i + 2 < bytes.length) out += BASE64URL[triple & 63];
  }
  return out;
}

/** Inverse of encodeBase64Url. Returns null on any character outside the alphabet. */
export function decodeBase64Url(code: string): string | null {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of code) {
    const value = BASE64URL.indexOf(ch);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bytes),
    );
  } catch {
    return null;
  }
}

function compact(design: BotDesign): CompactDesign {
  const p: PartTuple[] = design.parts.map((part) =>
    part.mergeLevel !== undefined
      ? [part.iid, part.partId, part.mergeLevel]
      : [part.iid, part.partId],
  );
  const c: ConnectionTuple[] = design.connections.map((conn) => {
    const base: [string, string, string, string] = [
      conn.parentIid,
      conn.parentConnector,
      conn.childIid,
      conn.childConnector,
    ];
    if (conn.gearRatio !== undefined) {
      return [...base, conn.orientation ?? 0, conn.gearRatio];
    }
    if (conn.orientation !== undefined && conn.orientation !== 0) {
      return [...base, conn.orientation];
    }
    return base;
  });
  const out: CompactDesign = { n: design.name, p, c };
  if (design.behavior) out.b = design.behavior;
  if (design.weightClass) out.w = design.weightClass;
  if (design.paint) out.k = [design.paint.primary, design.paint.accent];
  return out;
}

function expand(raw: unknown): BotDesign | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<CompactDesign>;
  if (typeof value.n !== "string") return null;
  if (!Array.isArray(value.p) || !Array.isArray(value.c)) return null;
  const parts: PartInstance[] = [];
  for (const tuple of value.p) {
    if (!Array.isArray(tuple) || tuple.length < 2 || tuple.length > 3) {
      return null;
    }
    const [iid, partId, mergeLevel] = tuple as unknown[];
    if (typeof iid !== "string" || typeof partId !== "string") return null;
    const part: PartInstance = { iid, partId };
    if (mergeLevel !== undefined) {
      if (typeof mergeLevel !== "number") return null;
      part.mergeLevel = mergeLevel;
    }
    parts.push(part);
  }
  const connections: Connection[] = [];
  for (const tuple of value.c) {
    if (!Array.isArray(tuple) || tuple.length < 4 || tuple.length > 6) {
      return null;
    }
    const [
      parentIid,
      parentConnector,
      childIid,
      childConnector,
      orientation,
      gearRatio,
    ] = tuple as unknown[];
    if (
      typeof parentIid !== "string" ||
      typeof parentConnector !== "string" ||
      typeof childIid !== "string" ||
      typeof childConnector !== "string"
    ) {
      return null;
    }
    const conn: Connection = {
      parentIid,
      parentConnector,
      childIid,
      childConnector,
    };
    if (orientation !== undefined && orientation !== 0) {
      if (typeof orientation !== "number") return null;
      conn.orientation = orientation as Connection["orientation"];
    }
    if (gearRatio !== undefined) {
      if (typeof gearRatio !== "number") return null;
      conn.gearRatio = gearRatio;
    }
    connections.push(conn);
  }
  const design: BotDesign = { name: value.n, parts, connections };
  if (value.b !== undefined) design.behavior = value.b;
  if (value.w !== undefined) {
    if (typeof value.w !== "string") return null;
    design.weightClass = value.w;
  }
  if (value.k !== undefined) {
    const k = value.k as unknown;
    if (
      !Array.isArray(k) ||
      k.length !== 2 ||
      typeof k[0] !== "string" ||
      typeof k[1] !== "string"
    ) {
      return null;
    }
    // Only the fixed palette decodes; an unknown id is a bad code, not a
    // bot that renders unpainted.
    const paint = botPaintSchema.safeParse({ primary: k[0], accent: k[1] });
    if (!paint.success) return null;
    design.paint = paint.data;
  }
  return design;
}

/** The share code for a design. The design is assumed valid; encode what it is. */
export function encodeDesignCode(design: BotDesign): string {
  return `${DESIGN_CODE_VERSION}.${encodeBase64Url(JSON.stringify(compact(design)))}`;
}

export type DecodedDesign =
  | { ok: true; design: BotDesign }
  | { ok: false; reason: string };

/**
 * Parses a share code back into a design. Tolerates surrounding whitespace
 * and a pasted URL (the code is read from its `code` query parameter), and
 * refuses anything that does not rebuild into a design the validator
 * accepts, naming the first problem in one line.
 */
export function decodeDesignCode(input: string): DecodedDesign {
  let code = input.trim();
  if (code.length === 0)
    return { ok: false, reason: "Paste a share code first." };
  if (code.includes("://")) {
    try {
      code = new URL(code).searchParams.get("code")?.trim() ?? "";
    } catch {
      return { ok: false, reason: "That link has no share code in it." };
    }
    if (!code)
      return { ok: false, reason: "That link has no share code in it." };
  }
  if (code.length > MAX_DESIGN_CODE_LENGTH) {
    return { ok: false, reason: "That code is too long to be a bot." };
  }
  const dot = code.indexOf(".");
  if (dot < 0 || code.slice(0, dot) !== DESIGN_CODE_VERSION) {
    return {
      ok: false,
      reason: `Not a VibeBots share code (expected it to start with ${DESIGN_CODE_VERSION}.).`,
    };
  }
  const json = decodeBase64Url(code.slice(dot + 1));
  if (json === null) return { ok: false, reason: "That code is damaged." };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, reason: "That code is damaged." };
  }
  const expanded = expand(raw);
  if (!expanded) return { ok: false, reason: "That code is damaged." };
  const parsed = botDesignSchema.safeParse(expanded);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "That code describes a bot this version cannot read.",
    };
  }
  const validation = validateDesign(parsed.data);
  if (!validation.ok) {
    return {
      ok: false,
      reason: `That bot fails inspection: ${validation.errors[0]}.`,
    };
  }
  return { ok: true, design: parsed.data };
}

/** A workshop link that opens with the design loaded. */
export function designShareUrl(origin: string, design: BotDesign): string {
  return `${origin}/workshop?code=${encodeDesignCode(design)}`;
}
