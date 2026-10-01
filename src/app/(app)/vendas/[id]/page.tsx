import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { formatBRL } from "@/lib/money";
import {
  formatSaleNumber,
} from "@/server/modules/vendas/sales-rules";
import { getSaleDetail } from "@/server/modules/vendas/sales.service";
import { tenants } from "@/server/db/schema";
import { resolvePermissions } from "@/server/rbac/permissions";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { StatusBadge } from "@/components/vendas/status-badge";
import { VendaAcoes } from "@/components/vendas/venda-acoes";
import { CupomNaoFiscal } from "@/components/vendas/cupom";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function VendaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { tenantId, role } = await requirePermission("sales.view");
  const permissoes = resolvePermissions(role);
  const canManage = permissoes.includes("sales.manage");
  const canBill = permissoes.includes("sales.billing");

  const dados = await withTenant(tenantId, async (tx) => {
    const venda = await getSaleDetail(tx, tenantId, id);
    if (!venda) return null;
    const [empresa] = await tx
      .select({
        name: tenants.name,
        tradingName: tenants.tradingName,
        legalName: tenants.legalName,
        document: tenants.document,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!empresa) return null;
    return { venda, empresa };
  });
  if (!dados) notFound();
  const { venda, empresa } = dados;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-slate-900">
              {formatSaleNumber(venda.number)}
            </h1>
            <StatusBadge status={venda.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Criada em{" "}
            {venda.createdAt.toLocaleString("pt-BR", {
              dateStyle: "short",
              timeStyle: "short",
            })}
            {venda.confirmedAt && (
              <>
                {" · confirmada em "}
                {venda.confirmedAt.toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </>
            )}
            {venda.billedAt && (
              <>
                {" · faturada em "}
                {venda.billedAt.toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </>
            )}
            {venda.cancelledAt && (
              <>
                {" · cancelada em "}
                {venda.cancelledAt.toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </>
            )}
          </p>
        </div>
        <Link
          href="/vendas"
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Vendas
        </Link>
      </div>

      <section className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="Cliente" valor={venda.customerName ?? "—"} />
        <Info label="Depósito" valor={venda.warehouseName} />
        <Info label="Vendedor" valor={venda.sellerName ?? "—"} />
        <Info
          label="Observação"
          valor={venda.notes?.trim() ? venda.notes : "—"}
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
                <th className="px-4 py-2 text-right font-medium">Unitário</th>
                <th className="px-4 py-2 text-right font-medium">Desconto</th>
                <th className="px-4 py-2 font-medium">Lote</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {venda.items.map((i) => (
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
                    {formatBRL(i.unitPriceCents)}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-600">
                    {i.discountCents > 0
                      ? `− ${formatBRL(i.discountCents)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {i.batchNumber ?? "—"}
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
          <LinhaRotulo valor={formatBRL(venda.subtotalCents)} label="Subtotal" />
          <LinhaRotulo
            label="Desconto itens"
            valor={`− ${formatBRL(venda.itemDiscountCents)}`}
          />
          <LinhaRotulo
            label="Desconto pedido"
            valor={`− ${formatBRL(venda.orderDiscountCents)}`}
          />
          <div className="flex items-center justify-between border-t border-slate-100 pt-2">
            <span className="font-semibold text-slate-800">Total</span>
            <span className="text-lg font-semibold text-slate-900">
              {formatBRL(venda.totalCents)}
            </span>
          </div>
        </section>

        <div className="flex flex-col items-start gap-2">
          <VendaAcoes
            saleId={venda.id}
            status={venda.status}
            canManage={canManage}
            canBill={canBill}
          />
          {venda.status === "BILLED" && (
            <CupomNaoFiscal venda={venda} empresa={empresa} />
          )}
        </div>
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

function LinhaRotulo({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between text-slate-600">
      <span>{label}</span>
      <span className="text-slate-800">{valor}</span>
    </div>
  );
}
