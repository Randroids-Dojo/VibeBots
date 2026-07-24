#!/usr/bin/env bash
# Canonical local verifier (F-189).
#
# Runs every required local gate as a direct subprocess, records each gate's
# own exit status BEFORE any output summarization, and fails closed when a
# promised gate cannot execute. Never pipe a gate through head/tail/grep or
# any formatter whose successful exit could mask the gate's failure; this
# script exists because that pattern repeatedly produced false green claims
# (see docs/FOLLOWUPS.html#F-189).
#
# Usage:
#   bash scripts/verify-local.sh            # dash, diff, purity, links, lint, typecheck, tests
#   bash scripts/verify-local.sh --build    # also run the production build gate
#   VERIFY_TEST_ARGS="src/sim" bash scripts/verify-local.sh   # focus vitest
#
# Fixture mode (selftest only): VERIFY_GATES_FILE points at a file with
# "name|command" lines; those replace the real gates. Commands run under
# bash -o pipefail so a failing producer inside a gate pipeline still fails
# the gate.
set -u

cd "$(dirname "$0")/.." || exit 1

RUN_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --build) RUN_BUILD=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

LOG_DIR=$(mktemp -d "${TMPDIR:-/tmp}/verify-local.XXXXXX") || {
  echo "cannot create the log directory" >&2
  exit 2
}
DIAG_LINES=40

GATE_NAMES=()
GATE_RESULTS=()   # pass | fail | notrun
GATE_DETAILS=()   # exit code / signal / reason text
FIRST_FAILED_NAME=""
FIRST_FAILED_LOG=""

record() {
  local name="$1" result="$2" detail="$3" log="$4"
  GATE_NAMES+=("$name")
  GATE_RESULTS+=("$result")
  GATE_DETAILS+=("$detail")
  case "$result" in
    pass)
      echo "[PASS]    $name"
      ;;
    fail)
      echo "[FAIL]    $name ($detail)"
      ;;
    notrun)
      echo "[NOT-RUN] $name ($detail)"
      ;;
  esac
  if [ "$result" != "pass" ] && [ -z "$FIRST_FAILED_NAME" ]; then
    FIRST_FAILED_NAME="$name"
    FIRST_FAILED_LOG="$log"
  fi
}

# Run one gate. The command's stdout+stderr go straight to a per-gate log
# file (no pipeline), the exit status is saved immediately, and only then is
# anything summarized.
run_gate() {
  local name="$1"; shift
  # Display names come from fixture files in selftest mode; keep the log
  # filename to a safe character set so a hostile name cannot escape LOG_DIR.
  local safe_name="${name//[^A-Za-z0-9._-]/_}"
  local log="$LOG_DIR/$safe_name.log"
  "$@" >"$log" 2>&1
  local status=$?
  if [ "$status" -eq 0 ]; then
    record "$name" pass "exit 0" "$log"
  elif [ "$status" -eq 127 ] || [ "$status" -eq 126 ]; then
    record "$name" notrun "exit $status: command missing or not executable; the gate did not run" "$log"
  elif [ "$status" -gt 128 ]; then
    local signame
    signame=$(kill -l $((status - 128)) 2>/dev/null)
    record "$name" fail "killed by signal ${signame:-$((status - 128))}, exit $status" "$log"
  else
    record "$name" fail "exit $status" "$log"
  fi
}

skip_gate() {
  local name="$1" reason="$2"
  # Write the reason to a per-gate log so first-failure diagnostics stay
  # consistent with executed gates.
  local safe_name="${name//[^A-Za-z0-9._-]/_}"
  local log="$LOG_DIR/$safe_name.log"
  printf 'NOT-RUN: %s\n' "$reason" > "$log"
  record "$name" notrun "$reason" "$log"
}

