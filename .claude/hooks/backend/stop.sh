#!/bin/bash
# Stop hook for Backend agents
# Verifies all tests pass before agent finishes
source ".claude/hooks/lib/utils.sh"

echo "[HOOK] Verifying tests before finishing..." >&2
if ! run_all_tests; then
  echo "[HOOK] FINAL CHECK FAILED: Tests must pass before the agent is done." >&2
  exit 2
fi

allow
