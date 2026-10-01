import Link from "next/link";
import { formatBRL } from "@/lib/money";
import {
  formatSaleNumber,
  type SaleStatus,
} from "@/server/modules/vendas/sales-rules";
import { listSales } from "@/server/modules/vendas/sales.service";
import { resolvePermissions } from "@/server/rbac/permissions";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { STATUS_FILTERS, StatusBadge } from "@/components/vendas/status-badge";

const VALID_STATUS = new Set(STATUS_FILTERS.map((s) => s.value));

type Filtro = { status: string; q: string; page: number };

function hrefVendas(f: Omit<Filtro, "page">, page: number): string {
  const params = new URLSearchParams();
  if (f.status !== "ALL") params.set("status", f.status);
  if (f.q) params.set("q", f.q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/vendas?${qs}` : "/vendas";
}

export default async function VendasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const { tenantId, role } = await requirePermission("sales.view");
  const canManage = resolvePermissions(role).includes("sales.manage");

  const sp = await searchParams;
  const status =
    sp.status && VALID_STATUS.has(sp.status) ? sp.status : "ALL";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const page = Math.max(Number.parseInt(sp.page ?? "1", 10) || 1, 1);
  const filtro = { status, q };

  const data = await withTenant(tenantId, (tx) =>
    listSales(tx, tenantId, {
      status: status as SaleStatus | "ALL",
      search: q,
      page,
      pageSize: 20,
    }),
  );

  const totalPages = Math.max(Math.ceil(data.total / data.pageSize), 1);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Vendas</h1>
          <p className="mt-1 text-sm text-slate-500">
            Pedidos em rascunho, confirmação com reserva de estoque e
            faturamento.
          </p>
        </div>
        {canManage && (
          <Link
            href="/vendas/nova"
            className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            + Nova venda
          </Link>
        )}
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <label className="text-xs font-medium text-slate-500">
          Status
          <select
            name="status"
            defaultValue={status}
            className="mt-1 block w-44 rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-500">
          Busca
          <input
            name="q"
            defaultValue={q}
            placeholder="Número ou cliente"
            className="mt-1 block w-64 rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Filtrar
        </button>
        <span className="ml-auto text-xs text-slate-400">
          {data.total} venda{data.total === 1 ? "" : "s"}
        </span>
      </form>

      <section className="rounded-lg border border-slate-200 bg-white">
        {data.rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            {data.total === 0
              ? "Nenhuma venda registrada ainda."
              : "Nenhuma venda encontrada com esses filtros."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Número</th>
                  <th className="px-4 py-2 font-medium">Cliente</th>
                  <th className="px-4 py-2 font-medium">Data</th>
                  <th className="px-4 py-2 text-right font-medium">Itens</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link
                        href={`/vendas/${r.id}`}
                        className="font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        {formatSaleNumber(r.number)}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-700">
                      {r.customerName ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {r.createdAt.toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">
                      {r.itemCount}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-slate-800">
                      {formatBRL(r.totalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link
              href={hrefVendas(filtro, page - 1)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50"
            >
              ← Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-slate-500">
            Página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={hrefVendas(filtro, page + 1)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50"
            >
              Próxima →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
