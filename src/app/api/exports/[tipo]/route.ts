import { and, eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/server/db/client";
import { members } from "@/server/db/schema";
import { formatDateOnly } from "@/lib/dates";
import {
  fieldErrorsOf,
  financeReportFilters,
  purchasesReportFilters,
  salesReportFilters,
  stockReportFilters,
} from "@/lib/validators/relatorios";
import {
  ReportError,
  assertReportTipo,
  buildCsvFilename,
  csvMoney,
  csvQty,
  normalizeRange,
  toCsv,
  type ReportTipo,
} from "@/server/modules/relatorios/report-rules";
import {
  getPurchasesReport,
  getSalesReport,
  getStockReport,
  getFinanceReport,
  type FinanceReportRow,
  type PurchasesReportRow,
  type SalesReportRow,
  type StockReportRow,
} from "@/server/modules/relatorios/report.service";
import { assertPermission, PermissionError } from "@/server/rbac/permissions";
import { withTenant } from "@/server/tenant/with-tenant";

// Export CSV dos relatórios (Fase 12) — rota dedicada (AGENTS.md).
// Mesmos filtros da página; `reports.view` obrigatória; RLS via withTenant.
// CSV: separador ";", BOM UTF-8 e dinheiro/quantidade em pt-BR (Excel BR).

function jsonError(status: number, error: string, extra?: object): Response {
  return Response.json({ error, ...extra }, { status });
}

function queryToObject(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (v !== "") out[k] = v;
  }
  return out;
}

