import { and, eq, isNull } from "drizzle-orm";
import {
  customers,
  members,
  products,
  users,
  warehouses,
} from "@/server/db/schema";
import { toCents } from "@/lib/money";
import type { TenantTx } from "@/server/tenant/with-tenant";

// Dados das caixas de seleção do formulário de venda (depósitos, produtos,
// clientes e vendedores) — usado nas telas nova e editar.

export type SaleFormOption = { id: string; name: string };
export type SaleFormProduct = {
  id: string;
  sku: string;
  name: string;
  salePriceCents: number;
};
export type SaleFormSeller = { userId: string; name: string; email: string };

export type SaleFormData = {
  depositos: SaleFormOption[];
  produtos: SaleFormProduct[];
  clientes: SaleFormOption[];
  vendedores: SaleFormSeller[];
};

export async function loadSaleFormData(
  tx: TenantTx,
  tenantId: string,
): Promise<SaleFormData> {
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
      salePrice: products.salePrice,
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

  const clientes = await tx
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), isNull(customers.deletedAt)))
    .orderBy(customers.name)
    .limit(300);

  const vendedores = await tx
    .select({ userId: members.userId, name: users.name, email: users.email })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.organizationId, tenantId))
    .orderBy(users.name);

  return {
    depositos,
    produtos: produtos.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      salePriceCents: toCents(p.salePrice),
    })),
    clientes,
    vendedores,
  };
}
