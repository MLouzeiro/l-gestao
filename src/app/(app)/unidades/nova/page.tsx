import { requirePermission } from "@/server/rbac/require-permission";
import {
  hasModule,
  requireModule,
} from "@/server/modules/tenancy/module.service";
import { withTenant } from "@/server/tenant/with-tenant";
import {
  listTenantUsers,
  listUnits,
  loadUnitFormData,
} from "@/server/modules/unidades/warehouse.service";
import { UnidadeForm } from "@/components/unidades/unidade-form";

export default async function NovaUnidadePage() {
  const { tenantId } = await requirePermission("units.manage");

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
    return loadUnitFormData(tx, tenantId);
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Nova unidade</h1>
        <p className="mt-1 text-sm text-slate-500">
          Cadastre uma matriz, filial ou posto de coleta.
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <UnidadeForm
          unidades={data.units}
          responsaveis={data.managers}
          initial={{
            unitId: null,
            code: "",
            name: "",
            type: "FILIAL",
            parentId: null,
            managerUserId: null,
          }}
        />
      </div>
    </div>
  );
}
