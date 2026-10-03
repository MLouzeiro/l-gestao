import { notFound } from "next/navigation";
import { requirePermission } from "@/server/rbac/require-permission";
import {
  hasModule,
  requireModule,
} from "@/server/modules/tenancy/module.service";
import { withTenant } from "@/server/tenant/with-tenant";
import { getTransferDetail } from "@/server/modules/transferencias/transfer.service";
import { StatusTransferenciaBadge } from "@/components/transferencias/status-transferencia-badge";
import { TransferenciaAcoes } from "@/components/transferencias/transferencia-acoes";
import { formatDateTime } from "@/lib/dates";

export default async function TransferenciaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  const t = await withTenant(tenantId, async (tx) => {
    await requireModule(tx, tenantId, "TRANSFERENCIAS");
    return getTransferDetail(tx, tenantId, id);
  });
  if (!t) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            {t.transferNumber} <StatusTransferenciaBadge status={t.status} />
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t.fromWarehouseName} <span className="text-slate-400">→</span>{" "}
            {t.toWarehouseName} ·{" "}
            {t.settleOn === "SEND"
              ? "baixa na origem ao enviar"
              : "baixa na origem ao receber"}
            {t.userName ? ` · por ${t.userName}` : ""}
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Itens da transferência
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">
                  Produto
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">
                  Lote
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">
                  Quantidade
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {t.items.map((i) => (
                <tr key={i.productId}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-800">{i.name}</span>
                    <span className="ml-2 text-xs text-slate-500">{i.sku}</span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {i.batchNumber ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {String(i.quantity).replace(".", ",")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {t.notes && (
          <p className="mt-3 text-sm text-slate-500">Obs.: {t.notes}</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Andamento
        </h2>
        <ul className="mb-4 space-y-1 text-sm text-slate-600">
          <li>Enviada: {t.sentAt ? formatDateTime(t.sentAt) : "—"}</li>
          <li>Recebida: {t.receivedAt ? formatDateTime(t.receivedAt) : "—"}</li>
          <li>Cancelada: {t.cancelledAt ? formatDateTime(t.cancelledAt) : "—"}</li>
        </ul>
        <TransferenciaAcoes transferId={t.id} status={t.status} />
      </section>
    </div>
  );
}
