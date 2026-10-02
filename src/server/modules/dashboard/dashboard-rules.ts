import {
  ReportError,
  normalizeRange,
  type AccountFact,
  type SalesAggregateRow,
} from "@/server/modules/relatorios/report-rules";

export const SALE_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "BILLED",
  "CANCELLED",
  "RETURNED",
] as const;

export type SaleStatus = (typeof SALE_STATUSES)[number];

/** Limite de dias da série diária do gráfico (defesa contra ranges absurdos). */
export const MAX_SERIES_DAYS = 366;

export type Funnel = Record<SaleStatus, number> & { total: number };

export type DailyPoint = { day: string; netCents: number; orders: number };

/**
 * Série diária preenchida (UTC) para o gráfico de faturamento: cada dia do
 * período aparece na ordem crescente; dias sem venda ficam com zero. Linhas
 * fora da janela são ignoradas; período obrigatório (erro se faltar/inverter
 * ou ultrapassar MAX_SERIES_DAYS).
 */
export function buildDailySeries(
  start: string,
  end: string,
  rows: SalesAggregateRow[],
): DailyPoint[] {
  const range = normalizeRange(start, end);
  if (!range.de || !range.ate) {
    throw new ReportError(
      "Período obrigatório para a série diária do dashboard.",
    );
  }
  const DAY_MS = 86_400_000;
  const startMs = Date.parse(`${range.de}T00:00:00Z`);
  const endMs = Date.parse(`${range.ate}T00:00:00Z`);
  const days = Math.round((endMs - startMs) / DAY_MS) + 1;
  if (days > MAX_SERIES_DAYS) {
    throw new ReportError(
      `Período longo demais para o gráfico (máx. ${MAX_SERIES_DAYS} dias).`,
    );
  }
  const byDay = new Map<string, SalesAggregateRow>();
  for (const r of rows) byDay.set(r.key, r);
  const points: DailyPoint[] = [];
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    const day = new Date(ms).toISOString().slice(0, 10);
    const row = byDay.get(day);
    points.push({ day, netCents: row?.netCents ?? 0, orders: row?.orders ?? 0 });
  }
  return points;
}

/** Funil de vendas: contagem por status (5 status do enum) + total. */
export function summarizeFunnel(
  orders: readonly { status: string }[],
): Funnel {
  const out: Funnel = {
    DRAFT: 0,
    CONFIRMED: 0,
    BILLED: 0,
    CANCELLED: 0,
    RETURNED: 0,
    total: 0,
  };
  for (const o of orders) {
    if ((SALE_STATUSES as readonly string[]).includes(o.status)) {
      out[o.status as SaleStatus] += 1;
      out.total += 1;
    }
  }
  return out;
}

/** Ticket médio em centavos (null quando não há vendas). */
export function ticketAvgCents(netCents: number, orders: number): number | null {
  if (orders <= 0) return null;
  return Math.round(netCents / orders);
}

/**
 * Top vendedores: ordena por maior faturamento (desempate por nome) e aplica
 * o limite — mesmo critério de aggregateSalesBySeller.
 */
export function rankSellers(
  rows: SalesAggregateRow[],
  limit: number,
): SalesAggregateRow[] {
  if (limit <= 0) return [];
  return [...rows]
    .sort((a, b) => b.netCents - a.netCents || a.key.localeCompare(b.key))
    .slice(0, limit);
}

const OPEN_STATUSES = ["OPEN", "PARTIAL", "OVERDUE"] as const;

/**
 * Próximos vencimentos a receber: em aberto (OPEN/PARTIAL/OVERDUE), vencimento
 * a partir de hoje, ordenado por data (vencidas ficam de fora — elas aparecem
 * no KPI de inadimplência, não em "próximos").
 */
export function nextDueAccounts(
  accounts: AccountFact[],
  today: string,
  limit: number,
): AccountFact[] {
  if (limit <= 0) return [];
  return accounts
    .filter(
      (a) =>
        a.direction === "RECEIVABLE" &&
        (OPEN_STATUSES as readonly string[]).includes(a.status) &&
        a.dueDate >= today,
    )
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        a.accountId.localeCompare(b.accountId),
    )
    .slice(0, limit);
}
