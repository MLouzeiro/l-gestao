// Regras puras da auditoria (Fase 14). Sem I/O: sanitização de snapshots,
// diff before/after, catálogo de ações e rótulos pt-BR para a UI.

export const AUDIT_MODULES = [
  "estoque",
  "vendas",
  "financeiro",
  "compras",
  "cadastros",
  "inventario",
  "equipe",
  "empresas",
] as const;

export type AuditModule = (typeof AUDIT_MODULES)[number];

// Substrings (lowercase) que marcam uma chave como sensível — nunca auditamos
// senha/hash/token/segredo (mesmo que venham de um objeto maior).
const SENSITIVE_MARKERS = [
  "password",
  "token",
  "secret",
  "backupcode",
  "totp",
  "apikey",
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_MARKERS.some((m) => lower.includes(m));
}

/** Remove chaves sensíveis (recursivo). Clona — nunca muta a entrada. */
export function sanitizeSnapshot<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSnapshot(item)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) continue;
    out[key] = sanitizeSnapshot(val);
  }
  return out as unknown as T;
}

// JSON.stringify com chaves ordenadas — compara estruturas independentemente
// da ordem das chaves (sem deepEqual recursivo à mão).
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Diff das chaves de topo: só o que mudou, já sanitizado.
 * Chave adicionada → before: null; removida → after: null.
 */
export function auditDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b = sanitizeSnapshot(before ?? {});
  const a = sanitizeSnapshot(after ?? {});
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const outB: Record<string, unknown> = {};
  const outA: Record<string, unknown> = {};
  for (const key of keys) {
    const bv = b[key];
    const av = a[key];
    if (stableStringify(bv) === stableStringify(av)) continue;
    outB[key] = bv === undefined ? null : bv;
    outA[key] = av === undefined ? null : av;
  }
  return { before: outB, after: outA };
}

/** Ação de auditoria derivada do tipo de movimento de estoque. */
export function auditActionForMovement(type: string): string {
  if (type.startsWith("TRANSFERENCIA_")) return "TRANSFERENCIA";
  if (type.endsWith("_AJUSTE")) return "AJUSTE_ESTOQUE";
  if (type.startsWith("ENTRADA_")) return "ENTRADA_ESTOQUE";
  if (type.startsWith("SAIDA_")) return "SAIDA_ESTOQUE";
  return "MOVIMENTO_ESTOQUE";
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  ENTRADA_ESTOQUE: "Entrada de estoque",
  SAIDA_ESTOQUE: "Saída de estoque",
  TRANSFERENCIA: "Transferência",
  AJUSTE_ESTOQUE: "Ajuste de estoque",
  MOVIMENTO_ESTOQUE: "Movimento de estoque",
  CRIACAO_VENDA: "Criação de venda",
  ALTERACAO_VENDA: "Alteração de venda",
  EXCLUSAO_VENDA: "Exclusão de venda",
  CONFIRMACAO_VENDA: "Confirmação de venda",
  CANCELAMENTO_VENDA: "Cancelamento de venda",
  FATURAMENTO_VENDA: "Faturamento de venda",
  RECEBIMENTO: "Recebimento (baixa)",
  PAGAMENTO: "Pagamento (baixa)",
  CRIACAO_COMPRA: "Criação de compra",
  ALTERACAO_COMPRA: "Alteração de compra",
  EXCLUSAO_COMPRA: "Exclusão de compra",
  CONFIRMACAO_COMPRA: "Confirmação de compra",
  CANCELAMENTO_COMPRA: "Cancelamento de compra",
  CRIACAO_PRODUTO: "Criação de produto",
  ALTERACAO_PRODUTO: "Alteração de produto",
  EXCLUSAO_PRODUTO: "Exclusão de produto",
  ALTERACAO_KIT: "Alteração de kit",
  CRIACAO_CATEGORIA: "Criação de categoria",
  CRIACAO_MARCA: "Criação de marca",
  CRIACAO_FORNECEDOR: "Criação de fornecedor",
  CRIACAO_INVENTARIO: "Abertura de inventário",
  CONTA_INVENTARIO: "Contagem de inventário",
  APLICACAO_INVENTARIO: "Aplicação de inventário",
  DESCARTE_INVENTARIO: "Descarte de inventário",
  CONVITE_USUARIO: "Convite de usuário",
  CANCELAMENTO_CONVITE: "Cancelamento de convite",
  ACEITE_CONVITE: "Aceite de convite",
  ALTERACAO_PERMISSAO: "Alteração de papel",
  REMOCAO_USUARIO: "Remoção de usuário",
  CRIACAO_EMPRESA: "Criação de empresa",
  ALTERACAO_CONFIGURACAO: "Alteração de configurações",
};

/** Rótulo pt-BR da ação; desconhecida volta o próprio código. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
