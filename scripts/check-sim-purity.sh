#!/usr/bin/env bash
# Enforces the src/sim determinism contract (AGENTS.md Rule 3):
#   1. No renderer/framework imports: the sim must run identically in the
#      browser and in a Vercel Node function.
#   2. No nondeterministic Math: Math.random is seedless and the
#      transcendental functions differ across JS engines. Arithmetic,
#      Math.sqrt, Math.imul, Math.floor, Math.min/max/abs are allowed.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

if grep -rnE "(from|import)[[:space:]]*\(?[[:space:]]*['\"](react|react-dom|next|three|zustand|@react-three)(/[^'\"]*)?['\"]" src/sim --include='*.ts' 2>/dev/null; then
  echo "Purity violation: src/sim must stay renderer-free (no react/next/three/zustand imports)."
  fail=1
fi

if grep -rnE "Math\.(random|sin|cos|tan|pow|exp|log|log2|log10|atan2|asin|acos|atan|sinh|cosh|tanh|cbrt|expm1|log1p)\b" src/sim --include='*.ts' 2>/dev/null; then
  echo "Purity violation: nondeterministic Math call in src/sim (cross-engine results differ)."
  fail=1
fi

exit "$fail"
