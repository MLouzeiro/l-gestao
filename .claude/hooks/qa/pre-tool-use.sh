#!/bin/bash
# PreToolUse for QA/Test agents
# ONLY allows test execution commands — blocks everything else
source ".claude/hooks/lib/utils.sh"

tool=$(get_tool_name)

case "$tool" in
  "Read"|"Glob"|"Grep")
    allow
    ;;
  "Bash")
    cmd=$(get_bash_command)
    if command_contains_any "$cmd" "^(npx )?(jest|vitest|pytest)"; then
      allow
    fi
    block "QA agent can only execute test commands (jest/vitest/pytest). Command blocked: $cmd"
    ;;
  *)
    block "QA agent is read-only for non-test operations. Tool blocked: $tool"
    ;;
esac

allow
