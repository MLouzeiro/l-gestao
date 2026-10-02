import { and, eq, isNull } from "drizzle-orm";
import { products, suppliers, warehouses } from "@/server/db/schema";
import type { TenantTx } from "@/server/tenant/with-tenant";

// Dados das caixas de seleção do formulário de compra (fornecedores,
// depósitos e produtos com flag de lote).

export type PurchaseFormOption = { id: string; name: string };
export type PurchaseFormProduct = {
  id: string;
  sku: string;
  name: string;
  trackBatch: boolean;
};

export type PurchaseFormData = {
  fornecedores: PurchaseFormOption[];
  depositos: PurchaseFormOption[];
  produtos: PurchaseFormProduct[];
};

export async function loadPurchaseFormData(
  tx: TenantTx,
  tenantId: string,
): Promise<PurchaseFormData> {
  const fornecedores = await tx
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt)))
    .orderBy(suppliers.name)
    .limit(300);

  const depositos = await tx
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .where(and(eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)))
    .orderBy(warehouses.name);

  const produtos = await tx
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      trackBatch: products.trackBatch,
    })
    .from(products)
    .where(
      and(
        eq(products.tenantId, tenantId),
        eq(products.status, "ACTIVE"),
        isNull(products.deletedAt),
      ),
    )
    .orderBy(products.name)
    .limit(500);

  return { fornecedores, depositos, produtos };
}
