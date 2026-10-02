// Regras puras dos relatórios (Fase 12) — sem banco, sem sessão.
// CSV: separador ";" + BOM UTF-8 (Excel pt-BR); dinheiro/quantidade
// formatados em pt-BR dentro dos campos (o ";" evita colisão com "," decimal).

export const REPORT_TIPOS = [
  "estoque",
  "vendas",
  "compras",
  "financeiro",
] as const;

export type ReportTipo = (typeof REPORT_TIPOS)[number];

export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportError";
  }
}

export function assertReportTipo(tipo: string): ReportTipo {
  if (!(REPORT_TIPOS as readonly string[]).includes(tipo)) {
    throw new ReportError("Relatório inválido.");
  }
  return tipo as ReportTipo;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Valida "YYYY-MM-DD" de verdade (mês/dia reais, ano bissexto). */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/**
 * Normaliza o período do relatório. Aceita `{}` (sem filtro), só uma das
 * datas ou as duas; lança ReportError se a ordem ou o formato estiver errado.
 */
export function normalizeRange(
  de?: string,
  ate?: string,
): { de?: string; ate?: string } {
  const d = (de ?? "").trim();
  const a = (ate ?? "").trim();
  if (d && !isIsoDate(d)) {
    throw new ReportError("Data inicial do período inválida.");
  }
  if (a && !isIsoDate(a)) {
    throw new ReportError("Data final do período inválida.");
  }
  if (d && a && d > a) {
    throw new ReportError(
      "Período inválido: a data inicial não pode ser posterior à final.",
    );
  }
  return { de: d || undefined, ate: a || undefined };
}

export type StockLevel = "CRITICO" | "BAIXO" | "OK";

/**
 * Classificação do saldo vs mínimo:
 * - CRITICO: sem saldo (≤ 0), com ou sem mínimo;
 * - BAIXO: tem saldo, mas atingiu/baixou do mínimo configurado;
 * - OK: acima do mínimo (ou sem mínimo configurado).
 */
export function classifyStockLevel(
  quantity: number,
  minStock: number,
): StockLevel {
  if (quantity <= 0) return "CRITICO";
  if (minStock > 0 && quantity <= minStock) return "BAIXO";
  return "OK";
}

/** Valor do estoque em centavos: qtd (decimal) × custo unitário (centavos). */
export function stockValueCents(quantity: number, unitCostCents: number): number {
  return Math.round(quantity * unitCostCents);
}

/**
 * Margem: R$ (centavos) e % **sobre o custo** (padrão aprovado do projeto).
 * Sem custo (> 0) o percentual é null — nunca divide por zero.
 */
export function calcMargin(
  revenueCents: number,
  costCents: number,
): { marginCents: number; marginPct: number | null } {
  const marginCents = revenueCents - costCents;
  const marginPct =
    costCents > 0
      ? Math.round((marginCents / costCents) * 100 * 100) / 100
      : null;
  return { marginCents, marginPct };
}

/** Escapa um campo CSV (separador ";", aspas duplas, quebras de linha). */
export function escapeCsvField(value: string | number): string {
  const s = String(value);
  if (s.includes(";") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Monta o CSV completo: BOM UTF-8 (Excel reconhece acentos) + CRLF.
 * `rows` chega com strings/números já formatados (usar csvMoney/csvQty).
 */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [
    headers.map(escapeCsvField).join(";"),
    ...rows.map((row) => row.map(escapeCsvField).join(";")),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Centavos → "1.234,56" (pt-BR). */
export function csvMoney(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Quantidade decimal → "10,125" (até 3 casas, sem zeros à direita). */
export function csvQty(quantity: number): string {
  return quantity.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

/** Nome do arquivo exportado (ASCII, seguro para Content-Disposition). */
export function buildCsvFilename(
  tipo: ReportTipo,
  de?: string,
  ate?: string,
): string {
  const partes = [`relatorio-${tipo}`];
  if (de) partes.push(de);
  if (ate && ate !== de) partes.push(ate);
  return `${partes.join("_")}.csv`;
}

/** Página do filtro → inteiro ≥ 1 (valor inválido volta para 1). */
export function clampPage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Total de páginas (mínimo 1 para a UI não quebrar com 0 resultados). */
export function totalPages(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Fatia a lista agregada para a página atual (agregados vêm sem SQL paginado). */
export function paginate<T>(
  rows: T[],
  page: number,
  pageSize: number,
): { rows: T[]; total: number; page: number } {
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    total: rows.length,
    page: safePage,
  };
}

// ---------------------------------------------------------------------------
// Agregadores puros — o service busca as linhas "fato" e aqui montamos os
// totais testáveis sem banco (TDD em tests/unit/report-rules.test.ts).
// ---------------------------------------------------------------------------

export type SaleFact = {
  saleId: string;
  billedDay: string; // YYYY-MM-DD (UTC — regra de datas do projeto)
  sellerId: string | null;
  sellerName: string | null;
  quantity: number; // itens da venda
  grossCents: number; // subtotal
  discountCents: number; // desconto de item + de pedido
  netCents: number; // total faturado
  costCents: number; // movimentos SAIDA_VENDA da venda
};

export type SaleItemFact = {
  saleId: string;
  productId: string;
  productName: string;
  quantity: number;
  grossCents: number; // qty × preço
  itemDiscountCents: number;
  costCents: number; // movimentos SAIDA_VENDA do produto
};

/** Linha agregada de vendas (dia/vendedor/produto). */
export type SalesAggregateRow = {
  key: string;
  orders: number;
  quantity: number;
  grossCents: number;
  discountCents: number;
  netCents: number;
  costCents: number;
  marginCents: number;
  marginPct: number | null;
};

function salesRow(
  key: string,
  acc: {
    orders: number;
    quantity: number;
    grossCents: number;
    discountCents: number;
    netCents: number;
    costCents: number;
  },
): SalesAggregateRow {
  const { marginCents, marginPct } = calcMargin(acc.netCents, acc.costCents);
  return { key, ...acc, marginCents, marginPct };
}

function emptySalesAcc() {
  return {
    orders: 0,
    quantity: 0,
    grossCents: 0,
    discountCents: 0,
    netCents: 0,
    costCents: 0,
  };
}

const NO_SELLER_KEY = "(sem vendedor)";

/** Vendas agrupadas por dia de faturamento (UTC) — mais recente primeiro. */
export function aggregateSalesByDay(facts: SaleFact[]): SalesAggregateRow[] {
  const map = new Map<string, ReturnType<typeof emptySalesAcc>>();
  for (const f of facts) {
    const acc = map.get(f.billedDay) ?? emptySalesAcc();
    acc.orders += 1;
    acc.quantity += f.quantity;
    acc.grossCents += f.grossCents;
    acc.discountCents += f.discountCents;
    acc.netCents += f.netCents;
    acc.costCents += f.costCents;
    map.set(f.billedDay, acc);
  }
  return [...map.entries()]
    .map(([key, acc]) => salesRow(key, acc))
    .sort((a, b) => b.key.localeCompare(a.key));
}

/** Vendas agrupadas por vendedor — maior faturamento primeiro. */
export function aggregateSalesBySeller(facts: SaleFact[]): SalesAggregateRow[] {
  const map = new Map<string, ReturnType<typeof emptySalesAcc>>();
  for (const f of facts) {
    const key = f.sellerName ?? NO_SELLER_KEY;
    const acc = map.get(key) ?? emptySalesAcc();
    acc.orders += 1;
    acc.quantity += f.quantity;
    acc.grossCents += f.grossCents;
    acc.discountCents += f.discountCents;
    acc.netCents += f.netCents;
    acc.costCents += f.costCents;
    map.set(key, acc);
  }
  return [...map.entries()]
    .map(([key, acc]) => salesRow(key, acc))
    .sort((a, b) => b.netCents - a.netCents || a.key.localeCompare(b.key));
}

/**
 * Vendas agrupadas por produto (grão de item). A receita é o lineTotal dos
 * itens (desconto de pedido não é rateado por produto na v1 — a receita
 * líquida com desconto de pedido aparece nos agrupamentos dia/vendedor).
 * `orders` = nº de vendas distintas que levaram o produto.
 */
export function aggregateSalesByProduct(
  facts: SaleItemFact[],
): SalesAggregateRow[] {
  const map = new Map<
    string,
    ReturnType<typeof emptySalesAcc> & { saleIds: Set<string> }
  >();
  for (const f of facts) {
    const acc =
      map.get(f.productName) ??
      ({ ...emptySalesAcc(), saleIds: new Set<string>() });
    acc.saleIds.add(f.saleId);
    acc.quantity += f.quantity;
    acc.grossCents += f.grossCents;
    acc.discountCents += f.itemDiscountCents;
    acc.netCents += f.grossCents - f.itemDiscountCents;
    acc.costCents += f.costCents;
    map.set(f.productName, acc);
  }
  return [...map.entries()]
    .map(([key, acc]) => {
      const { saleIds, ...rest } = acc;
      return salesRow(key, { ...rest, orders: saleIds.size });
    })
    .sort((a, b) => b.netCents - a.netCents || a.key.localeCompare(b.key));
}

export type PurchaseFact = {
  entryId: string;
  entryDay: string; // YYYY-MM-DD (UTC) — entryDate é coluna date
  supplierId: string;
  supplierName: string;
  totalCents: number;
};

export type PurchaseItemFact = {
  entryId: string;
  productId: string;
  productName: string;
  quantity: number;
  totalCents: number;
};

export type PurchaseAggregateRow = {
  key: string;
  orders: number; // notas
  quantity: number;
  totalCents: number;
};

/** Compras agrupadas por fornecedor — maior total primeiro. */
export function aggregatePurchasesBySupplier(
  facts: PurchaseFact[],
): PurchaseAggregateRow[] {
  const map = new Map<string, { orders: number; totalCents: number }>();
  for (const f of facts) {
    const acc = map.get(f.supplierName) ?? { orders: 0, totalCents: 0 };
    acc.orders += 1;
    acc.totalCents += f.totalCents;
    map.set(f.supplierName, acc);
  }
  return [...map.entries()]
    .map(([key, acc]) => ({ key, quantity: 0, ...acc }))
    .sort((a, b) => b.totalCents - a.totalCents || a.key.localeCompare(b.key));
}

/** Compras agrupadas por produto (grão de item) — maior total primeiro.
 * `orders` = nº de notas distintas que compraram o produto. */
export function aggregatePurchasesByProduct(
  facts: PurchaseItemFact[],
): PurchaseAggregateRow[] {
  const map = new Map<
    string,
    { quantity: number; totalCents: number; entryIds: Set<string> }
  >();
  for (const f of facts) {
    const acc =
      map.get(f.productName) ??
      { quantity: 0, totalCents: 0, entryIds: new Set<string>() };
    acc.quantity += f.quantity;
    acc.totalCents += f.totalCents;
    acc.entryIds.add(f.entryId);
    map.set(f.productName, acc);
  }
  return [...map.entries()]
    .map(([key, acc]) => ({
      key,
      orders: acc.entryIds.size,
      quantity: acc.quantity,
      totalCents: acc.totalCents,
    }))
    .sort((a, b) => b.totalCents - a.totalCents || a.key.localeCompare(b.key));
}

export type AccountFact = {
  accountId: string;
  direction: "RECEIVABLE" | "PAYABLE";
  status: "OPEN" | "PARTIAL" | "OVERDUE" | "PAID" | "CANCELLED";
  dueDate: string; // YYYY-MM-DD
  amountCents: number;
  paidCents: number;
};

export type AccountsSummary = {
  byStatus: Record<
    AccountFact["status"],
    { count: number; amountCents: number; paidCents: number }
  >;
  /** OPEN + PARTIAL + OVERDUE: saldo ainda em aberto (amount − paid). */
  openCents: number;
  /** OVERDUE (inadimplência): saldo em aberto de conta vencida. */
  overdueCents: number;
  overdueCount: number;
  /** Contas vencidas de hoje (não pagas) — usadas pelo relatório financeiro. */
  today: string;
};

export function emptyAccountsSummary(today: string): AccountsSummary {
  const byStatus = {} as AccountsSummary["byStatus"];
  for (const s of ["OPEN", "PARTIAL", "OVERDUE", "PAID", "CANCELLED"] as const) {
    byStatus[s] = { count: 0, amountCents: 0, paidCents: 0 };
  }
  return { byStatus, openCents: 0, overdueCents: 0, overdueCount: 0, today };
}

/**
 * Resumo por status do financeiro (pure — recebe as contas do período).
 * `today` (YYYY-MM-DD) define o que é "vencida hoje" quando o status ainda
 * não foi recalculado pelo cron (defesa em profundidade do relatório).
 */
export function summarizeAccounts(
  facts: AccountFact[],
  today: string,
): AccountsSummary {
  const out = emptyAccountsSummary(today);
  for (const f of facts) {
    const acc = out.byStatus[f.status];
    acc.count += 1;
    acc.amountCents += f.amountCents;
    acc.paidCents += f.paidCents;
    if (f.status === "OPEN" || f.status === "PARTIAL" || f.status === "OVERDUE") {
      out.openCents += f.amountCents - f.paidCents;
    }
    const overdueByStatus = f.status === "OVERDUE";
    const overdueByDate =
      (f.status === "OPEN" || f.status === "PARTIAL") && f.dueDate < today;
    if (overdueByStatus || overdueByDate) {
      out.overdueCents += f.amountCents - f.paidCents;
      out.overdueCount += 1;
    }
  }
  return out;
}
