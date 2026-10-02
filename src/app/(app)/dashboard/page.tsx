import Link from "next/link";
import { formatDateOnly } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { dashboardFilters } from "@/lib/validators/dashboard";
import { fieldErrorsOf } from "@/lib/validators/relatorios";
import { ReportError, normalizeRange } from "@/server/modules/relatorios/report-rules";
import {
  getDashboard,
  type DashboardData,
} from "@/server/modules/dashboard/dashboard.service";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { KpiStrip, type KpiItem } from "@/components/metrics/kpi-strip";
import { RevenueBars } from "@/components/dashboard/revenue-bars";
import { StatusBadge } from "@/components/financeiro/status-badge";

// Dashboard (Fase 13): visão geral do período — KPIs, faturamento por dia,
// funil de vendas, alertas de estoque/financeiro, top vendedores e próximos
// vencimentos. Reusa os services da Fase 12; permissão: reports.view.

const DEFAULT_DAYS = 30;
const DAY_MS = 86_400_000;

const FUNNEL_ROWS = [
  { status: "DRAFT", label: "Rascunho", bar: "bg-slate-400" },
  { status: "CONFIRMED", label: "Confirmada", bar: "bg-amber-500" },
  { status: "BILLED", label: "Faturada", bar: "bg-emerald-500" },
  { status: "CANCELLED", label: "Cancelada", bar: "bg-rose-400" },
  { status: "RETURNED", label: "Devolvida", bar: "bg-violet-500" },
] as const;

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function defaultRange(): { de: string; ate: string } {
  const todayIso = new Date().toISOString().slice(0, 10);
  const de = new Date(
    Date.parse(`${todayIso}T00:00:00Z`) - (DEFAULT_DAYS - 1) * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);
  return { de, ate: todayIso };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requirePermission("reports.view");
  const sp = await searchParams;
  const def = defaultRange();

  let erro: string | null = null;
  let data: DashboardData | null = null;
  let range = def;

  const parsed = dashboardFilters.safeParse({
    de: str(sp.de) ?? def.de,
    ate: str(sp.ate) ?? def.ate,
  });
  if (!parsed.success) {
    erro =
      Object.values(fieldErrorsOf(parsed.error))[0] ?? "Dados inválidos.";
  } else {
    try {
      const normalized = normalizeRange(parsed.data.de, parsed.data.ate);
      if (!normalized.de || !normalized.ate) {
        throw new ReportError("Período obrigatório para o dashboard.");
      }
      range = { de: normalized.de, ate: normalized.ate };
      data = await withTenant(tenantId, (tx) =>
        getDashboard(tx, tenantId, range),
      );
    } catch (err) {
      if (err instanceof ReportError) erro = err.message;
      else throw err;
    }
  }

  const kpis: KpiItem[] = data
    ? [
        {
          label: "Faturamento no período",
          value: formatBRL(data.sales.netCents),
          hint: `${data.period.days} dia(s) · ${data.sales.billedOrders} faturada(s)`,
          tone: data.sales.netCents > 0 ? "success" : "default",
        },
        {
          label: "Ticket médio",
          value:
            data.sales.ticketAvgCents === null
              ? "—"
              : formatBRL(data.sales.ticketAvgCents),
          hint: "por venda faturada",
        },
        {
          label: "Estoque crítico",
          value: `${data.stock.critical} item(ns)`,
          hint: `${data.stock.low} no mínimo · valor ${formatBRL(data.stock.valueCents)}`,
          tone: data.stock.critical > 0 ? "danger" : "success",
        },
        {
          label: "Inadimplência",
          value: formatBRL(data.finance.overdueCents),
          hint: `${data.finance.overdueCount} conta(s) vencida(s)`,
          tone: data.finance.overdueCents > 0 ? "danger" : "success",
        },
        {
          label: "A receber",
          value: formatBRL(data.finance.openCents),
          hint: "saldo em aberto",
        },
      ]
    : [];

  const funnelTotal = data?.funnel.total ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Visão geral de vendas, estoque e financeiro
            {data
              ? ` · ${formatDateOnlyIso(range.de)} → ${formatDateOnlyIso(range.ate)} (${data.period.days} dias)`
              : ""}
          </p>
        </div>
        <Link
          href="/dashboard"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Últimos {DEFAULT_DAYS} dias
        </Link>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <label className="text-xs font-medium text-slate-500">
          De
          <input
            type="date"
            name="de"
            defaultValue={range.de}
            className="mt-1 block rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <label className="text-xs font-medium text-slate-500">
          Até
          <input
            type="date"
            name="ate"
            defaultValue={range.ate}
            className="mt-1 block rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Aplicar
        </button>
      </form>

      {erro && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {erro}
        </div>
      )}

      {data && (
        <>
          <KpiStrip items={kpis} />

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
              <h2 className="text-sm font-semibold text-slate-800">
                Faturamento por dia
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Vendas faturadas por dia (UTC) · total{" "}
                {formatBRL(data.sales.netCents)}
              </p>
              <RevenueBars points={data.series} />
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-800">
                Funil de vendas
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Pedidos criados no período: {funnelTotal}
              </p>
              <ul className="mt-3 space-y-3">
                {FUNNEL_ROWS.map((r) => {
                  const count = data.funnel[r.status];
                  const pct =
                    funnelTotal > 0
                      ? Math.round((count / funnelTotal) * 100)
                      : 0;
                  return (
                    <li key={r.status}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-600">{r.label}</span>
                        <span className="font-medium text-slate-800">
                          {count}{" "}
                          <span className="font-normal text-slate-400">
                            ({pct}%)
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-slate-100">
                        <div
                          className={`h-2 rounded-full ${r.bar}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              {funnelTotal === 0 && (
                <p className="mt-3 text-sm text-slate-400">
                  Nenhum pedido criado no período.
                </p>
              )}
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-800">Alertas</h2>
              <ul className="mt-3 space-y-2 text-sm">
                <li className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">Itens em nível crítico</span>
                  <span
                    className={
                      data.stock.critical > 0
                        ? "font-semibold text-rose-600"
                        : "font-semibold text-emerald-600"
                    }
                  >
                    {data.stock.critical}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">Itens no mínimo</span>
                  <span
                    className={
                      data.stock.low > 0
                        ? "font-semibold text-amber-600"
                        : "font-semibold text-emerald-600"
                    }
                  >
                    {data.stock.low}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">Contas vencidas</span>
                  <span
                    className={
                      data.finance.overdueCount > 0
                        ? "font-semibold text-rose-600"
                        : "font-semibold text-emerald-600"
                    }
                  >
                    {data.finance.overdueCount} (
                    {formatBRL(data.finance.overdueCents)})
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">Valor em estoque</span>
                  <span className="font-semibold text-slate-800">
                    {formatBRL(data.stock.valueCents)}
                  </span>
                </li>
              </ul>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-800">
                Top vendedores
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Por faturamento no período
              </p>
              {data.topSellers.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">
                  Nenhuma venda faturada no período.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100 text-sm">
                  {data.topSellers.map((s, i) => (
                    <li
                      key={s.key}
                      className="flex items-center justify-between gap-2 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="w-4 text-xs font-semibold text-slate-400">
                          {i + 1}
                        </span>
                        <span className="truncate text-slate-700">
                          {s.key}
                        </span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {s.orders} venda(s)
                        </span>
                      </span>
                      <span className="shrink-0 font-medium text-slate-800">
                        {formatBRL(s.netCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-800">
                Próximos vencimentos
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Contas a receber a partir de hoje
              </p>
              {data.nextDue.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">
                  Nenhum vencimento nos próximos dias.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100 text-sm">
                  {data.nextDue.map((a) => (
                    <li
                      key={a.accountId}
                      className="flex items-center justify-between gap-2 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <StatusBadge status={a.status} />
                        <span className="truncate text-slate-700">
                          {a.description}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-slate-400">
                          {formatDateOnly(
                            new Date(`${a.dueDate}T00:00:00.000Z`),
                          )}
                        </span>
                        <span className="font-medium text-slate-800">
                          {formatBRL(a.openCents)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function formatDateOnlyIso(iso: string): string {
  return formatDateOnly(new Date(`${iso}T00:00:00.000Z`));
}
