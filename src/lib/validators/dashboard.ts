import { z } from "zod";

// Filtros do dashboard (Fase 13) — período obrigatório: a página preenche o
// default (últimos 30 dias) antes de validar; a validação do servidor é a
// que vale.

export const dashboardFilters = z.object({
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
});

export type DashboardQuery = z.infer<typeof dashboardFilters>;
