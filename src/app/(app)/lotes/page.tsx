import Link from "next/link";
import { requirePermission } from "@/server/rbac/require-permission";
import { resolvePermissions } from "@/server/rbac/permissions";
import {
  hasModule,
  requireModule,
} from "@/server/modules/tenancy/module.service";
import { withTenant } from "@/server/tenant/with-tenant";
import {
  getAlertSettings,
  listBatches,
  listExpiryAlerts,
} from "@/server/modules/lotes/batch.service";
import { ValidadeBadge } from "@/components/lotes/validade-badge";
import { AlertaValidadeForm } from "@/components/lotes/alerta-validade-form";

export default async function LotesPage() {
  const { tenantId, role } = await requirePermission("stock.view");
  const canSettings = resolvePermissions(role).includes("settings.manage");

  const ativo = await withTenant(tenantId, (tx) =>
    hasModule(tx, tenantId, "LOTES_VALIDADE"),
  );
  if (!ativo) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        Módulo <strong>Lotes e Validade</strong> não está contratado para esta
        empresa. Contrate em Administração → Módulos.
      </div>
    );
  }

  const data = await withTenant(tenantId, async (tx) => {
    await requireModule(tx, tenantId, "LOTES_VALIDADE");
    const [lotes, alertas, janelas] = await Promise.all([
      listBatches(tx, tenantId),
      listExpiryAlerts(tx, tenantId),
      getAlertSettings(tx, tenantId),
    ]);
    return { lotes, alertas, janelas };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Lotes e Validade
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Saldo por lote, alertas de vencimento e rastreabilidade até o cliente.
        </p>
      </div>

      {canSettings && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            Janela de alerta
          </h2>
          <AlertaValidadeForm dias={data.janelas} />
        </section>
      )}

      {data.alertas.length > 0 && (
        <section className="rounded-xl border border-orange-200 bg-orange-50 p-4">
          <h2 className="mb-2 text-sm font-semibold text-orange-800">
            Alertas de validade ({data.alertas.length})
          </h2>
          <ul className="space-y-1 text-sm text-orange-900">
            {data.alertas.slice(0, 10).map((a) => (
              <li key={a.batchId} className="flex items-center gap-2">
                <ValidadeBadge status={a.status} label={a.statusLabel} />
                <Link
                  href={`/lotes/${a.batchId}`}
                  className="font-medium underline decoration-orange-300 hover:text-orange-700"
                >
                  {a.productName}
                </Link>
                <span className="text-xs">
                  lote {a.batchNumber} · vence{" "}
                  {a.expiresAt ? a.expiresAt.split("-").reverse().join("/") : "—"}
                  {a.daysToExpire >= 0
                    ? ` (${a.daysToExpire}d)`
                    : ` (vencido há ${Math.abs(a.daysToExpire)}d)`}
                </span>
              </li>
            ))}
            {data.alertas.length > 10 && (
              <li className="text-xs text-orange-700">
                + {data.alertas.length - 10} alertas…
              </li>
            )}
          </ul>
        </section>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Produto
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Lote
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Validade
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Status
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">
                Saldo
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">
                Unidades
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {data.lotes.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  Nenhum lote com saldo.
                </td>
              </tr>
            )}
            {data.lotes.map((l) => (
              <tr key={l.batchId} className="hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <span className="font-medium text-slate-800">
                    {l.productName}
                  </span>
                  <span className="ml-2 text-xs text-slate-500">{l.sku}</span>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                  {l.batchNumber}
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {l.expiresAt
                    ? l.expiresAt.split("-").reverse().join("/")
                    : "—"}
                  {l.daysToExpire !== null && (
                    <span className="ml-1 text-xs text-slate-400">
                      ({l.daysToExpire}d)
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <ValidadeBadge status={l.status} label={l.statusLabel} />
                </td>
                <td className="px-4 py-2.5 text-right text-slate-700">
                  {String(l.totalQty).replace(".", ",")}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {l.warehouses
                    .map((w) => `${w.name}: ${String(w.qty).replace(".", ",")}`)
                    .join(" · ")}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/lotes/${l.batchId}`}
                    className="rounded px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                  >
                    rastrear
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
