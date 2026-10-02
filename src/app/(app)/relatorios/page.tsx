import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { formatDateOnly } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import {
  financeReportFilters,
  purchasesReportFilters,
  salesReportFilters,
  stockReportFilters,
} from "@/lib/validators/relatorios";
import {
  REPORT_TIPOS,
  ReportError,
  normalizeRange,
  totalPages,
  type ReportTipo,
} from "@/server/modules/relatorios/report-rules";
import {
  getFinanceReport,
  getPurchasesReport,
  getSalesReport,
  getStockReport,
} from "@/server/modules/relatorios/report.service";
import { members, suppliers, users, warehouses } from "@/server/db/schema";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { KpiStrip, type KpiItem } from "@/components/metrics/kpi-strip";
import {
  DIRECTION_LABELS,
  STATUS_FILTERS,
  StatusBadge,
} from "@/components/financeiro/status-badge";
import { LevelBadge } from "@/components/relatorios/level-badge";

// Relatórios (Fase 12): 4 abas com filtros GET, KPIs, tabela paginada e
// exportação pela rota dedicada /api/exports/[tipo] (mesmos parâmetros).

const PAGE_SIZE = 20;

const TAB_LABEL: Record<ReportTipo, string> = {
  estoque: "Estoque",
  vendas: "Vendas",
  compras: "Compras",
  financeiro: "Financeiro",
};

const GROUP_SALES_OPTIONS = [
  { value: "dia", label: "Por dia" },
  { value: "vendedor", label: "Por vendedor" },
  { value: "produto", label: "Por produto" },
];

const GROUP_PURCHASES_OPTIONS = [
  { value: "fornecedor", label: "Por fornecedor" },
  { value: "produto", label: "Por produto" },
];

const SOURCE_LABEL: Record<string, string> = {
  SALE: "Venda",
  PURCHASE: "Compra",
  RETURN: "Devolução",
  MANUAL: "Manual",
};

type Option = { id: string; name: string };

