#!/bin/bash
# PreToolUse for Frontend agents
# Blocks: API route edits, prisma schema changes, git/vercel commands
source ".claude/hooks/lib/utils.sh"

if is_write_tool; then
  fp=$(get_file_path)
  if file_matches_any "$fp" \
    "src/app/api/*" \
    "prisma/*" \
    ".env*"
  then
    block "Frontend agent cannot modify backend files: $fp"
  fi
fi

if is_bash_tool; then
  cmd=$(get_bash_command)
  if command_contains_any "$cmd" \
    "git push" \
    "vercel deploy" \
    "npx prisma migrate" \
    "prisma studio"
  then
    block "Frontend agent cannot run this command: $cmd"
  fi
fi

allow
