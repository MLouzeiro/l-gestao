// Regras puras de compras (TDD: tests/unit/purchase-rules.test.ts).
// Nenhum acesso a banco aqui — só transições, validação de itens e totais.
// Dinheiro sempre em CENTAVOS (integer), conforme AGENTS.md.

export const PURCHASE_NUMBER_PREFIX = "COMPRA";
export const PURCHASE_NUMBER_WIDTH = 6;

export type PurchaseStatus = "OPEN" | "CONFIRMED" | "CANCELLED";

export type PurchaseItemInput = {
  productId: string;
  /** unidades (decimal) — sempre > 0 */
  quantity: number;
  /** centavos por unidade */
  unitCostCents: number;
  batchNumber?: string | null;
  /** AAAA-MM-DD */
  expiresAt?: string | null;
};

export type RuleResult = { ok: true } | { ok: false; reason: string };

export function formatPurchaseNumber(value: number): string {
  const n = Math.max(Math.trunc(value), 0);
  return `${PURCHASE_NUMBER_PREFIX}-${String(n).padStart(PURCHASE_NUMBER_WIDTH, "0")}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidYmd(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Máquina de estados da nota: OPEN → CONFIRMED | CANCELLED.
 * CONFIRMED é final na v1 (cancelamento exige estorno de estoque + financeiro).
 */
export function assertPurchaseTransition(
  from: PurchaseStatus,
  to: PurchaseStatus,
): RuleResult {
  if (from === to) {
    return { ok: false, reason: `Transição inválida: ${from} → ${to}.` };
  }
  if (from === "OPEN" && (to === "CONFIRMED" || to === "CANCELLED")) {
    return { ok: true };
  }
  if (from === "CONFIRMED") {
    return {
      ok: false,
      reason:
        "Compra confirmada não pode mudar de status — estorno será suportado em versão futura.",
    };
  }
  return { ok: false, reason: `Compra cancelada não pode mudar de status (${to}).` };
}

export function validatePurchaseItems(
  items: readonly PurchaseItemInput[],
): RuleResult {
  if (items.length === 0) {
    return { ok: false, reason: "Nota sem itens: adicione ao menos um item." };
  }
  if (items.length > 500) {
    return { ok: false, reason: "Nota com itens demais (máximo 500)." };
  }

  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const n = i + 1;
    if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
      return { ok: false, reason: `Item ${n}: quantidade deve ser maior que zero.` };
    }
    if (!Number.isInteger(it.unitCostCents) || it.unitCostCents < 0) {
      return { ok: false, reason: `Item ${n}: custo unitário inválido.` };
    }
    if (it.expiresAt && !isValidYmd(it.expiresAt)) {
      return { ok: false, reason: `Item ${n}: validade inválida (use AAAA-MM-DD).` };
    }
    const key = `${it.productId}|${(it.batchNumber ?? "").trim()}`;
    if (seen.has(key)) {
      return { ok: false, reason: `Produto duplicado no mesmo lote (item ${n}).` };
    }
    seen.add(key);
  }
  return { ok: true };
}

/** Soma linha a linha: arredondamento por item (a mesma régua do livro de estoque). */
export function calcPurchaseTotalCents(items: readonly PurchaseItemInput[]): number {
  return items.reduce((sum, it) => sum + Math.round(it.quantity * it.unitCostCents), 0);
}

export function validatePurchaseInstallments(count: number): RuleResult {
  if (!Number.isInteger(count) || count < 1 || count > 12) {
    return { ok: false, reason: "Número de parcelas deve estar entre 1 e 12." };
  }
  return { ok: true };
}

/** "AAAA-MM-DD" → Date (UTC midnight do dia) ou null se inválida. */
export function parseEntryDate(value: string): Date | null {
  if (!isValidYmd(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
