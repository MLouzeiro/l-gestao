import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

// ⭐ Contexto de tenant para a RLS: SET LOCAL app.current_tenant_id roda
// SEMPRE dentro de transação (senão vaza para a próxima conexão do pool).
// O userId (opcional) vira app.current_user_id — usado pela auditoria para
// saber QUEM executou a mutação (nunca vem do cliente, sempre da sessão).

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withTenant<T>(
  tenantId: string,
  userId: string | null | undefined,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T>;
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T>;
export async function withTenant<T>(
  tenantId: string,
  userIdOrFn: string | null | undefined | ((tx: TenantTx) => Promise<T>),
  fnMaybe?: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const fn = typeof userIdOrFn === "function" ? userIdOrFn : fnMaybe!;
  const userId = typeof userIdOrFn === "function" ? null : userIdOrFn;
  if (!UUID_RE.test(tenantId)) {
    throw new Error("withTenant: tenant_id inválido");
  }
  if (userId !== null && userId !== undefined && !UUID_RE.test(userId)) {
    throw new Error("withTenant: user_id inválido");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL app.current_tenant_id = '${tenantId}'`));
    if (userId) {
      await tx.execute(sql.raw(`SET LOCAL app.current_user_id = '${userId}'`));
    }
    return fn(tx);
  });
}
