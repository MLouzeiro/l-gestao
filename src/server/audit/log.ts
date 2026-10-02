import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { auditLogs } from "@/server/db/schema/auditoria";
import { auditDiff } from "@/server/modules/auditoria/audit-rules";
import type { TenantTx } from "@/server/tenant/with-tenant";

// Log de auditoria append-only (Fase 14). Toda mutação sensível chama audit()
// DENTRO da mesma transação da mutação: se o log falhar, a mutação inteira
// falha (consistência). tenant_id/user_id vêm do contexto do servidor
// (SET LOCAL via withTenant) — nunca do cliente.

export interface AuditEntry {
  action: string;
  module: string;
  entityType?: string | null;
  entityId?: string | null;
  // Snapshots opcionais do estado antes/depois — o helper grava apenas as
  // chaves que mudaram, já sanitizadas (sem senha/token/segredo).
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  result?: "SUCCESS" | "FAILURE";
  // Overrides opcionais (ex.: movimentação explícita de usuário/cron).
  // Default: contexto do servidor (SET LOCAL via withTenant).
  tenantId?: string;
  userId?: string | null;
}

interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

async function requestContext(): Promise<RequestContext> {
  try {
    const h = await headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      null;
    return { ip, userAgent: h.get("user-agent") };
  } catch {
    // Sem request scope (cron/job): contexto vazio.
    return { ip: null, userAgent: null };
  }
}

export async function audit(tx: TenantTx, entry: AuditEntry): Promise<void> {
  const ctx = await requestContext();
  const result = await tx.execute(sql`
    SELECT
      NULLIF(current_setting('app.current_tenant_id', true), '') AS tenant_id,
      NULLIF(current_setting('app.current_user_id', true), '') AS user_id
  `);
  const row = result.rows?.[0] as
    | { tenant_id?: string | null; user_id?: string | null }
    | undefined;
  const tenantId = entry.tenantId ?? row?.tenant_id ?? null;
  if (!tenantId) {
    throw new Error("audit: chamado fora do contexto de tenant");
  }
  const userId = entry.userId !== undefined ? entry.userId : (row?.user_id ?? null);
  const hasSnapshot =
    entry.before !== undefined || entry.after !== undefined;
  const diff = hasSnapshot
    ? auditDiff(entry.before ?? {}, entry.after ?? {})
    : { before: null, after: null };

  await tx.insert(auditLogs).values({
    tenantId,
    userId,
    action: entry.action,
    module: entry.module,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    result: entry.result ?? "SUCCESS",
    before: diff.before,
    after: diff.after,
  });
}
