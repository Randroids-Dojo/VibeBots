#!/usr/bin/env bash
# Regression fixtures for the canonical local verifier (F-189).
#
# Each case builds a fixture gate file, runs verify-local.sh in fixture mode
# with output captured to a file, saves the verifier's exit status FIRST, and
# only then inspects the captured output. The selftest itself never pipes the
# verifier through a formatter.
set -u

cd "$(dirname "$0")/.." || exit 1
VERIFIER="scripts/verify-local.sh"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/verify-selftest.XXXXXX") || exit 2
trap 'rm -rf "$WORK"' EXIT
CASES=0
FAILED=0

run_case() {
  # run_case <name> <expected-exit: zero|nonzero> <gates...>
  local name="$1" expected="$2"; shift 2
  CASES=$((CASES + 1))
  local gates="$WORK/$name.gates"
  local out="$WORK/$name.out"
  printf '%s\n' "$@" > "$gates"
  VERIFY_GATES_FILE="$gates" bash "$VERIFIER" > "$out" 2>&1
  local status=$?
  CASE_OUT=$out
  if [ "$expected" = "zero" ] && [ "$status" -ne 0 ]; then
    fail_case "$name" "expected exit 0, got $status"
    return 1
  fi
  if [ "$expected" = "nonzero" ] && [ "$status" -eq 0 ]; then
    fail_case "$name" "expected nonzero exit, got 0"
    return 1
  fi
  return 0
}

expect_in_output() {
  local name="$1" needle="$2"
  if ! grep -qF "$needle" "$CASE_OUT"; then
    fail_case "$name" "output missing: $needle"
    return 1
  fi
  return 0
}

fail_case() {
  local name="$1" why="$2"
  FAILED=$((FAILED + 1))
  echo "SELFTEST FAIL: $name: $why"
  echo "--- captured output ($CASE_OUT):"
  cat "$CASE_OUT" 2>/dev/null
  echo "---"
}

ok() {
  echo "selftest ok: $1"
}

# Case 1: a failing gate followed by a successful filter-style gate must
# still fail the verifier, with the exact upstream exit preserved. This is
# the core F-189 regression: the later successful command must not mask the
# earlier failure.
if run_case fail-then-filter nonzero \
  'fail-gate|exit 3' \
  'filter-gate|echo formatted-ok'; then
  expect_in_output fail-then-filter '[FAIL]    fail-gate (exit 3)' &&
  expect_in_output fail-then-filter '[PASS]    filter-gate' &&
  expect_in_output fail-then-filter 'First failure: fail-gate' &&
  ok fail-then-filter
fi

# Case 2: a pipeline inside a gate whose final command succeeds must still
# fail when the producer fails (pipefail inside the gate wrapper).
if run_case masked-pipeline nonzero \
  'piped-gate|exit 5 | cat'; then
  expect_in_output masked-pipeline '[FAIL]    piped-gate' &&
  ok masked-pipeline
fi

# Case 3: multiple failures are all reported and the FIRST one is named.
if run_case multiple-failures nonzero \
  'first-bad|exit 4' \
  'good|true' \
  'second-bad|exit 9'; then
  expect_in_output multiple-failures '[FAIL]    first-bad (exit 4)' &&
  expect_in_output multiple-failures '[FAIL]    second-bad (exit 9)' &&
  expect_in_output multiple-failures 'First failure: first-bad' &&
  ok multiple-failures
fi

# Case 4: a gate killed by a signal is a failure that names the signal.
if run_case signal-kill nonzero \
  'sig-gate|kill -TERM $$'; then
  expect_in_output signal-kill '[FAIL]    sig-gate' &&
  expect_in_output signal-kill 'signal' &&
  ok signal-kill
fi

# Case 5: an unavailable validator is NOT-RUN and fails closed; missing
# tooling is never green evidence.
if run_case missing-tool nonzero \
  'ghost-gate|definitely_missing_command_f189'; then
  expect_in_output missing-tool '[NOT-RUN] ghost-gate' &&
  expect_in_output missing-tool 'did not run' &&
  ok missing-tool
fi

# Case 6: a failing gate with no output still fails and says so.
if run_case empty-output nonzero \
  'silent-gate|exit 7'; then
  expect_in_output empty-output '[FAIL]    silent-gate (exit 7)' &&
  expect_in_output empty-output '(gate produced no output)' &&
  ok empty-output
fi

# Case 7: an all-green run exits zero.
if run_case all-pass zero \
  'gate-a|true' \
  'gate-b|echo fine'; then
  expect_in_output all-pass 'all 2 gates passed' &&
  ok all-pass
fi

echo
if [ "$FAILED" -gt 0 ]; then
  echo "verify-local selftest: $FAILED of $CASES cases FAILED"
  exit 1
fi
echo "verify-local selftest: all $CASES cases passed"
exit 0
