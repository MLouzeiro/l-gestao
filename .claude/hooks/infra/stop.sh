#!/bin/bash
# Stop hook for Infra agent
# Verifies Prisma schema + TypeScript compile before finishing
source ".claude/hooks/lib/utils.sh"

echo "[HOOK] Validating Prisma schema..." >&2
if ! npx prisma validate 2>&1; then
  echo "[HOOK] Prisma schema invalid — fix before finishing." >&2
  exit 2
fi

echo "[HOOK] Checking TypeScript compilation..." >&2
if ! npx tsc --noEmit 2>&1; then
  echo "[HOOK] TypeScript errors found — fix before finishing." >&2
  exit 2
fi

allow
