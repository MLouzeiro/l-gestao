import Link from "next/link";
import { formatDateOnly } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import {
  getFinancialSummary,
  listAccounts,
} from "@/server/modules/financeiro/financial.service";
import type { FinancialStatus } from "@/server/modules/financeiro/financial-rules";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { KpiStrip, type KpiItem } from "@/components/metrics/kpi-strip";
import {
  DIRECTION_LABELS,
  STATUS_FILTERS,
  StatusBadge,
} from "@/components/financeiro/status-badge";

const VALID_STATUS = new Set(STATUS_FILTERS.map((s) => s.value));
const PAGE_SIZE = 20;

type Filtro = { aba: "receber" | "pagar"; status: string; q: string };

function hrefFinanceiro(f: Filtro, page: number): string {
  const params = new URLSearchParams();
  params.set("aba", f.aba);
  if (f.status !== "ALL") params.set("status", f.status);
  if (f.q) params.set("q", f.q);
  if (page > 1) params.set("page", String(page));
  return `/financeiro?${params.toString()}`;
}

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; status?: string; q?: string; page?: string }>;
}) {
  const { tenantId } = await requirePermission("finance.view");

  const sp = await searchParams;
  const aba: "receber" | "pagar" = sp.aba === "pagar" ? "pagar" : "receber";
  const status = sp.status && VALID_STATUS.has(sp.status) ? sp.status : "ALL";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const page = Math.max(Number.parseInt(sp.page ?? "1", 10) || 1, 1);
  const filtro: Filtro = { aba, status, q };

  const { rows, total, summary } = await withTenant(tenantId, async (tx) => {
    const res = await listAccounts(tx, tenantId, {
      direction: aba === "pagar" ? "PAYABLE" : "RECEIVABLE",
      status: status !== "ALL" ? [status as FinancialStatus] : undefined,
      search: q,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
    const kpis = await getFinancialSummary(tx, tenantId);
    return { ...res, summary: kpis };
  });

  const pct = (part: number, whole: number): string =>
    whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";

  const kpis: KpiItem[] = [
    {
      label: "A receber (aberto)",
      value: formatBRL(summary.receivableOpenCents),
      hint: `${summary.receivableOpenCount} conta${summary.receivableOpenCount === 1 ? "" : "s"}`,
    },
    {
      label: "A receber vencido",
      value: formatBRL(summary.receivableOverdueCents),
      hint: `${pct(summary.receivableOverdueCents, summary.receivableOpenCents)} do a receber`,
      tone: summary.receivableOverdueCents > 0 ? "danger" : "default",
    },
    {
      label: "A receber em 7 dias",
      value: formatBRL(summary.receivableDue7Cents),
    },
    {
      label: "Recebido no mês",
      value: formatBRL(summary.receivedMonthCents),
      tone: "success",
    },
    {
      label: "A pagar (aberto)",
      value: formatBRL(summary.payableOpenCents),
      hint: `${summary.payableOpenCount} conta${summary.payableOpenCount === 1 ? "" : "s"}`,
    },
    {
      label: "A pagar vencido",
      value: formatBRL(summary.payableOverdueCents),
      hint: `${pct(summary.payableOverdueCents, summary.payableOpenCents)} do a pagar`,
      tone: summary.payableOverdueCents > 0 ? "danger" : "default",
    },
    {
      label: "A pagar em 7 dias",
      value: formatBRL(summary.payableDue7Cents),
    },
    {
      label: "Pago no mês",
      value: formatBRL(summary.paidMonthCents),
    },
  ];

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const abaLink = (alvo: "receber" | "pagar") => {
    const params = new URLSearchParams();
    params.set("aba", alvo);
    if (status !== "ALL") params.set("status", status);
    if (q) params.set("q", q);
    return `/financeiro?${params.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Financeiro</h1>
        <p className="mt-1 text-sm text-slate-500">
          Contas a receber de vendas e a pagar de compras, com baixa parcial ou
          total.
        </p>
      </div>

      <KpiStrip items={kpis} />

      <div className="flex gap-2">
        {(["receber", "pagar"] as const).map((a) => (
          <Link
            key={a}
            href={abaLink(a)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              aba === a
                ? "bg-indigo-600 text-white"
                : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {DIRECTION_LABELS[a === "pagar" ? "PAYABLE" : "RECEIVABLE"]}
          </Link>
        ))}
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <input type="hidden" name="aba" value={aba} />
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
            placeholder="Descrição"
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
          {total} conta{total === 1 ? "" : "s"}
        </span>
      </form>

      <section className="rounded-lg border border-slate-200 bg-white">
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            {total === 0
              ? aba === "pagar"
                ? "Nenhuma conta a pagar registrada ainda."
                : "Nenhuma conta a receber registrada ainda."
              : "Nenhuma conta encontrada com esses filtros."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Vencimento</th>
                  <th className="px-4 py-2 font-medium">Descrição</th>
                  <th className="px-4 py-2 font-medium">Parceiro</th>
                  <th className="px-4 py-2 font-medium">Parcela</th>
                  <th className="px-4 py-2 text-right font-medium">Valor</th>
                  <th className="px-4 py-2 text-right font-medium">Pago</th>
                  <th className="px-4 py-2 text-right font-medium">Saldo</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const saldo = r.amountCents - r.paidCents;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td
                        className={`px-4 py-2 ${
                          r.status === "OVERDUE" ? "font-medium text-rose-600" : "text-slate-600"
                        }`}
                      >
                        {formatDateOnly(r.dueDate)}
                      </td>
                      <td className="px-4 py-2">
                        <Link
                          href={`/financeiro/${r.id}`}
                          className="font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          {r.description}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-slate-700">{r.partyName ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {r.installmentNumber && r.installmentCount
                          ? `${r.installmentNumber}/${r.installmentCount}`
                          : "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-slate-800">
                        {formatBRL(r.amountCents)}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-600">
                        {r.paidCents > 0 ? formatBRL(r.paidCents) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-700">
                        {saldo > 0 ? formatBRL(saldo) : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link
              href={hrefFinanceiro(filtro, page - 1)}
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
              href={hrefFinanceiro(filtro, page + 1)}
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
