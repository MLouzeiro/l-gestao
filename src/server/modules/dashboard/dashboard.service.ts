import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { financialAccounts, salesOrders } from "@/server/db/schema";
import { localDayEnd, localDayStart, todayInputValue } from "@/lib/dates";
import { toCents } from "@/lib/money";
import type { TenantTx } from "@/server/tenant/with-tenant";
import {
  getFinanceReport,
  getSalesReport,
  getStockReport,
} from "@/server/modules/relatorios/report.service";
import type { AccountFact } from "@/server/modules/relatorios/report-rules";
import {
  buildDailySeries,
  nextDueAccounts,
  rankSellers,
  summarizeFunnel,
  ticketAvgCents,
  type DailyPoint,
  type Funnel,
} from "./dashboard-rules";

// Serviço do dashboard (Fase 13): visão geral do tenant em um período.
// Reusa os services da Fase 12 (vendas/estoque/financeiro) + 2 consultas
// leves (funil de vendas e próximos vencimentos). Queries sequenciais no
// mesmo tx (regra pg@9 — nada de Promise.all no mesmo client).

export type DashboardFilters = { de: string; ate: string };

export type DashboardData = {
  period: { de: string; ate: string; days: number };
  sales: {
    billedOrders: number;
    netCents: number;
    ticketAvgCents: number | null;
  };
  series: DailyPoint[];
  funnel: Funnel;
  stock: { items: number; critical: number; low: number; valueCents: number };
  finance: { overdueCents: number; overdueCount: number; openCents: number };
  topSellers: { key: string; orders: number; netCents: number }[];
  nextDue: {
    accountId: string;
    description: string;
    dueDate: string;
    status: AccountFact["status"];
    openCents: number;
  }[];
};

const TOP_SELLERS_LIMIT = 5;
const NEXT_DUE_LIMIT = 5;

const DAY_MS = 86_400_000;

// Limites de filtro = dia de negócio LOCAL (relógio de parede, decisão F11).
function dayStartMs(iso: string): Date {
  return localDayStart(iso);
}

function dayEndMs(iso: string): Date {
  return localDayEnd(iso);
}

export async function getDashboard(
  tx: TenantTx,
  tenantId: string,
  filters: DashboardFilters,
): Promise<DashboardData> {
  const { de, ate } = filters;

  const byDay = await getSalesReport(
    tx,
    tenantId,
    { de, ate, groupBy: "dia", page: 1, pageSize: 1 },
    { all: true },
  );
  const series = buildDailySeries(de, ate, byDay.rows);
  const ticket = ticketAvgCents(byDay.summary.netCents, byDay.summary.orders);

  const bySeller = await getSalesReport(
    tx,
    tenantId,
    { de, ate, groupBy: "vendedor", page: 1, pageSize: 1 },
    { all: true },
  );
  const topSellers = rankSellers(bySeller.rows, TOP_SELLERS_LIMIT).map((r) => ({
    key: r.key,
    orders: r.orders,
    netCents: r.netCents,
  }));

  const statusRows = await tx
    .select({ status: salesOrders.status })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.tenantId, tenantId),
        gte(salesOrders.createdAt, dayStartMs(de)),
        lte(salesOrders.createdAt, dayEndMs(ate)),
      ),
    );
  const funnel = summarizeFunnel(statusRows);

  const stock = await getStockReport(tx, tenantId, {
    page: 1,
    pageSize: 1,
  });

  const today = todayInputValue();
  const finance = await getFinanceReport(tx, tenantId, {
    direction: "RECEIVABLE",
    page: 1,
    pageSize: 1,
  });

  const dueRows = await tx
    .select({
      accountId: financialAccounts.id,
      description: financialAccounts.description,
      dueDate: financialAccounts.dueDate,
      amount: financialAccounts.amount,
      paidAmount: financialAccounts.paidAmount,
      status: financialAccounts.status,
    })
    .from(financialAccounts)
    .where(
      and(
        eq(financialAccounts.tenantId, tenantId),
        eq(financialAccounts.direction, "RECEIVABLE"),
        inArray(financialAccounts.status, ["OPEN", "PARTIAL", "OVERDUE"]),
        gte(financialAccounts.dueDate, dayStartMs(today)),
      ),
    )
    .orderBy(asc(financialAccounts.dueDate), asc(financialAccounts.id))
    .limit(NEXT_DUE_LIMIT);

  const dueFacts: AccountFact[] = dueRows.map((a) => ({
    accountId: a.accountId,
    direction: "RECEIVABLE",
    status: a.status,
    dueDate: a.dueDate.toISOString().slice(0, 10),
    amountCents: toCents(a.amount),
    paidCents: toCents(a.paidAmount),
  }));
  const nextDue = nextDueAccounts(dueFacts, today, NEXT_DUE_LIMIT).map((f) => {
    const row = dueRows.find((r) => r.accountId === f.accountId);
    return {
      accountId: f.accountId,
      description: row?.description ?? f.accountId,
      dueDate: f.dueDate,
      status: f.status,
      openCents: f.amountCents - f.paidCents,
    };
  });

  const days =
    Math.round(
      (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) /
        DAY_MS,
    ) + 1;

  return {
    period: { de, ate, days },
    sales: {
      billedOrders: byDay.summary.orders,
      netCents: byDay.summary.netCents,
      ticketAvgCents: ticket,
    },
    series,
    funnel,
    stock: {
      items: stock.summary.items,
      critical: stock.summary.critical,
      low: stock.summary.low,
      valueCents: stock.summary.valueCents,
    },
    finance: {
      overdueCents: finance.summary.accounts.overdueCents,
      overdueCount: finance.summary.accounts.overdueCount,
      openCents: finance.summary.accounts.openCents,
    },
    topSellers,
    nextDue,
  };
}
