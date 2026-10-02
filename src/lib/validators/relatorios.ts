import { z } from "zod";

// Filtros dos relatórios (Fase 12) — schemas compartilhados entre a página
// (GET /relatorios) e a rota de export CSV (/api/exports/[tipo]).
// A validação do servidor é a que vale; a página só pré-formata.

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
  .optional();

const baseFilters = z.object({
  de: isoDate,
  ate: isoDate,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

export const stockReportFilters = baseFilters.extend({
  q: z.string().trim().max(80, "Busca muito longa.").optional(),
  warehouseId: z.string().uuid("Depósito inválido.").optional(),
  level: z.enum(["CRITICO", "BAIXO", "OK"]).optional(),
});

export const salesReportFilters = baseFilters.extend({
  sellerId: z.string().uuid("Vendedor inválido.").optional(),
  groupBy: z.enum(["dia", "vendedor", "produto"]).default("dia"),
});

export const purchasesReportFilters = baseFilters.extend({
  supplierId: z.string().uuid("Fornecedor inválido.").optional(),
  groupBy: z.enum(["fornecedor", "produto"]).default("fornecedor"),
});

export const financeReportFilters = baseFilters.extend({
  direction: z.enum(["RECEIVABLE", "PAYABLE"]).default("RECEIVABLE"),
  status: z
    .enum(["OPEN", "PARTIAL", "OVERDUE", "PAID", "CANCELLED"])
    .optional(),
});

export type StockReportQuery = z.infer<typeof stockReportFilters>;
export type SalesReportQuery = z.infer<typeof salesReportFilters>;
export type PurchasesReportQuery = z.infer<typeof purchasesReportFilters>;
export type FinanceReportQuery = z.infer<typeof financeReportFilters>;

/** Zod 4 → `{ fieldErrors }` no formato das convenções (400). */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
