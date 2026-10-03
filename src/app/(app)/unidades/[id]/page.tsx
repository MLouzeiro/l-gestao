import { notFound } from "next/navigation";
import { requirePermission } from "@/server/rbac/require-permission";
import {
  hasModule,
  requireModule,
} from "@/server/modules/tenancy/module.service";
import { withTenant } from "@/server/tenant/with-tenant";
import {
  getUnitDetail,
  loadUnitFormData,
} from "@/server/modules/unidades/warehouse.service";
import { UnidadeForm } from "@/components/unidades/unidade-form";
import { MembrosForm } from "@/components/unidades/membros-form";
import { AlvoForm } from "@/components/unidades/alvo-form";
import { TipoBadge } from "@/components/unidades/tipo-badge";
import { db } from "@/server/db/client";
import { products } from "@/server/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export default async function UnidadeDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requirePermission("units.view");

  const ativo = await withTenant(tenantId, (tx) =>
    hasModule(tx, tenantId, "MATRIZ_POSTOS"),
  );
  if (!ativo) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        Módulo <strong>Matriz e Postos</strong> não está contratado para esta
        empresa. Contrate em Administração → Módulos.
      </div>
    );
  }

  const data = await withTenant(tenantId, async (tx) => {
    await requireModule(tx, tenantId, "MATRIZ_POSTOS");
    const [detail, formData] = await Promise.all([
      getUnitDetail(tx, tenantId, id),
      loadUnitFormData(tx, tenantId),
    ]);
    return { detail, formData };
  });

  if (!data.detail) notFound();
  const { detail, formData } = data;

  const produtos = await db
    .select({ id: products.id, name: products.name, sku: products.sku })
    .from(products)
    .where(
      and(eq(products.tenantId, tenantId), isNull(products.deletedAt)),
    )
    .orderBy(products.name)
    .limit(500);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            {detail.name} <TipoBadge type={detail.type} />
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Código <span className="font-mono">{detail.code}</span>
            {detail.isDefault && " · unidade padrão"}
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">
          Dados da unidade
        </h2>
        <UnidadeForm
          unidades={formData.units}
          responsaveis={formData.managers}
          initial={{
            unitId: detail.id,
            code: detail.code,
            name: detail.name,
            type: detail.type,
            parentId: detail.parentId,
            managerUserId: detail.managerUserId,
          }}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">
          Acesso de usuários
        </h2>
        <MembrosForm unitId={detail.id} membros={detail.members} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">
          Estoque-alvo por produto
        </h2>
        <AlvoForm
          unitId={detail.id}
          produtos={produtos}
          alvos={detail.targets}
        />
      </section>
    </div>
  );
}
