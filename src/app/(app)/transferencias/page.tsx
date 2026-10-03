import Link from "next/link";
import { requirePermission } from "@/server/rbac/require-permission";
import {
  hasModule,
  requireModule,
} from "@/server/modules/tenancy/module.service";
import { withTenant } from "@/server/tenant/with-tenant";
import { listTransfers } from "@/server/modules/transferencias/transfer.service";
import { StatusTransferenciaBadge } from "@/components/transferencias/status-transferencia-badge";
import { formatDateTime } from "@/lib/dates";

export default async function TransferenciasPage() {
  const { tenantId } = await requirePermission("stock.transfer");

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

  const transferencias = await withTenant(tenantId, async (tx) => {
    await requireModule(tx, tenantId, "TRANSFERENCIAS");
    return listTransfers(tx, tenantId);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Transferências
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Envio de material entre unidades — fluxo simples ou com envio e
            recebimento.
          </p>
        </div>
        <Link
          href="/transferencias/nova"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Nova transferência
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Número
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Origem → Destino
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Status
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Modo
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">
                Itens
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Criada em
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {transferencias.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  Nenhuma transferência registrada.
                </td>
              </tr>
            )}
            {transferencias.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                  {t.transferNumber}
                </td>
                <td className="px-4 py-2.5 text-slate-800">
                  {t.fromWarehouseName}{" "}
                  <span className="text-slate-400">→</span>{" "}
                  {t.toWarehouseName}
                </td>
                <td className="px-4 py-2.5">
                  <StatusTransferenciaBadge status={t.status} />
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-600">
                  {t.settleOn === "SEND" ? "baixa no envio" : "baixa no recebimento"}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-600">
                  {t.itemCount}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {formatDateTime(t.createdAt)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/transferencias/${t.id}`}
                    className="rounded px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                  >
                    abrir
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
