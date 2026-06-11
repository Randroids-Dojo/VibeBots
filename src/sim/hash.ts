const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64_MASK = 0xffffffffffffffffn;

/**
 * FNV-1a 64-bit over raw bytes, returned as 16 hex chars. Pure BigInt
 * integer math, so the result is identical in every JS engine. Used to
 * fingerprint rapier world snapshots for client/server verification.
 */
export function fnv1a64(bytes: Uint8Array): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * FNV_PRIME) & U64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}
