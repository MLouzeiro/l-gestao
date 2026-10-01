#!/bin/bash
# PostToolUse for Infra agent
# Validates Prisma schema after changes
source ".claude/hooks/lib/utils.sh"

if is_write_tool; then
  fp=$(get_file_path)
  if file_matches_any "$fp" "prisma/*"; then
    echo "[HOOK] Prisma file changed — validating schema..." >&2
    if ! npx prisma validate 2>&1; then
      echo "[HOOK] Prisma schema validation failed!" >&2
      exit 2
    fi
    echo "[HOOK] Prisma schema valid" >&2
  fi
fi

allow