function toCsvResponse(
  tipo: ReportTipo,
  csv: string,
  de?: string,
  ate?: string,
): Response {
  const filename = buildCsvFilename(tipo, de, ate);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tipo: string }> },
): Promise<Response> {
  const { tipo: tipoRaw } = await params;

  let tipo: ReportTipo;
  try {
    tipo = assertReportTipo(tipoRaw);
  } catch (err) {
    if (err instanceof ReportError) return jsonError(400, err.message);
    throw err;
  }

  // Sessão → empresa ativa → membership → permissão (mesma trilha das actions)
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return jsonError(401, "Não autenticado.");
  const tenantId = session.session.activeOrganizationId;
  if (!tenantId) return jsonError(400, "Selecione uma empresa para exportar.");

  const [member] = await db
    .select()
    .from(members)
    .where(
      and(
        eq(members.organizationId, tenantId),
        eq(members.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!member) return jsonError(403, "Sem acesso à empresa.");
  try {
    assertPermission(member.role, "reports.view");
  } catch (err) {
    if (err instanceof PermissionError) return jsonError(403, err.message);
    throw err;
  }

  const url = new URL(request.url);
  const raw = queryToObject(url);
  const base = { page: 1, pageSize: 20 };

  try {
    if (tipo === "estoque") {
      const parsed = stockReportFilters.safeParse(raw);
      if (!parsed.success) {
        return jsonError(400, "Dados inválidos.", {
          fieldErrors: fieldErrorsOf(parsed.error),
        });
      }
      const range = normalizeRange(parsed.data.de, parsed.data.ate);
      const data = await withTenant(tenantId, (tx) =>
        getStockReport(tx, tenantId, { ...parsed.data, ...range, ...base }, { all: true }),
      );
      return toCsvResponse(tipo, buildStockCsv(data.rows), range.de, range.ate);
    }

    if (tipo === "vendas") {
      const parsed = salesReportFilters.safeParse(raw);
      if (!parsed.success) {
        return jsonError(400, "Dados inválidos.", {
          fieldErrors: fieldErrorsOf(parsed.error),
        });
      }
      const range = normalizeRange(parsed.data.de, parsed.data.ate);
      const data = await withTenant(tenantId, (tx) =>
        getSalesReport(tx, tenantId, { ...parsed.data, ...range, ...base }, { all: true }),
      );
      return toCsvResponse(
        tipo,
        buildSalesCsv(data.rows, parsed.data.groupBy),
        range.de,
        range.ate,
      );
    }

    if (tipo === "compras") {
      const parsed = purchasesReportFilters.safeParse(raw);
      if (!parsed.success) {
        return jsonError(400, "Dados inválidos.", {
          fieldErrors: fieldErrorsOf(parsed.error),
        });
      }
      const range = normalizeRange(parsed.data.de, parsed.data.ate);
      const data = await withTenant(tenantId, (tx) =>
        getPurchasesReport(tx, tenantId, { ...parsed.data, ...range, ...base }, { all: true }),
      );
      return toCsvResponse(
        tipo,
        buildPurchasesCsv(data.rows, parsed.data.groupBy),
        range.de,
        range.ate,
      );
    }

    const parsed = financeReportFilters.safeParse(raw);
    if (!parsed.success) {
      return jsonError(400, "Dados inválidos.", {
        fieldErrors: fieldErrorsOf(parsed.error),
      });
    }
    const range = normalizeRange(parsed.data.de, parsed.data.ate);
    const data = await withTenant(tenantId, (tx) =>
      getFinanceReport(tx, tenantId, { ...parsed.data, ...range, ...base }, { all: true }),
    );
    return toCsvResponse(tipo, buildFinanceCsv(data.rows), range.de, range.ate);
  } catch (err) {
    if (err instanceof ReportError) return jsonError(400, err.message);
    console.error("exports CSV:", err);
    return jsonError(500, "Erro ao gerar o arquivo.");
  }
}

// --- montagem das linhas (formato pt-BR; toCsv escapa/separa) ---------------

function buildStockCsv(rows: StockReportRow[]): string {
  return toCsv(
    [
      "SKU",
      "Produto",
      "Depósito",
      "Saldo",
      "Reservado",
      "Disponível",
      "Mínimo",
      "Custo ref. (R$)",
      "Valor (R$)",
      "Situação",
    ],
    rows.map((r) => [
      r.sku,
      r.name,
      r.warehouseName,
      csvQty(r.quantity),
      csvQty(r.reserved),
      csvQty(r.available),
      csvQty(r.minStock),
      csvMoney(r.costCents),
      csvMoney(r.valueCents),
      r.level,
    ]),
  );
}

const SALES_DIM_LABEL: Record<string, string> = {
  dia: "Dia",
  vendedor: "Vendedor",
  produto: "Produto",
};

function buildSalesCsv(rows: SalesReportRow[], groupBy: string): string {
  return toCsv(
    [
      SALES_DIM_LABEL[groupBy] ?? "Dimensão",
      "Vendas",
      "Itens",
      "Bruto (R$)",
      "Desconto (R$)",
      "Líquido (R$)",
      "Custo (R$)",
      "Margem (R$)",
      "Margem (%)",
    ],
    rows.map((r) => [
      r.key,
      String(r.orders),
      csvQty(r.quantity),
      csvMoney(r.grossCents),
      csvMoney(r.discountCents),
      csvMoney(r.netCents),
      csvMoney(r.costCents),
      csvMoney(r.marginCents),
      r.marginPct === null
        ? ""
        : r.marginPct.toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
    ]),
  );
}

const PURCHASES_DIM_LABEL: Record<string, string> = {
  fornecedor: "Fornecedor",
  produto: "Produto",
};

function buildPurchasesCsv(rows: PurchasesReportRow[], groupBy: string): string {
  return toCsv(
    [
      PURCHASES_DIM_LABEL[groupBy] ?? "Dimensão",
      "Notas",
      "Quantidade",
      "Total (R$)",
    ],
    rows.map((r) => [
      r.key,
      String(r.orders),
      csvQty(r.quantity),
      csvMoney(r.totalCents),
    ]),
  );
}

const FINANCE_STATUS_LABEL: Record<string, string> = {
  OPEN: "Em aberto",
  PARTIAL: "Parcial",
  OVERDUE: "Vencida",
  PAID: "Quitada",
  CANCELLED: "Cancelada",
};

const FINANCE_SOURCE_LABEL: Record<string, string> = {
  SALE: "Venda",
  PURCHASE: "Compra",
  RETURN: "Devolução",
  MANUAL: "Manual",
};

function buildFinanceCsv(rows: FinanceReportRow[]): string {
  return toCsv(
    [
      "Descrição",
      "Vencimento",
      "Parcela",
      "Valor (R$)",
      "Pago (R$)",
      "Saldo (R$)",
      "Status",
      "Origem",
    ],
    rows.map((r) => [
      r.description,
      formatDateOnly(r.dueDate),
      r.installmentNumber && r.installmentCount
        ? `${r.installmentNumber}/${r.installmentCount}`
        : "-",
      csvMoney(r.amountCents),
      csvMoney(r.paidCents),
      csvMoney(r.amountCents - r.paidCents),
      FINANCE_STATUS_LABEL[r.status] ?? r.status,
      FINANCE_SOURCE_LABEL[r.source] ?? r.source,
    ]),
  );
}
