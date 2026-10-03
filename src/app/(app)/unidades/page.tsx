import Link from "next/link";
import { requirePermission } from "@/server/rbac/require-permission";
import {
  hasModule,
  requireModule,
} from "@/server/modules/tenancy/module.service";
import { withTenant } from "@/server/tenant/with-tenant";
import { listUnits } from "@/server/modules/unidades/warehouse.service";
import { TipoBadge } from "@/components/unidades/tipo-badge";

export default async function UnidadesPage() {
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

  const unidades = await withTenant(tenantId, async (tx) => {
    await requireModule(tx, tenantId, "MATRIZ_POSTOS");
    return listUnits(tx, tenantId);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Unidades</h1>
          <p className="mt-1 text-sm text-slate-500">
            Matriz, filiais e postos de coleta — hierarquia, responsáveis e
            acesso por usuário.
          </p>
        </div>
        <Link
          href="/unidades/nova"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Nova unidade
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Código
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Nome
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Tipo
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Unidade pai
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Responsável
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {unidades.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  Nenhuma unidade cadastrada.
                </td>
              </tr>
            )}
            {unidades.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                  {u.code}
                  {u.isDefault && (
                    <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                      padrão
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 font-medium text-slate-800">
                  {u.name}
                </td>
                <td className="px-4 py-2.5">
                  <TipoBadge type={u.type} />
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {u.parentName ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {u.managerName ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/unidades/${u.id}`}
                    className="rounded px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                  >
                    gerenciar
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
