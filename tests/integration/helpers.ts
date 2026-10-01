import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/server/db/client";
import { products, tenants, warehouses } from "@/server/db/schema";
import { provisionTenant } from "@/server/modules/tenancy/provision";
import { withTenant } from "@/server/tenant/with-tenant";

// Fixtures de integração: tenant real (provisionado) + produto.
// Cada teste cria o seu tenant → isolamento automático entre testes.

// Encerra o pool ao fim da suíte (senão o Jest não sai — handle aberto)
afterAll(async () => {
  try {
    await pool.end();
  } catch {
    // pool já encerrado
  }
});

export async function createTestTenant(): Promise<{
  tenantId: string;
  warehouseId: string;
}> {
  const slug = `t-${randomUUID().slice(0, 12)}`;
  const [t] = await db
    .insert(tenants)
    .values({ name: `Tenant ${slug}`, slug, segment: "COMERCIO_GERAL" })
    .returning({ id: tenants.id });

  await provisionTenant(t.id);

  const warehouseId = await withTenant(t.id, async (tx) => {
    const [w] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(eq(warehouses.tenantId, t.id))
      .limit(1);
    if (!w) throw new Error("provision não criou o depósito padrão");
    return w.id;
  });

  return { tenantId: t.id, warehouseId };
}

export async function createTestProduct(
  tenantId: string,
  opts?: { trackBatch?: boolean; salePrice?: string },
): Promise<{ productId: string; sku: string }> {
  const sku = `SKU-${randomUUID().slice(0, 10).toUpperCase()}`;
  const productId = await withTenant(tenantId, async (tx) => {
    const [p] = await tx
      .insert(products)
      .values({
        tenantId,
        sku,
        name: "Produto Teste",
        salePrice: opts?.salePrice ?? "20.00",
        trackBatch: opts?.trackBatch ?? false,
      })
      .returning({ id: products.id });
    return p.id;
  });
  return { productId, sku };
}