if [ -n "${VERIFY_GATES_FILE:-}" ]; then
  # Fixture mode: gates come from the file, one "name|command" per line.
  while IFS='|' read -r fname fcmd; do
    [ -z "$fname" ] && continue
    run_gate "$fname" bash -o pipefail -c "$fcmd"
  done < "$VERIFY_GATES_FILE"
else
  run_gate dashes bash scripts/check-dashes.sh
  run_gate git-diff-check bash -o pipefail -c 'git diff --check && git diff --cached --check'
  run_gate sim-purity bash scripts/check-sim-purity.sh
  if [ -f scripts/check-agents-links.sh ]; then
    run_gate agents-links bash scripts/check-agents-links.sh
  else
    skip_gate agents-links "scripts/check-agents-links.sh missing from this checkout"
  fi
  if [ ! -f scripts/check-attribution.sh ]; then
    skip_gate attribution "scripts/check-attribution.sh missing from this checkout"
  elif git rev-parse -q --verify origin/main >/dev/null 2>&1; then
    run_gate attribution bash scripts/check-attribution.sh
  else
    skip_gate attribution "origin/main ref unavailable; fetch origin before verifying"
  fi
  if [ -f scripts/check-followup-ledger.mjs ]; then
    run_gate followup-ledger node scripts/check-followup-ledger.mjs
  else
    skip_gate followup-ledger "scripts/check-followup-ledger.mjs missing from this checkout"
  fi

  # Gates below need installed dependencies. A missing toolchain is a failed
  # verification, not a silent skip: report NOT-RUN and exit nonzero. Check
  # the actual tool binaries; a partial install can leave node_modules
  # present with the tools absent (the F-217 remote-session state).
  NEED_INSTALL_REASON="toolchain not installed; run pnpm install --frozen-lockfile first (remote sessions: see FOLLOWUPS F-217)"
  if [ -x node_modules/.bin/biome ]; then
    run_gate lint pnpm run lint
  else
    skip_gate lint "$NEED_INSTALL_REASON"
  fi
  if [ -x node_modules/.bin/next ] && [ -x node_modules/.bin/tsc ]; then
    run_gate typecheck pnpm run typecheck
  else
    skip_gate typecheck "$NEED_INSTALL_REASON"
  fi
  if [ -x node_modules/.bin/vitest ]; then
    if [ -n "${VERIFY_TEST_ARGS:-}" ]; then
      # shellcheck disable=SC2086
      run_gate unit-tests pnpm exec vitest run ${VERIFY_TEST_ARGS}
    else
      run_gate unit-tests pnpm run test
    fi
  else
    skip_gate unit-tests "$NEED_INSTALL_REASON"
  fi
  if [ "$RUN_BUILD" -eq 1 ]; then
    if [ -x node_modules/.bin/next ]; then
      run_gate build pnpm run build
    else
      skip_gate build "$NEED_INSTALL_REASON"
    fi
  fi
fi

echo
echo "verify-local summary (logs: $LOG_DIR)"
FAILURES=0
for i in "${!GATE_NAMES[@]}"; do
  if [ "${GATE_RESULTS[$i]}" != "pass" ]; then
    FAILURES=$((FAILURES + 1))
    echo "  ${GATE_RESULTS[$i]}: ${GATE_NAMES[$i]} (${GATE_DETAILS[$i]})"
  fi
done

if [ "$FAILURES" -eq 0 ]; then
  echo "  all ${#GATE_NAMES[@]} gates passed"
  exit 0
fi

echo
echo "First failure: $FIRST_FAILED_NAME"
if [ -n "$FIRST_FAILED_LOG" ] && [ -s "$FIRST_FAILED_LOG" ]; then
  echo "Last $DIAG_LINES lines of $FIRST_FAILED_LOG:"
  tail -n "$DIAG_LINES" "$FIRST_FAILED_LOG"
elif [ -n "$FIRST_FAILED_LOG" ]; then
  echo "(gate produced no output)"
else
  echo "(gate never executed)"
fi
exit 1
