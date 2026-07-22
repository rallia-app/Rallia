#!/usr/bin/env bash
# Run every SQL test in supabase/tests/ against a Postgres database.
#
# Each file is a self-contained transaction (BEGIN ... ROLLBACK) that ASSERTs
# its expectations; -v ON_ERROR_STOP=1 turns a failed ASSERT into a non-zero
# psql exit. This runner globs the directory, so a new *_test.sql file is picked
# up automatically — no per-file wiring, no orphans.
#
# Usage:
#   scripts/dev/db-test.sh                 # local db (default URL below)
#   scripts/dev/db-test.sh "$STAGING_DB_URL"
#   DB_TEST_FILTER=paid scripts/dev/db-test.sh   # only files matching a substring
#
# Exit code is non-zero if any file fails, so it can gate CI.

set -uo pipefail

DB_URL="${1:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
FILTER="${DB_TEST_FILTER:-}"
TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/supabase/tests"

shopt -s nullglob
files=("$TESTS_DIR"/*_test.sql)
shopt -u nullglob

if [ ${#files[@]} -eq 0 ]; then
  echo "no *_test.sql files found in $TESTS_DIR" >&2
  exit 1
fi

pass=0
fail=0
failed_files=()

for f in "${files[@]}"; do
  name="$(basename "$f")"
  if [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]]; then
    continue
  fi
  # Capture output so a passing run stays quiet and a failure shows the ERROR.
  out="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1)"
  if [ $? -eq 0 ]; then
    printf '  \033[32mPASS\033[0m  %s\n' "$name"
    pass=$((pass + 1))
  else
    printf '  \033[31mFAIL\033[0m  %s\n' "$name"
    echo "$out" | grep -iE 'ERROR|ASSERT' | sed 's/^/         /'
    fail=$((fail + 1))
    failed_files+=("$name")
  fi
done

echo
echo "  $pass passed, $fail failed"
if [ $fail -gt 0 ]; then
  printf '  failed: %s\n' "${failed_files[*]}"
  exit 1
fi
