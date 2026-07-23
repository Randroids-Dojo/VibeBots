#!/usr/bin/env bash
# Negative and positive fixtures for the AGENTS.md symlink audit (F-188).
# Builds throwaway git repositories, exercises the audit against each, and
# saves every exit status before inspecting output.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/check-agents-links.sh"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/agents-links-selftest.XXXXXX")
CASES=0
FAILED=0

make_repo() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
  mkdir -p "$dir/.claude/rules"
  echo "slice rule" > "$dir/.claude/rules/slice-discipline.md"
  echo "ledger rule" > "$dir/.claude/rules/ledger-append-only.md"
  echo "gdd rule" > "$dir/.claude/rules/gdd-build-log.md"
}

run_check() {
  local repo="$1" out="$2"
  git -C "$repo" add -A
  bash "$CHECK" "$repo" > "$out" 2>&1
  CHECK_STATUS=$?
}

assert() {
  # assert <case> <expected: zero|nonzero> <out-file> [required-substring]
  local name="$1" expected="$2" out="$3" needle="${4:-}"
  CASES=$((CASES + 1))
  local bad=""
  if [ "$expected" = "zero" ] && [ "$CHECK_STATUS" -ne 0 ]; then
    bad="expected exit 0, got $CHECK_STATUS"
  fi
  if [ "$expected" = "nonzero" ] && [ "$CHECK_STATUS" -eq 0 ]; then
    bad="expected nonzero exit, got 0"
  fi
  if [ -z "$bad" ] && [ -n "$needle" ] && ! grep -qF "$needle" "$out"; then
    bad="output missing: $needle"
  fi
  if [ -n "$bad" ]; then
    FAILED=$((FAILED + 1))
    echo "SELFTEST FAIL: $name: $bad"
    echo "--- captured output:"
    cat "$out"
    echo "---"
  else
    echo "selftest ok: $name"
  fi
}

# Case 1: correct links everywhere, including a nested path with spaces and
# parentheses, pass.
R="$WORK/valid"; make_repo "$R"
mkdir -p "$R/src/app/(auth)/sign in" "$R/tests" "$R/docs/gdd"
ln -s ../.claude/rules/slice-discipline.md "$R/src/AGENTS.md"
ln -s ../../../../.claude/rules/slice-discipline.md "$R/src/app/(auth)/sign in/AGENTS.md"
ln -s ../.claude/rules/slice-discipline.md "$R/tests/AGENTS.md"
ln -s ../.claude/rules/ledger-append-only.md "$R/docs/AGENTS.md"
ln -s ../../.claude/rules/gdd-build-log.md "$R/docs/gdd/AGENTS.md"
run_check "$R" "$WORK/valid.out"
assert valid zero "$WORK/valid.out"

# Case 2: wrong ../ depth in a parenthesized path fails as broken.
R="$WORK/wrong-depth"; make_repo "$R"
mkdir -p "$R/src/app/(auth)/sign-in" "$R/tests" "$R/docs/gdd"
ln -s ../.claude/rules/slice-discipline.md "$R/src/AGENTS.md"
ln -s ../../../.claude/rules/slice-discipline.md "$R/src/app/(auth)/sign-in/AGENTS.md"
ln -s ../.claude/rules/slice-discipline.md "$R/tests/AGENTS.md"
ln -s ../.claude/rules/ledger-append-only.md "$R/docs/AGENTS.md"
ln -s ../../.claude/rules/gdd-build-log.md "$R/docs/gdd/AGENTS.md"
run_check "$R" "$WORK/wrong-depth.out"
assert wrong-depth nonzero "$WORK/wrong-depth.out" "BROKEN: src/app/(auth)/sign-in/AGENTS.md"

# Case 3: a link that resolves outside the repository fails.
R="$WORK/outside"; make_repo "$R"
mkdir -p "$R/src"
echo "outside file" > "$WORK/outside-target.md"
ln -s ../../outside-target.md "$R/src/AGENTS.md"
run_check "$R" "$WORK/outside.out"
assert outside nonzero "$WORK/outside.out" "OUTSIDE REPOSITORY: src/AGENTS.md"

# Case 4: a link that resolves to the wrong checked-in rule fails.
R="$WORK/wrong-rule"; make_repo "$R"
mkdir -p "$R/src"
ln -s ../.claude/rules/ledger-append-only.md "$R/src/AGENTS.md"
run_check "$R" "$WORK/wrong-rule.out"
assert wrong-rule nonzero "$WORK/wrong-rule.out" "WRONG RULE: src/AGENTS.md"

# Case 5: a covered directory that lost its tracked link fails.
R="$WORK/missing-link"; make_repo "$R"
mkdir -p "$R/src" "$R/docs"
ln -s ../.claude/rules/slice-discipline.md "$R/src/AGENTS.md"
run_check "$R" "$WORK/missing-link.out"
assert missing-link nonzero "$WORK/missing-link.out" "MISSING LINK: docs exists but docs/AGENTS.md"

echo
if [ "$FAILED" -gt 0 ]; then
  echo "agents-links selftest: $FAILED of $CASES cases FAILED"
  exit 1
fi
echo "agents-links selftest: all $CASES cases passed"
exit 0
