#!/usr/bin/env bash
# Fixtures for the AI-attribution preflight (F-211). Builds a throwaway git
# repository with clean and dirty commit messages, plus message-file cases,
# and saves each exit status before asserting on output.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/check-attribution.sh"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/attribution-selftest.XXXXXX") || exit 2
trap 'rm -rf "$WORK"' EXIT
CASES=0
FAILED=0

R="$WORK/repo"
mkdir -p "$R"
git -C "$R" init -q
git -C "$R" -c user.name="Randy Lutcavich" -c user.email="randy@example.com" \
  commit -q --allow-empty -m "Initial commit"
git -C "$R" branch -M main
git -C "$R" checkout -q -b feature

commit_msg() {
  git -C "$R" -c user.name="Randy Lutcavich" -c user.email="randy@example.com" \
    commit -q --allow-empty -F -
}

run_range() {
  local out="$1"
  (cd "$R" && bash "$CHECK" main HEAD) > "$out" 2>&1
  CHECK_STATUS=$?
}

assert() {
  local name="$1" expected="$2" out="$3" needle="${4:-}"
  CASES=$((CASES + 1))
  local bad=""
  [ "$expected" = "zero" ] && [ "$CHECK_STATUS" -ne 0 ] && bad="expected 0, got $CHECK_STATUS"
  [ "$expected" = "nonzero" ] && [ "$CHECK_STATUS" -eq 0 ] && bad="expected nonzero, got 0"
  if [ -z "$bad" ] && [ -n "$needle" ] && ! grep -qiF "$needle" "$out"; then
    bad="output missing: $needle"
  fi
  if [ -n "$bad" ]; then
    FAILED=$((FAILED + 1))
    echo "SELFTEST FAIL: $name: $bad"
    echo "--- captured output:"; cat "$out"; echo "---"
  else
    echo "selftest ok: $name"
  fi
}

# Case 1: ordinary human metadata stays green, including a human co-author
# trailer and gameplay AI wording.
commit_msg <<'MSG'
Tune bot AI aggression in the arena

The combat AI now retreats at low energy. Thanks to playtest feedback.

Co-authored-by: Alex Doe <alex@example.com>
MSG
run_range "$WORK/clean.out"
assert clean-human zero "$WORK/clean.out" "attribution: clean"

# Case 2: a Claude co-author trailer fails, case-insensitively.
commit_msg <<'MSG'
Fix leaderboard pagination

Co-Authored-By: CLAUDE <noreply@anthropic.com>
MSG
run_range "$WORK/coauthor.out"
assert coauthor-trailer nonzero "$WORK/coauthor.out" "ATTRIBUTION in commit"
git -C "$R" reset -q --hard HEAD~1

# Case 3: a generated-with footer fails.
commit_msg <<'MSG'
Polish the workshop camera

Generated with Claude Code
MSG
run_range "$WORK/footer.out"
assert generated-footer nonzero "$WORK/footer.out" "ATTRIBUTION in commit"
git -C "$R" reset -q --hard HEAD~1

# Case 4: the robot-emoji footer variant fails.
commit_msg <<'MSG'
Adjust elevator speed

🤖 helped here
MSG
run_range "$WORK/emoji.out"
assert emoji-footer nonzero "$WORK/emoji.out" "ATTRIBUTION in commit"
git -C "$R" reset -q --hard HEAD~1

# Case 5: a dirty squash message file fails in --message-file mode.
cat > "$WORK/squash-dirty.txt" <<'MSG'
Ship the mining overhaul (#300)

Implemented by AI with human review.
MSG
bash "$CHECK" --message-file "$WORK/squash-dirty.txt" > "$WORK/squash-dirty.out" 2>&1
CHECK_STATUS=$?
assert squash-dirty nonzero "$WORK/squash-dirty.out" "ATTRIBUTION in message file"

# Case 6: a clean squash message file passes.
cat > "$WORK/squash-clean.txt" <<'MSG'
Ship the mining overhaul (#300)

Streams tunnel floors through the instanced grid and caps GC churn.
MSG
bash "$CHECK" --message-file "$WORK/squash-clean.txt" > "$WORK/squash-clean.out" 2>&1
CHECK_STATUS=$?
assert squash-clean zero "$WORK/squash-clean.out" "attribution: clean"

# Case 7: the zero-argument default range (origin/main..HEAD) works and is
# clean for a clean branch commit.
git -C "$R" update-ref refs/remotes/origin/main main
(cd "$R" && bash "$CHECK") > "$WORK/default-range.out" 2>&1
CHECK_STATUS=$?
assert default-range zero "$WORK/default-range.out" "attribution: clean"

# Case 8: published-commit mode flags a dirty merge commit.
git -C "$R" checkout -q main
git -C "$R" -c user.name="Randy Lutcavich" -c user.email="randy@example.com" \
  commit -q --allow-empty -m "Add spike hazards (#301)" -m "Co-authored-by: Claude <noreply@anthropic.com>"
SHA=$(git -C "$R" rev-parse HEAD)
(cd "$R" && bash "$CHECK" --commit "$SHA") > "$WORK/published.out" 2>&1
CHECK_STATUS=$?
assert published-commit nonzero "$WORK/published.out" "ATTRIBUTION in commit"

echo
if [ "$FAILED" -gt 0 ]; then
  echo "attribution selftest: $FAILED of $CASES cases FAILED"
  exit 1
fi
echo "attribution selftest: all $CASES cases passed"
exit 0
