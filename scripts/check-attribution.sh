#!/usr/bin/env bash
# AI-attribution preflight for repository metadata (F-211, AGENTS.md Rule 4).
#
# Scans commit messages (subject, body, trailers) in a pushed range, a single
# published commit, or a prepared message file (squash subject and body, PR
# title and body) for prohibited AI attribution. Metadata only: source and
# documentation text are out of scope, as are author and committer identity
# (a separate explicit policy decision per F-211).
#
# Usage:
#   bash scripts/check-attribution.sh                       # origin/main..HEAD
#   bash scripts/check-attribution.sh <base> <head>         # explicit range
#   bash scripts/check-attribution.sh --commit <sha>        # one published commit
#   bash scripts/check-attribution.sh --message-file <path> # squash / PR text
#
# Exit 0 when clean, 1 when attribution is found, 2 on usage or repo errors.
# Operates on the git repository of the current working directory so the
# fixtures can point it at throwaway repos.
set -u

# Case-insensitive extended-regex patterns. Ordinary human metadata must stay
# green: a human co-author trailer, or gameplay wording like "bot AI", is not
# attribution.
PATTERNS=(
  'co-authored-by:[^<]*\b(claude|anthropic|copilot|chatgpt|gpt|openai|gemini|cursor|codex)\b'
  'co-authored-by:.*(anthropic\.com|github\.copilot|openai\.com)'
  'generated (with|by|using)[^.]*\b(claude|copilot|chatgpt|gpt|anthropic|gemini|cursor|codex|ai)\b'
  '\bclaude (code|fable|opus|sonnet|haiku)\b'
  '\banthropic\b'
  '\bai[- ](assisted|assistance|generated|authored|written)\b'
  '(written|authored|created|implemented) (with|by) (an? )?(ai|llm)\b'
  'noreply@anthropic\.com'
  "$(printf '\xf0\x9f\xa4\x96')"
)

scan_text() {
  # scan_text <label> <file-with-text>; prints findings, returns 1 when dirty.
  local label="$1" file="$2" pat
  local hits="$file.hits"
  : > "$hits"
  for pat in "${PATTERNS[@]}"; do
    grep -niE "$pat" "$file" >> "$hits" || true
  done
  if [ -s "$hits" ]; then
    echo "ATTRIBUTION in $label:"
    sort -t: -k1,1n -u "$hits" | head -10
    rm -f "$hits"
    return 1
  fi
  rm -f "$hits"
  return 0
}

TMP=$(mktemp "${TMPDIR:-/tmp}/attribution.XXXXXX")
trap 'rm -f "$TMP"' EXIT
FAIL=0

if [ "${1:-}" = "--message-file" ]; then
  [ -z "${2:-}" ] || [ ! -f "${2:-}" ] && { echo "usage: --message-file <path>" >&2; exit 2; }
  cp "$2" "$TMP"
  scan_text "message file $2" "$TMP" || FAIL=1
elif [ "${1:-}" = "--commit" ]; then
  [ -z "${2:-}" ] && { echo "usage: --commit <sha>" >&2; exit 2; }
  git rev-parse -q --verify "$2^{commit}" >/dev/null || { echo "unknown commit: $2" >&2; exit 2; }
  git log -n1 --format=%B "$2" >"$TMP"
  scan_text "commit $2" "$TMP" || FAIL=1
else
  BASE="${1:-origin/main}"
  HEAD_REF="${2:-HEAD}"
  git rev-parse -q --verify "$BASE^{commit}" >/dev/null || { echo "unknown base: $BASE" >&2; exit 2; }
  git rev-parse -q --verify "$HEAD_REF^{commit}" >/dev/null || { echo "unknown head: $HEAD_REF" >&2; exit 2; }
  COUNT=0
  while IFS= read -r sha; do
    COUNT=$((COUNT + 1))
    git log -n1 --format=%B "$sha" >"$TMP"
    scan_text "commit $sha" "$TMP" || FAIL=1
  done < <(git rev-list "$BASE..$HEAD_REF")
  echo "attribution scan: $COUNT commit(s) in $BASE..$HEAD_REF"
fi

if [ "$FAIL" -ne 0 ]; then
  echo "AI attribution found in repository metadata (AGENTS.md Rule 4). Rewrite the message."
  exit 1
fi
echo "attribution: clean"
exit 0