type TabData = {
  stock?: Awaited<ReturnType<typeof getStockReport>>;
  sales?: Awaited<ReturnType<typeof getSalesReport>>;
  purchases?: Awaited<ReturnType<typeof getPurchasesReport>>;
  finance?: Awaited<ReturnType<typeof getFinanceReport>>;
  warehousesList?: Option[];
  sellersList?: Option[];
  suppliersList?: Option[];
};

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function fmtQty(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function fmtPct(n: number | null): string {
  if (n === null) return "—";
  return `${n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

type HrefParams = Record<string, string | undefined>;

// Parâmetros relevantes por aba (evita vazar groupBy/filtros entre tipos).
const TAB_KEYS: Record<ReportTipo, string[]> = {
  estoque: ["q", "level", "warehouseId"],
  vendas: ["groupBy", "sellerId"],
  compras: ["groupBy", "supplierId"],
  financeiro: ["direction", "status"],
};

function buildQuery(tipo: ReportTipo, params: HrefParams): string {
  const sp = new URLSearchParams();
  sp.set("tipo", tipo);
  for (const key of ["de", "ate", ...TAB_KEYS[tipo]]) {
    const v = params[key];
    if (v) sp.set(key, v);
  }
  return sp.toString();
}

function hrefRelatorio(params: HrefParams, page?: number): string {
  const tipo = (params.tipo ?? "estoque") as ReportTipo;
  const sp = new URLSearchParams(buildQuery(tipo, params));
  if (page && page > 1) sp.set("page", String(page));
  return `/relatorios?${sp.toString()}`;
}

function hrefCsv(params: HrefParams): string {
  const tipo = (params.tipo ?? "estoque") as ReportTipo;
  return `/api/exports/${tipo}?${buildQuery(tipo, params)}`;
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenantId } = await requirePermission("reports.view");
  const sp = await searchParams;

  const tipoRaw = str(sp.tipo) ?? "estoque";
  const tipo: ReportTipo = (REPORT_TIPOS as readonly string[]).includes(tipoRaw)
    ? (tipoRaw as ReportTipo)
    : "estoque";

  const common = {
    de: str(sp.de),
    ate: str(sp.ate),
    page: 1,
    pageSize: PAGE_SIZE,
  };

  let erro: string | null = null;
  let range: { de?: string; ate?: string } = {};
  try {
    range = normalizeRange(common.de, common.ate);
  } catch (err) {
    if (err instanceof ReportError) erro = err.message;
    else throw err;
  }

  const page = Math.max(Number.parseInt(str(sp.page) ?? "1", 10) || 1, 1);

  let raw: HrefParams = { tipo, ...range };
  let data: TabData = {};
  let parseError: string | null = null;

  if (!erro) {
    if (tipo === "estoque") {
      const parsed = stockReportFilters.safeParse({
        ...common,
        de: range.de,
        ate: range.ate,
        q: str(sp.q),
        warehouseId: str(sp.warehouseId),
        level: str(sp.level),
        page,
      });
      if (!parsed.success) {
        parseError = parsed.error.issues[0]?.message ?? "Dados inválidos.";
      } else {
        raw = { ...raw, q: parsed.data.q, level: parsed.data.level, warehouseId: parsed.data.warehouseId };
        data = await withTenant(tenantId, async (tx) => {
          const stock = await getStockReport(tx, tenantId, {
            ...parsed.data,
            de: range.de,
            ate: range.ate,
          });
          const warehousesList = await tx
            .select({ id: warehouses.id, name: warehouses.name })
            .from(warehouses)
            .where(and(eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)))
            .orderBy(asc(warehouses.name));
          return { stock, warehousesList };
        });
      }
    } else if (tipo === "vendas") {
      const parsed = salesReportFilters.safeParse({
        ...common,
        de: range.de,
        ate: range.ate,
        sellerId: str(sp.sellerId),
        groupBy: str(sp.groupBy) ?? undefined,
        page,
      });
      if (!parsed.success) {
        parseError = parsed.error.issues[0]?.message ?? "Dados inválidos.";
      } else {
        raw = { ...raw, sellerId: parsed.data.sellerId, groupBy: parsed.data.groupBy };
        data = await withTenant(tenantId, async (tx) => {
          const sales = await getSalesReport(tx, tenantId, {
            ...parsed.data,
            de: range.de,
            ate: range.ate,
          });
          const sellersList = await tx
            .select({ id: users.id, name: users.name })
            .from(members)
            .innerJoin(users, eq(members.userId, users.id))
            .where(eq(members.organizationId, tenantId))
            .orderBy(asc(users.name));
          return { sales, sellersList };
        });
      }
    } else if (tipo === "compras") {
      const parsed = purchasesReportFilters.safeParse({
        ...common,
        de: range.de,
        ate: range.ate,
        supplierId: str(sp.supplierId),
        groupBy: str(sp.groupBy) ?? undefined,
        page,
      });
      if (!parsed.success) {
        parseError = parsed.error.issues[0]?.message ?? "Dados inválidos.";
      } else {
        raw = { ...raw, supplierId: parsed.data.supplierId, groupBy: parsed.data.groupBy };
        data = await withTenant(tenantId, async (tx) => {
          const purchases = await getPurchasesReport(tx, tenantId, {
            ...parsed.data,
            de: range.de,
            ate: range.ate,
          });
          const suppliersList = await tx
            .select({ id: suppliers.id, name: suppliers.name })
            .from(suppliers)
            .where(and(eq(suppliers.tenantId, tenantId), isNull(suppliers.deletedAt)))
            .orderBy(asc(suppliers.name));
          return { purchases, suppliersList };
        });
      }
    } else {
      const statusRaw = str(sp.status);
      const parsed = financeReportFilters.safeParse({
        ...common,
        de: range.de,
        ate: range.ate,
        direction: str(sp.direction) ?? undefined,
        status: statusRaw && statusRaw !== "ALL" ? statusRaw : undefined,
        page,
      });
      if (!parsed.success) {
        parseError = parsed.error.issues[0]?.message ?? "Dados inválidos.";
      } else {
        raw = {
          ...raw,
          direction: parsed.data.direction,
          status: parsed.data.status ?? (statusRaw === "ALL" ? "ALL" : undefined),
        };
        data = await withTenant(tenantId, async (tx) => ({
          finance: await getFinanceReport(tx, tenantId, {
            ...parsed.data,
            de: range.de,
            ate: range.ate,
          }),
        }));
      }
    }
  }

  const kpis: KpiItem[] = [];
  if (tipo === "estoque" && data.stock) {
    const s = data.stock.summary;
    kpis.push(
      { label: "Itens em estoque", value: String(s.items) },
      { label: "Valor em estoque", value: formatBRL(s.valueCents) },
      {
        label: "Críticos (sem saldo)",
        value: String(s.critical),
        tone: s.critical > 0 ? "danger" : "success",
      },
      {
        label: "Abaixo do mínimo",
        value: String(s.low),
        tone: s.low > 0 ? "warning" : "default",
      },
    );
  } else if (tipo === "vendas" && data.sales) {
    const s = data.sales.summary;
    kpis.push(
      { label: "Vendas faturadas", value: String(s.orders) },
      { label: "Faturamento líquido", value: formatBRL(s.netCents) },
      { label: "Custo de mercadoria", value: formatBRL(s.costCents) },
      {
        label: "Margem",
        value: formatBRL(s.marginCents),
        hint: fmtPct(s.marginPct),
        tone: s.marginCents >= 0 ? "success" : "danger",
      },
    );
  } else if (tipo === "compras" && data.purchases) {
    const s = data.purchases.summary;
    kpis.push(
      { label: "Notas confirmadas", value: String(s.orders) },
      { label: "Total em compras", value: formatBRL(s.totalCents) },
    );
  } else if (tipo === "financeiro" && data.finance) {
    const s = data.finance.summary;
    kpis.push(
      {
        label: "Em aberto (saldo)",
        value: formatBRL(s.accounts.openCents),
        hint: `${s.accounts.byStatus.OPEN.count + s.accounts.byStatus.PARTIAL.count + s.accounts.byStatus.OVERDUE.count} conta(s)`,
      },
      {
        label: "Inadimplência (vencido)",
        value: formatBRL(s.accounts.overdueCents),
        hint: `${s.accounts.overdueCount} conta(s)`,
        tone: s.accounts.overdueCents > 0 ? "danger" : "success",
      },
      {
        label: "Baixas no período",
        value: formatBRL(s.payments.amountCents),
        hint: `${s.payments.count} baixa(s)`,
      },
      {
        label: "Quitado no período",
        value: formatBRL(s.accounts.byStatus.PAID.amountCents),
        hint: `${s.accounts.byStatus.PAID.count} conta(s)`,
        tone: "success",
      },
    );
  }

  const total =
    data.stock?.total ?? data.sales?.total ?? data.purchases?.total ?? data.finance?.total ?? 0;
  const pages = totalPages(total, PAGE_SIZE);

  const tableTitle = erro
    ? null
    : parseError
      ? parseError
      : total === 0
        ? "Nenhum resultado para os filtros atuais."
        : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Relatórios</h1>
          <p className="mt-1 text-sm text-slate-500">
            Indicadores de estoque, vendas, compras e financeiro com exportação
            CSV.
          </p>
        </div>
        {!erro && !parseError && (
          <a
            href={hrefCsv(raw)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            download
          >
            Exportar CSV
          </a>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {REPORT_TIPOS.map((t) => (
          <Link
            key={t}
            href={hrefRelatorio({ ...raw, tipo: t })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tipo === t
                ? "bg-indigo-600 text-white"
                : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {TAB_LABEL[t]}
          </Link>
        ))}
      </div>

      {(erro || parseError) && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {erro ?? parseError}
        </div>
      )}

      {!erro && !parseError && <KpiStrip items={kpis} />}

      {!erro && !parseError && (
        <form
          method="get"
          className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          <input type="hidden" name="tipo" value={tipo} />
          <label className="text-xs font-medium text-slate-500">
            De
            <input
              type="date"
              name="de"
              defaultValue={range.de ?? ""}
              className="mt-1 block rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Até
            <input
              type="date"
              name="ate"
              defaultValue={range.ate ?? ""}
              className="mt-1 block rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
            />
          </label>

          {tipo === "estoque" && (
            <>
              <label className="text-xs font-medium text-slate-500">
                Busca
                <input
                  name="q"
                  defaultValue={str(sp.q) ?? ""}
                  placeholder="Produto ou SKU"
                  className="mt-1 block w-52 rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
                />
              </label>
              <label className="text-xs font-medium text-slate-500">
                Depósito
                <select
                  name="warehouseId"
                  defaultValue={str(sp.warehouseId) ?? ""}
                  className="mt-1 block w-44 rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
                >
                  <option value="">Todos</option>
                  {(data.warehousesList ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-500">
                Situação
                <select
                  name="level"
                  defaultValue={str(sp.level) ?? ""}
                  className="mt-1 block w-36 rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
                >
                  <option value="">Todas</option>
                  <option value="CRITICO">Crítico</option>
                  <option value="BAIXO">Baixo</option>
                  <option value="OK">Ok</option>
                </select>
              </label>
            </>
          )}

          {tipo === "vendas" && (
            <>
              <label className="text-xs font-medium text-slate-500">
                Agrupar por
                <select
                  name="groupBy"
                  defaultValue={str(sp.groupBy) ?? "dia"}
                  className="mt-1 block w-40 rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
                >
                  {GROUP_SALES_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-500">
                Vendedor
                <select
                  name="sellerId"
                  defaultValue={str(sp.sellerId) ?? ""}
                  className="mt-1 block w-44 rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
                >
                  <option value="">Todos</option>
                  {(data.sellersList ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {tipo === "compras" && (
            <>
              <label className="text-xs font-medium text-slate-500">
                Agrupar por
                <select
                  name="groupBy"
                  defaultValue={str(sp.groupBy) ?? "fornecedor"}
                  className="mt-1 block w-44 rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
                >
                  {GROUP_PURCHASES_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-500">
                Fornecedor
                <select
                  name="supplierId"
                  defaultValue={str(sp.supplierId) ?? ""}
                  className="mt-1 block w-48 rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
                >
                  <option value="">Todos</option>
                  {(data.suppliersList ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {tipo === "financeiro" && (
            <>
              <label className="text-xs font-medium text-slate-500">
                Direção
                <select
                  name="direction"
                  defaultValue={str(sp.direction) ?? "RECEIVABLE"}
                  className="mt-1 block w-36 rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
                >
                  <option value="RECEIVABLE">{DIRECTION_LABELS.RECEIVABLE}</option>
                  <option value="PAYABLE">{DIRECTION_LABELS.PAYABLE}</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-500">
                Status
                <select
                  name="status"
                  defaultValue={str(sp.status) ?? "ALL"}
                  className="mt-1 block w-40 rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-800"
                >
                  {STATUS_FILTERS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <button
            type="submit"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Filtrar
          </button>
          <span className="ml-auto text-xs text-slate-400">
            {total} resultado{total === 1 ? "" : "s"}
          </span>
        </form>
      )}

      {!erro && !parseError && (
        <section className="rounded-lg border border-slate-200 bg-white">
          {tableTitle ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">{tableTitle}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>{renderHead(tipo, raw.groupBy ?? "dia")}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {renderBody(tipo, data, raw.groupBy ?? "dia")}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!erro && !parseError && pages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link
              href={hrefRelatorio(raw, page - 1)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-50"
            >
              ← Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-slate-500">
            Página {page} de {pages}
          </span>
          {page < pages ? (
            <Link
              href={hrefRelatorio(raw, page + 1)}
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

// --- cabeçalho/corpo por aba ------------------------------------------------

function Th({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
  return (
    <th
      className={`px-4 py-2 font-medium ${right ? "text-right" : ""}`}
    >
      {children}
    </th>
  );
}

function renderHead(tipo: ReportTipo, groupBy: string): React.ReactNode {
  if (tipo === "estoque") {
    return (
      <>
        <Th>SKU</Th>
        <Th>Produto</Th>
        <Th>Depósito</Th>
        <Th right>Saldo</Th>
        <Th right>Reservado</Th>
        <Th right>Disponível</Th>
        <Th right>Mínimo</Th>
        <Th right>Valor</Th>
        <Th>Situação</Th>
      </>
    );
  }
  if (tipo === "vendas") {
    const dim = groupBy === "vendedor" ? "Vendedor" : groupBy === "produto" ? "Produto" : "Dia";
    return (
      <>
        <Th>{dim}</Th>
        <Th right>Vendas</Th>
        <Th right>Itens</Th>
        <Th right>Bruto</Th>
        <Th right>Desconto</Th>
        <Th right>Líquido</Th>
        <Th right>Custo</Th>
        <Th right>Margem</Th>
        <Th right>Margem %</Th>
      </>
    );
  }
  if (tipo === "compras") {
    const dim = groupBy === "produto" ? "Produto" : "Fornecedor";
    return (
      <>
        <Th>{dim}</Th>
        <Th right>Notas</Th>
        <Th right>Quantidade</Th>
        <Th right>Total</Th>
      </>
    );
  }
  return (
    <>
      <Th>Vencimento</Th>
      <Th>Descrição</Th>
      <Th>Parcela</Th>
      <Th right>Valor</Th>
      <Th right>Pago</Th>
      <Th right>Saldo</Th>
      <Th>Status</Th>
      <Th>Origem</Th>
    </>
  );
}

function renderBody(
  tipo: ReportTipo,
  data: TabData,
  groupBy: string,
): React.ReactNode {
  if (tipo === "estoque") {
    const rows = data.stock?.rows ?? [];
    return rows.map((r) => (
      <tr key={`${r.productId}-${r.warehouseId}`} className="hover:bg-slate-50">
        <td className="px-4 py-2 text-slate-600">{r.sku}</td>
        <td className="px-4 py-2 font-medium text-slate-800">{r.name}</td>
        <td className="px-4 py-2 text-slate-600">{r.warehouseName}</td>
        <td className="px-4 py-2 text-right font-medium text-slate-800">{fmtQty(r.quantity)}</td>
        <td className="px-4 py-2 text-right text-slate-600">{fmtQty(r.reserved)}</td>
        <td className="px-4 py-2 text-right text-slate-700">{fmtQty(r.available)}</td>
        <td className="px-4 py-2 text-right text-slate-500">{fmtQty(r.minStock)}</td>
        <td className="px-4 py-2 text-right font-medium text-slate-800">{formatBRL(r.valueCents)}</td>
        <td className="px-4 py-2">
          <LevelBadge level={r.level} />
        </td>
      </tr>
    ));
  }

  if (tipo === "vendas") {
    const rows = data.sales?.rows ?? [];
    return rows.map((r) => (
      <tr key={r.key} className="hover:bg-slate-50">
        <td className="px-4 py-2 font-medium text-slate-800">{r.key}</td>
        <td className="px-4 py-2 text-right text-slate-700">{r.orders}</td>
        <td className="px-4 py-2 text-right text-slate-700">{fmtQty(r.quantity)}</td>
        <td className="px-4 py-2 text-right text-slate-600">{formatBRL(r.grossCents)}</td>
        <td className="px-4 py-2 text-right text-slate-600">{formatBRL(r.discountCents)}</td>
        <td className="px-4 py-2 text-right font-medium text-slate-800">{formatBRL(r.netCents)}</td>
        <td className="px-4 py-2 text-right text-slate-600">{formatBRL(r.costCents)}</td>
        <td className={`px-4 py-2 text-right font-medium ${r.marginCents >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {formatBRL(r.marginCents)}
        </td>
        <td className="px-4 py-2 text-right text-slate-600">{fmtPct(r.marginPct)}</td>
      </tr>
    ));
  }

  if (tipo === "compras") {
    const rows = data.purchases?.rows ?? [];
    return rows.map((r) => (
      <tr key={r.key} className="hover:bg-slate-50">
        <td className="px-4 py-2 font-medium text-slate-800">{r.key}</td>
        <td className="px-4 py-2 text-right text-slate-700">{r.orders}</td>
        <td className="px-4 py-2 text-right text-slate-700">{r.quantity > 0 ? fmtQty(r.quantity) : "—"}</td>
        <td className="px-4 py-2 text-right font-medium text-slate-800">{formatBRL(r.totalCents)}</td>
      </tr>
    ));
  }

  const rows = data.finance?.rows ?? [];
  void groupBy;
  return rows.map((r) => {
    const saldo = r.amountCents - r.paidCents;
    return (
      <tr key={r.accountId} className="hover:bg-slate-50">
        <td className={`px-4 py-2 ${r.status === "OVERDUE" ? "font-medium text-rose-600" : "text-slate-600"}`}>
          {formatDateOnly(r.dueDate)}
        </td>
        <td className="px-4 py-2">
          <Link
            href={`/financeiro/${r.accountId}`}
            className="font-medium text-indigo-600 hover:text-indigo-800"
          >
            {r.description}
          </Link>
        </td>
        <td className="px-4 py-2 text-slate-600">
          {r.installmentNumber && r.installmentCount
            ? `${r.installmentNumber}/${r.installmentCount}`
            : "—"}
        </td>
        <td className="px-4 py-2 text-right font-medium text-slate-800">{formatBRL(r.amountCents)}</td>
        <td className="px-4 py-2 text-right text-slate-600">{r.paidCents > 0 ? formatBRL(r.paidCents) : "—"}</td>
        <td className="px-4 py-2 text-right text-slate-700">{saldo > 0 ? formatBRL(saldo) : "—"}</td>
        <td className="px-4 py-2">
          <StatusBadge status={r.status} />
        </td>
        <td className="px-4 py-2 text-slate-600">{SOURCE_LABEL[r.source] ?? r.source}</td>
      </tr>
    );
  });
}
