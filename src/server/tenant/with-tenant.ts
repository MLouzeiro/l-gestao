import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

// ⭐ Contexto de tenant para a RLS: SET LOCAL app.current_tenant_id roda
// SEMPRE dentro de transação (senão vaza para a próxima conexão do pool).
// Opcional para tabelas sem RLS (auth/members), mas recomendado para
// qualquer leitura que dependa do contexto da empresa.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error("withTenant: tenant_id inválido");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL app.current_tenant_id = '${tenantId}'`));
    return fn(tx);
  });
}
