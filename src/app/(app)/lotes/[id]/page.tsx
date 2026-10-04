import { notFound } from "next/navigation";
import { requirePermission } from "@/server/rbac/require-permission";
import {
  hasModule,
  requireModule,
} from "@/server/modules/tenancy/module.service";
import { withTenant } from "@/server/tenant/with-tenant";
import { getBatchTrace } from "@/server/modules/lotes/batch.service";
import { EtiquetaLote } from "@/components/lotes/etiqueta-lote";
import { db } from "@/server/db/client";
import { tenants } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { formatDateTime } from "@/lib/dates";

function fmtQty(q: number): string {
  return String(q).replace(".", ",");
}

export default async function LoteDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenantId } = await requirePermission("stock.view");

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

  const lote = await withTenant(tenantId, async (tx) => {
    await requireModule(tx, tenantId, "LOTES_VALIDADE");
    return getBatchTrace(tx, tenantId, id);
  });
  if (!lote) notFound();

  const [empresa] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {lote.productName}{" "}
          <span className="font-mono text-base text-slate-500">
            {lote.batchNumber}
          </span>
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {lote.sku} · validade{" "}
          {lote.expiresAt
            ? lote.expiresAt.split("-").reverse().join("/")
            : "—"}
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Resumo do rastreio
        </h2>
        <div className="grid gap-4 sm:grid-cols-5">
          <div>
            <p className="text-xs text-slate-500">Entradas</p>
            <p className="text-lg font-semibold text-slate-900">
              {fmtQty(lote.summary.entradas)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Saídas</p>
            <p className="text-lg font-semibold text-slate-900">
              {fmtQty(lote.summary.saidas)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Saldo</p>
            <p className="text-lg font-semibold text-slate-900">
              {fmtQty(lote.summary.saldo)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Vendas</p>
            <p className="text-lg font-semibold text-slate-900">
              {lote.summary.vendas}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Clientes</p>
            <p className="text-sm font-medium text-slate-900">
              {lote.summary.clientes.length > 0
                ? lote.summary.clientes.join(", ")
                : "—"}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Movimentações do lote
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">
                  Data
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">
                  Tipo
                </th>
                <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">
                  Qtd.
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">
                  Unidade
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">
                  Venda / Cliente
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">
                  Usuário
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {lote.movements.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-sm text-slate-500"
                  >
                    Sem movimentações para este lote.
                  </td>
                </tr>
              )}
              {lote.movements.map((m) => (
                <tr key={m.id}>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {formatDateTime(new Date(m.occurredAt))}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{m.type}</td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {fmtQty(m.quantity)}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {m.warehouseName}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {m.saleNumber
                      ? `VENDA-${String(m.saleNumber).padStart(6, "0")}${
                          m.customerName ? ` · ${m.customerName}` : ""
                        }`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-500">
                    {m.userName ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">
          Etiqueta do lote
        </h2>
        <EtiquetaLote label={lote.label} empresa={empresa?.name ?? null} />
      </section>
    </div>
  );
}
