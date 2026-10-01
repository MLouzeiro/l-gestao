import { and, eq } from "drizzle-orm";
import { counters } from "@/server/db/schema";
import type { TenantTx } from "@/server/tenant/with-tenant";

// Numeração sequencial por tenant (vendas, compras, financeiro...).
// SELECT ... FOR UPDATE + UPDATE na MESMA transação → sem duplicidade sob
// concorrência. Chave livre (ex.: "sale", "purchase", "receivable").

export class CounterError extends Error {}

export async function nextCounter(
  tx: TenantTx,
  tenantId: string,
  key: string,
): Promise<number> {
  await tx
    .insert(counters)
    .values({ tenantId, key, nextValue: 1 })
    .onConflictDoNothing();

  const [row] = await tx
    .select({ nextValue: counters.nextValue })
    .from(counters)
    .where(and(eq(counters.tenantId, tenantId), eq(counters.key, key)))
    .for("update")
    .limit(1);
  if (!row) throw new CounterError(`Contador "${key}" não encontrado.`);

  const current = row.nextValue;
  await tx
    .update(counters)
    .set({ nextValue: current + 1, updatedAt: new Date() })
    .where(and(eq(counters.tenantId, tenantId), eq(counters.key, key)));

  return current;
}
