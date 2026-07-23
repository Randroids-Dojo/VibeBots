#!/usr/bin/env bash
# Fixtures for the followup ledger current-priority validation (F-157/F-178).
# Each case writes a synthetic ledger, runs the check with explicit
# grandfather/known lists, saves the exit status first, then asserts output.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/check-followup-ledger.mjs"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/followup-ledger-selftest.XXXXXX")
CASES=0
FAILED=0

run_check() {
  # run_check <fixture-file> <out-file> [extra args...]
  local fixture="$1" out="$2"; shift 2
  node "$CHECK" --file "$fixture" "$@" > "$out" 2>&1
  CHECK_STATUS=$?
}

assert() {
  local name="$1" expected="$2" out="$3" needle="${4:-}"
  CASES=$((CASES + 1))
  local bad=""
  [ "$expected" = "zero" ] && [ "$CHECK_STATUS" -ne 0 ] && bad="expected 0, got $CHECK_STATUS"
  [ "$expected" = "nonzero" ] && [ "$CHECK_STATUS" -eq 0 ] && bad="expected nonzero, got 0"
  if [ -z "$bad" ] && [ -n "$needle" ] && ! grep -qF "$needle" "$out"; then
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

# Case 1: a fully valid ledger passes: correctly placed primaries old and
# new, one grandfathered mismatch and one recorded post-cutoff mismatch each
# covered by exactly one pointer under the authoritative bucket, an outside
# grandfathered primary with its pointer, and a valid successor edge.
cat > "$WORK/valid.html" <<'HTML'
<main>
<section id="blocks-release"><h2>B</h2>
  <section id="F-001" data-f="F-001" data-priority="blocks-release"><h3>ok</h3></section>
  <section id="F-002" data-f="F-002" data-priority="nice-to-have"><h3>grandfathered wrong bucket</h3>
    <dl><dt data-f-ref="F-002" data-f-successor="F-005">Correction</dt><dd>see F-005</dd></dl>
  </section>
  <section id="F-003" data-f="F-003" data-priority="polish"><h3>recorded post-cutoff</h3></section>
</section>
<section id="nice-to-have"><h2>N</h2>
  <p data-role="priority-pointer" data-f-ref="F-002"><a href="#F-002">F-002</a></p>
  <p data-role="priority-pointer" data-f-ref="F-006"><a href="#F-006">F-006</a></p>
  <section id="F-005" data-f="F-005" data-priority="nice-to-have"><h3>valid post-cutoff</h3></section>
</section>
<section id="polish"><h2>P</h2>
  <p data-role="priority-pointer" data-f-ref="F-003"><a href="#F-003">F-003</a></p>
</section>
<section id="F-006" data-f="F-006" data-priority="nice-to-have"><h3>outside, grandfathered</h3></section>
</main>
HTML
run_check "$WORK/valid.html" "$WORK/valid.out" --grandfathered F-002,F-006 --known F-003
assert valid zero "$WORK/valid.out" "followup ledger check passed"

# Case 2: a deliberately misplaced post-cutoff primary fails.
cat > "$WORK/postcutoff.html" <<'HTML'
<main>
<section id="blocks-release"><h2>B</h2>
  <section id="F-001" data-f="F-001" data-priority="polish"><h3>misplaced new entry</h3></section>
</section>
<section id="nice-to-have"><h2>N</h2></section>
<section id="polish"><h2>P</h2>
  <p data-role="priority-pointer" data-f-ref="F-001"><a href="#F-001">F-001</a></p>
</section>
</main>
HTML
run_check "$WORK/postcutoff.html" "$WORK/postcutoff.out"
assert postcutoff-misplaced nonzero "$WORK/postcutoff.out" "post-cutoff placement violation: F-001"

# Case 3: a grandfathered mismatch without a pointer fails coverage.
cat > "$WORK/uncovered.html" <<'HTML'
<main>
<section id="blocks-release"><h2>B</h2>
  <section id="F-001" data-f="F-001" data-priority="nice-to-have"><h3>uncovered</h3></section>
</section>
<section id="nice-to-have"><h2>N</h2></section>
<section id="polish"><h2>P</h2></section>
</main>
HTML
run_check "$WORK/uncovered.html" "$WORK/uncovered.out" --grandfathered F-001
assert uncovered-mismatch nonzero "$WORK/uncovered.out" "has no priority pointer"

# Case 4: a pointer carrying data-f or an id fails.
cat > "$WORK/badpointer.html" <<'HTML'
<main>
<section id="blocks-release"><h2>B</h2>
  <section id="F-001" data-f="F-001" data-priority="nice-to-have"><h3>x</h3></section>
</section>
<section id="nice-to-have"><h2>N</h2>
  <p data-role="priority-pointer" data-f="F-001" data-f-ref="F-001" id="ptr">bad</p>
</section>
<section id="polish"><h2>P</h2></section>
</main>
HTML
run_check "$WORK/badpointer.html" "$WORK/badpointer.out" --grandfathered F-001
assert pointer-identity nonzero "$WORK/badpointer.out" "carries data-f"

# Case 5: a pointer to a missing primary fails.
cat > "$WORK/dangling.html" <<'HTML'
<main>
<section id="blocks-release"><h2>B</h2></section>
<section id="nice-to-have"><h2>N</h2>
  <p data-role="priority-pointer" data-f-ref="F-099">dangling</p>
</section>
<section id="polish"><h2>P</h2></section>
</main>
HTML
run_check "$WORK/dangling.html" "$WORK/dangling.out"
assert dangling-pointer nonzero "$WORK/dangling.out" "targets missing or non-primary F-099"

# Case 6: a pointer under a bucket that disagrees with the target's
# data-priority fails.
cat > "$WORK/wrongbucket.html" <<'HTML'
<main>
<section id="blocks-release"><h2>B</h2>
  <section id="F-001" data-f="F-001" data-priority="nice-to-have"><h3>x</h3></section>
  <p data-role="priority-pointer" data-f-ref="F-001">wrong spot</p>
</section>
<section id="nice-to-have"><h2>N</h2></section>
<section id="polish"><h2>P</h2></section>
</main>
HTML
run_check "$WORK/wrongbucket.html" "$WORK/wrongbucket.out" --grandfathered F-001
assert pointer-wrong-bucket nonzero "$WORK/wrongbucket.out" "sits under blocks-release, target data-priority is nice-to-have"

# Case 7: duplicate primary identity fails.
cat > "$WORK/dupprimary.html" <<'HTML'
<main>
<section id="blocks-release"><h2>B</h2>
  <section id="F-001" data-f="F-001" data-priority="blocks-release"><h3>a</h3></section>
  <section id="F-001-again" data-f="F-001" data-priority="blocks-release"><h3>b</h3></section>
</section>
<section id="nice-to-have"><h2>N</h2></section>
<section id="polish"><h2>P</h2></section>
</main>
HTML
run_check "$WORK/dupprimary.html" "$WORK/dupprimary.out"
assert duplicate-primary nonzero "$WORK/dupprimary.out" 'duplicate primary data-f="F-001"'

# Case 8: duplicate document ids fail.
cat > "$WORK/dupid.html" <<'HTML'
<main>
<section id="blocks-release"><h2>B</h2>
  <section id="F-001" data-f="F-001" data-priority="blocks-release"><h3>a</h3></section>
  <section id="F-001" data-f="F-002" data-priority="blocks-release"><h3>b</h3></section>
</section>
<section id="nice-to-have"><h2>N</h2></section>
<section id="polish"><h2>P</h2></section>
</main>
HTML
run_check "$WORK/dupid.html" "$WORK/dupid.out"
assert duplicate-id nonzero "$WORK/dupid.out" 'duplicate document id "F-001"'

# Case 9: duplicate pointers for one target fail.
cat > "$WORK/dupptr.html" <<'HTML'
<main>
<section id="blocks-release"><h2>B</h2>
  <section id="F-001" data-f="F-001" data-priority="nice-to-have"><h3>x</h3></section>
</section>
<section id="nice-to-have"><h2>N</h2>
  <p data-role="priority-pointer" data-f-ref="F-001">one</p>
  <p data-role="priority-pointer" data-f-ref="F-001">two</p>
</section>
<section id="polish"><h2>P</h2></section>
</main>
HTML
run_check "$WORK/dupptr.html" "$WORK/dupptr.out" --grandfathered F-001
assert duplicate-pointer nonzero "$WORK/dupptr.out" "duplicate priority pointer for F-001"

# Case 10: a redundant pointer to a correctly placed primary fails.
cat > "$WORK/redundant.html" <<'HTML'
<main>
<section id="blocks-release"><h2>B</h2>
  <section id="F-001" data-f="F-001" data-priority="blocks-release"><h3>x</h3></section>
  <p data-role="priority-pointer" data-f-ref="F-001">redundant</p>
</section>
<section id="nice-to-have"><h2>N</h2></section>
<section id="polish"><h2>P</h2></section>
</main>
HTML
run_check "$WORK/redundant.html" "$WORK/redundant.out"
assert redundant-pointer nonzero "$WORK/redundant.out" "redundant priority pointer: F-001"

# Case 11: a non-primary section carrying data-f fails (closure records use
# data-f-ref).
cat > "$WORK/closure.html" <<'HTML'
<main>
<section id="blocks-release"><h2>B</h2>
  <section id="F-001" data-f="F-001" data-priority="blocks-release"><h3>x</h3></section>
  <section id="F-001-closure" data-f="F-001" data-role="closure"><h3>bad closure</h3></section>
</section>
<section id="nice-to-have"><h2>N</h2></section>
<section id="polish"><h2>P</h2></section>
</main>
HTML
run_check "$WORK/closure.html" "$WORK/closure.out"
assert closure-data-f nonzero "$WORK/closure.out" 'non-primary section with data-f="F-001"'

# Case 12: successor-edge misuse fails: self edge and a dangling target.
cat > "$WORK/successor.html" <<'HTML'
<main>
<section id="blocks-release"><h2>B</h2>
  <section id="F-001" data-f="F-001" data-priority="blocks-release"><h3>x</h3>
    <dl>
      <dt data-f-ref="F-001" data-f-successor="F-001">self</dt><dd>bad</dd>
      <dt data-f-ref="F-001" data-f-successor="F-404">dangling</dt><dd>bad</dd>
    </dl>
  </section>
</section>
<section id="nice-to-have"><h2>N</h2></section>
<section id="polish"><h2>P</h2></section>
</main>
HTML
run_check "$WORK/successor.html" "$WORK/successor.out"
assert successor-misuse nonzero "$WORK/successor.out" "self-referential successor edge F-001"
assert successor-dangling nonzero "$WORK/successor.out" "successor edge target F-404 is not a primary"

echo
if [ "$FAILED" -gt 0 ]; then
  echo "followup ledger selftest: $FAILED of $CASES cases FAILED"
  exit 1
fi
echo "followup ledger selftest: all $CASES cases passed"
exit 0
