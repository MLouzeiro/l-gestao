import { requirePermission } from "@/server/rbac/require-permission";
import {
  hasModule,
  requireModule,
} from "@/server/modules/tenancy/module.service";
import { withTenant } from "@/server/tenant/with-tenant";
import { accessibleWarehouseIds } from "@/server/modules/unidades/warehouse.service";
import { TransferenciaForm } from "@/components/transferencias/transferencia-form";
import { db } from "@/server/db/client";
import { products, warehouses } from "@/server/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";

export default async function NovaTransferenciaPage() {
  const { session, tenantId, role } = await requirePermission(
    "stock.transfer",
  );

  const ativo = await withTenant(tenantId, (tx) =>
    hasModule(tx, tenantId, "TRANSFERENCIAS"),
  );
  if (!ativo) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        Módulo <strong>Transferências</strong> não está contratado para esta
        empresa. Contrate em Administração → Módulos.
      </div>
    );
  }

  const allowed = await withTenant(tenantId, (tx) => {
    void requireModule(tx, tenantId, "TRANSFERENCIAS");
    return accessibleWarehouseIds(tx, tenantId, session.user.id, role);
  });

  const depositos = await db
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.tenantId, tenantId),
        isNull(warehouses.deletedAt),
        allowed ? inArray(warehouses.id, allowed) : undefined,
      ),
    )
    .orderBy(warehouses.name);

  const produtos = await db
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Nova transferência
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Mova material entre unidades. Marque "executar agora" para o fluxo
          simples (saída + entrada imediatas).
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <TransferenciaForm depositos={depositos} produtos={produtos} />
      </div>
    </div>
  );
}
