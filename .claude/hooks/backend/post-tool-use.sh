#!/bin/bash
# PostToolUse for Backend agents
# Runs tests after every Write/Edit
source ".claude/hooks/lib/utils.sh"

if is_write_tool; then
  fp=$(get_file_path)
  echo "[HOOK] File modified: $fp — running tests" >&2
  if ! run_all_tests; then
    echo "[HOOK] Warning: tests failed after editing $fp. Fix before proceeding." >&2
  fi
fi

allow
