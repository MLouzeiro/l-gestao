#!/bin/bash
# PreToolUse for Backend agents
# Blocks: frontend file edits, git/vercel commands, prisma studio
source ".claude/hooks/lib/utils.sh"

tool=$(get_tool_name)

if is_write_tool; then
  fp=$(get_file_path)
  if file_matches_any "$fp" \
    "src/components/*" \
    "src/app/board/*" \
    "src/app/dashboard/*" \
    "src/app/vendedores/*" \
    "src/app/login/*"
  then
    block "Backend agent cannot modify frontend files: $fp"
  fi
fi

if is_bash_tool; then
  cmd=$(get_bash_command)
  if command_contains_any "$cmd" \
    "git push" \
    "vercel deploy" \
    "npm run dev" \
    "prisma studio"
  then
    block "Backend agent cannot run this command: $cmd"
  fi
fi

allow
