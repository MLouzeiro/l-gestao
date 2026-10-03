import type { tenantSegmentEnum } from "@/server/db/schema/enums";

// Regras puras de módulos contratáveis (PROMPT MESTRE §35) — sem banco.
// Empresa → Segmento → Plano → Módulos → Permissões → Configurações.

export type ModuleDef = {
  key: string;
  name: string;
  description: string;
};

export type SegmentValue = (typeof tenantSegmentEnum.enumValues)[number];

export const MODULE_CATALOG: readonly ModuleDef[] = [
  { key: "ESTOQUE", name: "Estoque", description: "Produtos, saldos e movimentações" },
  { key: "COMPRAS", name: "Compras", description: "Notas de entrada e contas a pagar" },
  { key: "VENDAS", name: "Vendas", description: "Pedidos, faturamento e devoluções" },
  { key: "PDV", name: "PDV / Caixa", description: "Frente de caixa, caixa e PIX" },
  { key: "FINANCEIRO", name: "Financeiro", description: "Contas a receber e a pagar" },
  { key: "INVENTARIO", name: "Inventário", description: "Contagens e ajustes de estoque" },
  {
    key: "LOTES_VALIDADE",
    name: "Lotes e Validade",
    description: "Rastreio por lote e alertas de vencimento",
  },
  {
    key: "MATRIZ_POSTOS",
    name: "Matriz e Postos",
    description: "Unidades, filiais e postos de coleta",
  },
  {
    key: "TRANSFERENCIAS",
    name: "Transferências",
    description: "Envio entre unidades com workflow e recebimento",
  },
  {
    key: "REPOSICAO",
    name: "Reposição",
    description: "Requisições de reposição entre unidades",
  },
  {
    key: "AUDITORIA",
    name: "Auditoria",
    description: "Central de auditoria e eventos de segurança",
  },
  {
    key: "INDICADORES",
    name: "Indicadores",
    description: "Painéis, alertas e indicadores por segmento",
  },
  { key: "RELATORIOS", name: "Relatórios", description: "Relatórios exportáveis" },
];

const BASE_PRESET = [
  "ESTOQUE",
  "COMPRAS",
  "VENDAS",
  "FINANCEIRO",
  "INVENTARIO",
  "RELATORIOS",
] as const;

const LAB_PRESET = [
  "LOTES_VALIDADE",
  "MATRIZ_POSTOS",
  "TRANSFERENCIAS",
  "REPOSICAO",
  "AUDITORIA",
  "INDICADORES",
] as const;

/** Preset de módulos de um segmento (novo tenant nasce com estes ativos). */
export function segmentModulePreset(segment: SegmentValue): string[] {
  switch (segment) {
    case "FARMACIA":
      return [...BASE_PRESET, "PDV", "LOTES_VALIDADE", "INDICADORES"];
    case "LABORATORIO":
    case "SAUDE":
      return [...BASE_PRESET, ...LAB_PRESET];
    case "LANCHONETE":
      return [...BASE_PRESET, "PDV", "INDICADORES"];
    case "FRIGORIFICO":
      return [...BASE_PRESET, "LOTES_VALIDADE", "INDICADORES"];
    case "OUTRO":
      return [...BASE_PRESET];
    case "COMERCIO_GERAL":
    default:
      return [...BASE_PRESET, "PDV"];
  }
}

/**
 * Módulos efetivos: preset do segmento ∪ módulos do plano (quando houver).
 * Dedup preservando a ordem de inserção.
 */
export function resolveModuleKeys(input: {
  segment: SegmentValue;
  planModuleKeys?: readonly string[];
}): string[] {
  const preset = segmentModulePreset(input.segment);
  const extra = input.planModuleKeys ?? [];
  return [...new Set([...preset, ...extra])];
}

export function moduleErrorMessage(key: string): string {
  return `Módulo ${key} não está contratado para esta empresa. Contrate em Administração → Módulos.`;
}
