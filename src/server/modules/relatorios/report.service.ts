import { and, asc, desc, eq, gte, inArray, ilike, isNotNull, lte, or, sql } from "drizzle-orm";
import {
  financialAccounts,
  financialPayments,
  products,
  purchaseEntries,
  purchaseEntryItems,
  salesOrderItems,
  salesOrders,
  stockBalances,
  stockMovements,
  suppliers,
  users,
  warehouses,
} from "@/server/db/schema";
import { toCents } from "@/lib/money";
import { localDayEnd, localDayKey, localDayStart } from "@/lib/dates";
import type { TenantTx } from "@/server/tenant/with-tenant";
import type { FinancialStatus } from "@/server/modules/financeiro/financial-rules";
import {
  aggregatePurchasesByProduct,
  aggregatePurchasesBySupplier,
  aggregateSalesByDay,
  aggregateSalesByProduct,
  aggregateSalesBySeller,
  classifyStockLevel,
  paginate,
  stockValueCents,
  summarizeAccounts,
  type AccountFact,
  type AccountsSummary,
  type PurchaseAggregateRow,
  type PurchaseFact,
  type PurchaseItemFact,
  type SalesAggregateRow,
  type SaleFact,
  type SaleItemFact,
  type StockLevel,
} from "./report-rules";

// Serviço de relatórios (Fase 12): buscas agregadas em withTenant.
// As agregações rodam em funções puras (report-rules) — aqui só buscamos os
// fatos. `opts.all` ignora paginação (exportação CSV).

export type PageOpts = { all?: boolean };

// Limites de filtro = dia de negócio LOCAL (relógio de parede, decisão F11) —
// um timestamptz de 23h BRT pertence ao dia local, não ao dia UTC.
function dayStart(iso: string): Date {
  return localDayStart(iso);
}

function dayEnd(iso: string): Date {
  return localDayEnd(iso);
}

// Dia de negócio = dia local (relógio de parede), como as colunas `date`
// são gravadas via asUtcDay (decisão F11) — nunca o dia UTC.
function todayLocal(): string {
  return localDayKey(new Date());
}

function sanitizeLike(q: string): string {
  return q.replace(/[%_]/g, " ").trim();
}

function centsOf(value: string): number {
  return toCents(value);
}

/** Aplica paginação padrão da UI (ou tudo quando `all` — export CSV). */
function pageRows<T>(
  rows: T[],
  opts: PageOpts | undefined,
  page: number,
  pageSize: number,
): { rows: T[]; total: number } {
  if (opts?.all) return { rows, total: rows.length };
  return paginate(rows, page, pageSize);
}

// ---------------------------------------------------------------------------
// 1) Estoque — posição por produto × depósito com valor e classificação
// ---------------------------------------------------------------------------

export type StockReportFilters = {
  de?: string;
  ate?: string;
  q?: string;
  warehouseId?: string;
  level?: StockLevel;
  page: number;
  pageSize: number;
};

export type StockReportRow = {
  productId: string;
  sku: string;
  name: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  reserved: number;
  available: number;
  minStock: number;
  costCents: number;
  valueCents: number;
  level: StockLevel;
};

export type StockReportSummary = {
  items: number;
  valueCents: number;
  critical: number;
  low: number;
  ok: number;
};

const LEVEL_ORDER: Record<StockLevel, number> = {
  CRITICO: 0,
  BAIXO: 1,
  OK: 2,
};

