#!/usr/bin/env bash
# Fails when any tracked-ish file contains an em-dash (U+2014) or en-dash (U+2013).
# Uses printf-built UTF-8 bytes so it works with both BSD and GNU grep.
set -euo pipefail
cd "$(dirname "$0")/.."

EM=$(printf '\342\200\224')
EN=$(printf '\342\200\223')

matches=$(grep -rn -e "$EM" -e "$EN" . \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=test-results \
  --exclude-dir=playwright-report \
  --exclude-dir=coverage \
  --exclude=pnpm-lock.yaml \
  2>/dev/null || true)

if [ -n "$matches" ]; then
  echo "$matches"
  echo "Em-dash or en-dash found. Rewrite without them (AGENTS.md Rule 1)."
  exit 1
fi
