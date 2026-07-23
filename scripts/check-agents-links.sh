#!/usr/bin/env bash
# AGENTS.md symlink audit (F-188).
#
# Every tracked AGENTS.md symlink must resolve, from its own directory, to
# the intended checked-in rule under .claude/rules/. Fails on missing or
# wrong-depth targets (the link does not resolve), outside-repository
# targets, and wrong-rule targets. Handles paths containing spaces and
# parentheses. Dependency-free: bash, git, and coreutils only.
#
# Usage: bash scripts/check-agents-links.sh [repo-root]
# The optional repo-root argument exists for the selftest fixtures.
set -u

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT" || exit 2
ROOT="$(pwd -P)"

fail=0
found=""

expected_rule() {
  case "$1" in
    docs/gdd/AGENTS.md) echo "gdd-build-log.md" ;;
    docs/AGENTS.md)     echo "ledger-append-only.md" ;;
    *)                  echo "slice-discipline.md" ;;
  esac
}

# Enumerate tracked AGENTS.md entries NUL-delimited so spaces and
# parentheses in paths survive. git ls-files -s lines: "mode hash stage\tpath".
while IFS= read -r -d '' entry; do
  mode="${entry%% *}"
  path="${entry#*$'\t'}"
  case "$path" in
    AGENTS.md|*/AGENTS.md) ;;
    *) continue ;;
  esac
  if [ "$mode" != "120000" ]; then
    # The repository-root AGENTS.md is a regular file by design.
    continue
  fi
  found="$found$path"$'\n'
  expected="$ROOT/.claude/rules/$(expected_rule "$path")"
  literal=$(readlink "$path")
  resolved=$(realpath -e "$path" 2>/dev/null)
  if [ -z "$resolved" ]; then
    echo "BROKEN: $path -> $literal (missing target or wrong ../ depth)"
    fail=1
  elif [ "${resolved#"$ROOT"/}" = "$resolved" ]; then
    echo "OUTSIDE REPOSITORY: $path -> $literal (resolves to $resolved)"
    fail=1
  elif [ "$resolved" != "$expected" ]; then
    echo "WRONG RULE: $path -> $literal (resolves to $resolved, expected $expected)"
    fail=1
  fi
done < <(git ls-files -s -z)

# Root-walk coverage: these directories must keep their tracked rule links
# so Codex's root-down walk sees the right rule inside each tree.
for want in src/AGENTS.md tests/AGENTS.md docs/AGENTS.md docs/gdd/AGENTS.md; do
  dir="${want%/AGENTS.md}"
  if [ -d "$dir" ]; then
    case "$found" in
      *"$want"$'\n'*) ;;
      *)
        echo "MISSING LINK: $dir exists but $want is not a tracked symlink"
        fail=1
        ;;
    esac
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "AGENTS link audit failed. Fix with: ln -sfn <../ per depth>.claude/rules/<rule>.md <dir>/AGENTS.md"
fi
exit "$fail"