export async function getStockReport(
  tx: TenantTx,
  tenantId: string,
  filters: StockReportFilters,
  opts?: PageOpts,
): Promise<{
  rows: StockReportRow[];
  total: number;
  summary: StockReportSummary;
}> {
  const conditions = [
    eq(stockBalances.tenantId, tenantId),
    eq(products.tenantId, tenantId),
    sql`${products.deletedAt} IS NULL`,
    sql`${warehouses.deletedAt} IS NULL`,
  ];
  if (filters.q) {
    const like = `%${sanitizeLike(filters.q)}%`;
    conditions.push(
      or(ilike(products.name, like), ilike(products.sku, like))!,
    );
  }
  if (filters.warehouseId) {
    conditions.push(eq(warehouses.id, filters.warehouseId));
  }

  const found = await tx
    .select({
      productId: products.id,
      sku: products.sku,
      name: products.name,
      minStock: products.minStock,
      costPrice: products.costPrice,
      warehouseId: warehouses.id,
      warehouseName: warehouses.name,
      quantity: stockBalances.quantity,
      reserved: stockBalances.reserved,
    })
    .from(stockBalances)
    .innerJoin(
      products,
      and(
        eq(stockBalances.productId, products.id),
        eq(products.tenantId, stockBalances.tenantId),
      ),
    )
    .innerJoin(
      warehouses,
      and(
        eq(stockBalances.warehouseId, warehouses.id),
        eq(warehouses.tenantId, stockBalances.tenantId),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(products.name));

  const all: StockReportRow[] = found.map((r) => {
    const quantity = parseFloat(r.quantity);
    const reserved = parseFloat(r.reserved);
    const costCents = centsOf(r.costPrice);
    const level = classifyStockLevel(quantity, parseFloat(r.minStock));
    return {
      productId: r.productId,
      sku: r.sku,
      name: r.name,
      warehouseId: r.warehouseId,
      warehouseName: r.warehouseName,
      quantity,
      reserved,
      available: quantity - reserved,
      minStock: parseFloat(r.minStock),
      costCents,
      valueCents: stockValueCents(quantity, costCents),
      level,
    };
  });

  const filtered = filters.level
    ? all.filter((r) => r.level === filters.level)
    : all;

  const summary: StockReportSummary = {
    items: filtered.length,
    valueCents: filtered.reduce((s, r) => s + r.valueCents, 0),
    critical: filtered.filter((r) => r.level === "CRITICO").length,
    low: filtered.filter((r) => r.level === "BAIXO").length,
    ok: filtered.filter((r) => r.level === "OK").length,
  };
  filtered.sort(
    (a, b) =>
      LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
      a.name.localeCompare(b.name, "pt-BR") ||
      a.warehouseName.localeCompare(b.warehouseName, "pt-BR"),
  );

  const page = pageRows(filtered, opts, filters.page, filters.pageSize);
  return { rows: page.rows, total: page.total, summary };
}

// ---------------------------------------------------------------------------
// 2) Vendas por período — agrupada por dia, vendedor ou produto
// ---------------------------------------------------------------------------

export type SalesGroupBy = "dia" | "vendedor" | "produto";

export type SalesReportFilters = {
  de?: string;
  ate?: string;
  sellerId?: string;
  groupBy: SalesGroupBy;
  page: number;
  pageSize: number;
};

export type SalesReportSummary = {
  orders: number;
  quantity: number;
  grossCents: number;
  discountCents: number;
  netCents: number;
  costCents: number;
  marginCents: number;
  marginPct: number | null;
};

export type SalesReportRow = SalesAggregateRow;

function salesSummary(facts: SaleFact[]): SalesReportSummary {
  const s = {
    orders: facts.length,
    quantity: 0,
    grossCents: 0,
    discountCents: 0,
    netCents: 0,
    costCents: 0,
  };
  for (const f of facts) {
    s.quantity += f.quantity;
    s.grossCents += f.grossCents;
    s.discountCents += f.discountCents;
    s.netCents += f.netCents;
    s.costCents += f.costCents;
  }
  const marginCents = s.netCents - s.costCents;
  const marginPct =
    s.costCents > 0
      ? Math.round((marginCents / s.costCents) * 100 * 100) / 100
      : null;
  return { ...s, marginCents, marginPct };
}

export async function getSalesReport(
  tx: TenantTx,
  tenantId: string,
  filters: SalesReportFilters,
  opts?: PageOpts,
): Promise<{
  rows: SalesAggregateRow[];
  total: number;
  summary: SalesReportSummary;
}> {
  const conditions = [
    eq(salesOrders.tenantId, tenantId),
    eq(salesOrders.status, "BILLED"),
    isNotNull(salesOrders.billedAt),
  ];
  if (filters.de) conditions.push(gte(salesOrders.billedAt, dayStart(filters.de)));
  if (filters.ate) conditions.push(lte(salesOrders.billedAt, dayEnd(filters.ate)));
  if (filters.sellerId) conditions.push(eq(salesOrders.sellerId, filters.sellerId));

  const sales = await tx
    .select({
      id: salesOrders.id,
      billedAt: salesOrders.billedAt,
      sellerId: salesOrders.sellerId,
      sellerName: users.name,
      subtotal: salesOrders.subtotal,
      itemDiscount: salesOrders.itemDiscount,
      orderDiscount: salesOrders.orderDiscount,
      total: salesOrders.total,
    })
    .from(salesOrders)
    .leftJoin(users, eq(salesOrders.sellerId, users.id))
    .where(and(...conditions))
    .orderBy(desc(salesOrders.billedAt));

  if (sales.length === 0) {
    return {
      rows: [],
      total: 0,
      summary: salesSummary([]),
    };
  }

  const saleIds = sales.map((s) => s.id);

  const movementConds = [
    eq(stockMovements.tenantId, tenantId),
    eq(stockMovements.type, "SAIDA_VENDA"),
    eq(stockMovements.referenceType, "SALE"),
    inArray(stockMovements.referenceId, saleIds),
  ];
  if (filters.de) movementConds.push(gte(stockMovements.occurredAt, dayStart(filters.de)));
  if (filters.ate) movementConds.push(lte(stockMovements.occurredAt, dayEnd(filters.ate)));

  // itens (qtd por venda + fatos p/ agrupamento por produto)
  const items = await tx
    .select({
      saleId: salesOrderItems.salesOrderId,
      productId: salesOrderItems.productId,
      productName: products.name,
      quantity: salesOrderItems.quantity,
      unitPrice: salesOrderItems.unitPrice,
      discount: salesOrderItems.discount,
    })
    .from(salesOrderItems)
    .innerJoin(
      products,
      and(
        eq(salesOrderItems.productId, products.id),
        eq(products.tenantId, salesOrderItems.tenantId),
      ),
    )
    .where(
      and(
        eq(salesOrderItems.tenantId, tenantId),
        inArray(salesOrderItems.salesOrderId, saleIds),
      ),
    );
  // custo (SAIDA_VENDA) por venda
  const costBySale = await tx
    .select({
      saleId: stockMovements.referenceId,
      cost: sql<string>`coalesce(sum(${stockMovements.totalCost}), 0)`,
    })
    .from(stockMovements)
    .where(and(...movementConds))
    .groupBy(stockMovements.referenceId);
  // custo por venda × produto (agrupamento produto)
  const costBySaleProduct =
    filters.groupBy === "produto"
      ? await tx
          .select({
            saleId: stockMovements.referenceId,
            productId: stockMovements.productId,
            cost: sql<string>`coalesce(sum(${stockMovements.totalCost}), 0)`,
          })
          .from(stockMovements)
          .where(and(...movementConds))
          .groupBy(stockMovements.referenceId, stockMovements.productId)
      : [];

  const qtyBySale = new Map<string, number>();
  for (const it of items) {
    const prev = qtyBySale.get(it.saleId) ?? 0;
    qtyBySale.set(it.saleId, prev + parseFloat(it.quantity));
  }
  const costSaleMap = new Map<string, number>();
  for (const c of costBySale) {
    if (c.saleId) costSaleMap.set(c.saleId, centsOf(c.cost));
  }
  const costProductMap = new Map<string, number>();
  for (const c of costBySaleProduct) {
    if (c.saleId) costProductMap.set(`${c.saleId}:${c.productId}`, centsOf(c.cost));
  }

  const facts: SaleFact[] = sales.map((s) => ({
    saleId: s.id,
    billedDay: s.billedAt ? localDayKey(s.billedAt) : "",
    sellerId: s.sellerId,
    sellerName: s.sellerName,
    quantity: qtyBySale.get(s.id) ?? 0,
    grossCents: centsOf(s.subtotal),
    discountCents: centsOf(s.itemDiscount) + centsOf(s.orderDiscount),
    netCents: centsOf(s.total),
    costCents: costSaleMap.get(s.id) ?? 0,
  }));

  let rows: SalesAggregateRow[];
  if (filters.groupBy === "dia") {
    rows = aggregateSalesByDay(facts);
  } else if (filters.groupBy === "vendedor") {
    rows = aggregateSalesBySeller(facts);
  } else {
    const itemFacts: SaleItemFact[] = items.map((it) => ({
      saleId: it.saleId,
      productId: it.productId,
      productName: it.productName,
      quantity: parseFloat(it.quantity),
      grossCents: Math.round(parseFloat(it.quantity) * centsOf(it.unitPrice)),
      itemDiscountCents: centsOf(it.discount),
      costCents: costProductMap.get(`${it.saleId}:${it.productId}`) ?? 0,
    }));
    rows = aggregateSalesByProduct(itemFacts);
  }

  const page = pageRows(rows, opts, filters.page, filters.pageSize);
  return { rows: page.rows, total: page.total, summary: salesSummary(facts) };
}

// ---------------------------------------------------------------------------
// 3) Compras por período — agrupada por fornecedor ou produto
// ---------------------------------------------------------------------------

export type PurchasesGroupBy = "fornecedor" | "produto";

export type PurchasesReportFilters = {
  de?: string;
  ate?: string;
  supplierId?: string;
  groupBy: PurchasesGroupBy;
  page: number;
  pageSize: number;
};

export type PurchasesReportSummary = {
  orders: number;
  totalCents: number;
};

export type PurchasesReportRow = PurchaseAggregateRow;

export async function getPurchasesReport(
  tx: TenantTx,
  tenantId: string,
  filters: PurchasesReportFilters,
  opts?: PageOpts,
): Promise<{
  rows: PurchaseAggregateRow[];
  total: number;
  summary: PurchasesReportSummary;
}> {
  const conditions = [
    eq(purchaseEntries.tenantId, tenantId),
    eq(purchaseEntries.status, "CONFIRMED"),
  ];
  if (filters.de) conditions.push(gte(purchaseEntries.entryDate, dayStart(filters.de)));
  if (filters.ate) conditions.push(lte(purchaseEntries.entryDate, dayEnd(filters.ate)));
  if (filters.supplierId) conditions.push(eq(purchaseEntries.supplierId, filters.supplierId));

  const entries = await tx
    .select({
      id: purchaseEntries.id,
      entryDate: purchaseEntries.entryDate,
      supplierId: purchaseEntries.supplierId,
      supplierName: suppliers.name,
      total: purchaseEntries.total,
    })
    .from(purchaseEntries)
    .innerJoin(
      suppliers,
      and(
        eq(purchaseEntries.supplierId, suppliers.id),
        eq(suppliers.tenantId, purchaseEntries.tenantId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(purchaseEntries.entryDate));

  const summary: PurchasesReportSummary = {
    orders: entries.length,
    totalCents: entries.reduce((s, e) => s + centsOf(e.total), 0),
  };

  if (entries.length === 0) {
    return { rows: [], total: 0, summary };
  }

  let rows: PurchaseAggregateRow[];
  if (filters.groupBy === "fornecedor") {
    const facts: PurchaseFact[] = entries.map((e) => ({
      entryId: e.id,
      entryDay: e.entryDate.toISOString().slice(0, 10),
      supplierId: e.supplierId,
      supplierName: e.supplierName,
      totalCents: centsOf(e.total),
    }));
    rows = aggregatePurchasesBySupplier(facts);
  } else {
    const entryIds = entries.map((e) => e.id);
    const items = await tx
      .select({
        entryId: purchaseEntryItems.purchaseEntryId,
        productId: purchaseEntryItems.productId,
        productName: products.name,
        quantity: purchaseEntryItems.quantity,
        totalCost: purchaseEntryItems.totalCost,
      })
      .from(purchaseEntryItems)
      .innerJoin(
        products,
        and(
          eq(purchaseEntryItems.productId, products.id),
          eq(products.tenantId, purchaseEntryItems.tenantId),
        ),
      )
      .where(
        and(
          eq(purchaseEntryItems.tenantId, tenantId),
          inArray(purchaseEntryItems.purchaseEntryId, entryIds),
        ),
      );
    const itemFacts: PurchaseItemFact[] = items.map((it) => ({
      entryId: it.entryId,
      productId: it.productId,
      productName: it.productName,
      quantity: parseFloat(it.quantity),
      totalCents: centsOf(it.totalCost ?? "0"),
    }));
    rows = aggregatePurchasesByProduct(itemFacts);
  }

  const page = pageRows(rows, opts, filters.page, filters.pageSize);
  return { rows: page.rows, total: page.total, summary };
}

// ---------------------------------------------------------------------------
// 4) Financeiro — contas do período por vencimento + baixas + resumo
// ---------------------------------------------------------------------------

export type FinanceReportFilters = {
  de?: string;
  ate?: string;
  direction: "RECEIVABLE" | "PAYABLE";
  status?: FinancialStatus;
  page: number;
  pageSize: number;
};

export type FinanceReportRow = {
  accountId: string;
  description: string;
  dueDate: Date;
  installmentNumber: number | null;
  installmentCount: number | null;
  amountCents: number;
  paidCents: number;
  status: FinancialStatus;
  source: string;
};

export type FinanceReportSummary = {
  accounts: AccountsSummary;
  payments: {
    count: number;
    amountCents: number;
    interestCents: number;
    discountCents: number;
  };
};

export async function getFinanceReport(
  tx: TenantTx,
  tenantId: string,
  filters: FinanceReportFilters,
  opts?: PageOpts,
): Promise<{
  rows: FinanceReportRow[];
  total: number;
  summary: FinanceReportSummary;
}> {
  const conditions = [
    eq(financialAccounts.tenantId, tenantId),
    eq(financialAccounts.direction, filters.direction),
  ];
  if (filters.de) conditions.push(gte(financialAccounts.dueDate, dayStart(filters.de)));
  if (filters.ate) conditions.push(lte(financialAccounts.dueDate, dayEnd(filters.ate)));
  if (filters.status) conditions.push(eq(financialAccounts.status, filters.status));

  const accounts = await tx
    .select({
      id: financialAccounts.id,
      description: financialAccounts.description,
      dueDate: financialAccounts.dueDate,
      installmentNumber: financialAccounts.installmentNumber,
      installmentCount: financialAccounts.installmentCount,
      amount: financialAccounts.amount,
      paidAmount: financialAccounts.paidAmount,
      status: financialAccounts.status,
      source: financialAccounts.source,
    })
    .from(financialAccounts)
    .where(and(...conditions))
    .orderBy(asc(financialAccounts.dueDate));

  const facts: AccountFact[] = accounts.map((a) => ({
    accountId: a.id,
    direction: filters.direction,
    status: a.status,
    dueDate: a.dueDate.toISOString().slice(0, 10),
    amountCents: centsOf(a.amount),
    paidCents: centsOf(a.paidAmount),
  }));
  const accountsSummary = summarizeAccounts(facts, todayLocal());

  // Baixas registradas no período (paidAt é coluna date)
  const paymentConds = [
    eq(financialPayments.tenantId, tenantId),
    eq(financialAccounts.direction, filters.direction),
  ];
  if (filters.de) paymentConds.push(gte(financialPayments.paidAt, dayStart(filters.de)));
  if (filters.ate) paymentConds.push(lte(financialPayments.paidAt, dayEnd(filters.ate)));

  const [paymentRow] = await tx
    .select({
      count: sql<string>`count(*)::int`,
      amount: sql<string>`coalesce(sum(${financialPayments.amount}), 0)`,
      interest: sql<string>`coalesce(sum(${financialPayments.interest}), 0)`,
      discount: sql<string>`coalesce(sum(${financialPayments.discount}), 0)`,
    })
    .from(financialPayments)
    .innerJoin(
      financialAccounts,
      and(
        eq(financialPayments.financialAccountId, financialAccounts.id),
        eq(financialPayments.tenantId, financialAccounts.tenantId),
      ),
    )
    .where(and(...paymentConds));

  const summary: FinanceReportSummary = {
    accounts: accountsSummary,
    payments: {
      count: Number(paymentRow?.count ?? 0),
      amountCents: centsOf(paymentRow?.amount ?? "0"),
      interestCents: centsOf(paymentRow?.interest ?? "0"),
      discountCents: centsOf(paymentRow?.discount ?? "0"),
    },
  };

  const allRows: FinanceReportRow[] = accounts.map((a) => ({
    accountId: a.id,
    description: a.description,
    dueDate: a.dueDate,
    installmentNumber: a.installmentNumber,
    installmentCount: a.installmentCount,
    amountCents: centsOf(a.amount),
    paidCents: centsOf(a.paidAmount),
    status: a.status,
    source: a.source,
  }));

  const page = pageRows(allRows, opts, filters.page, filters.pageSize);
  return { rows: page.rows, total: page.total, summary };
}
