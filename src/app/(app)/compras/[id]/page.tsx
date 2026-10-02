import Link from "next/link";
import { notFound } from "next/navigation";
import { formatBRL } from "@/lib/money";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import { formatPurchaseNumber } from "@/server/modules/compras/purchase-rules";
import { getPurchaseDetail } from "@/server/modules/compras/purchase.service";
import { resolvePermissions } from "@/server/rbac/permissions";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { StatusBadge } from "@/components/compras/status-badge";
import { CompraAcoes } from "@/components/compras/compra-acoes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CompraDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { tenantId, role } = await requirePermission("purchases.view");
  const canManage = resolvePermissions(role).includes("purchases.manage");

  const compra = await withTenant(tenantId, (tx) =>
    getPurchaseDetail(tx, tenantId, id),
  );
  if (!compra) notFound();

  const numero = formatPurchaseNumber(compra.number);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-900">{numero}</h1>
            <StatusBadge status={compra.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Entrada em {formatDateOnly(compra.entryDate)} · criada em{" "}
            {formatDateTime(compra.createdAt)}
            {compra.confirmedAt && (
              <>
                {" · confirmada em "}
                {formatDateTime(compra.confirmedAt)}
              </>
            )}
            {compra.cancelledAt && (
              <>
                {" · cancelada em "}
                {formatDateTime(compra.cancelledAt)}
              </>
            )}
          </p>
        </div>
        <Link
          href="/compras"
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Compras
        </Link>
      </div>

      <section className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="Fornecedor" valor={compra.supplierName ?? "—"} />
        <Info label="Depósito" valor={compra.warehouseName} />
        <Info label="Documento" valor={compra.documentNumber ?? "—"} />
        <Info label="Parcelas" valor={`${compra.installments}x`} />
        <Info label="Data de entrada" valor={formatDateOnly(compra.entryDate)} />
        <Info
          label="Observação"
          valor={compra.notes?.trim() ? compra.notes : "—"}
        />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Itens</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Produto</th>
                <th className="px-4 py-2 text-right font-medium">Qtd</th>
                <th className="px-4 py-2 text-right font-medium">Custo unit.</th>
                <th className="px-4 py-2 font-medium">Lote</th>
                <th className="px-4 py-2 font-medium">Validade</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {compra.items.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2">
                    <span className="font-medium text-slate-800">
                      {i.productName}
                    </span>
                    <span className="ml-2 text-xs text-slate-400">{i.sku}</span>
                  </td>
                  <td className="px-4 py-2 text-right text-slate-700">
                    {String(i.quantity)}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-600">
                    {formatBRL(i.unitCostCents)}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {i.batchNumber ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {i.expiresAt ? formatDateOnly(i.expiresAt) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-slate-800">
                    {formatBRL(i.lineTotalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <section className="w-full max-w-sm space-y-1 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="font-semibold text-slate-800">Total</span>
            <span className="text-lg font-semibold text-slate-900">
              {formatBRL(compra.totalCents)}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {compra.status === "CONFIRMED" &&
              `Estoque entrada e contas a pagar geradas (descrição ${numero}).`}
            {compra.status === "OPEN" &&
              "Nota em aberto — nada movimentado até a confirmação."}
            {compra.status === "CANCELLED" && "Nota cancelada."}
          </p>
        </section>

        <CompraAcoes
          purchaseId={compra.id}
          numberFormatted={numero}
          status={compra.status}
          canManage={canManage}
        />
      </div>
    </div>
  );
}

function Info({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{valor}</p>
    </div>
  );
}
