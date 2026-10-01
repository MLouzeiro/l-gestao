// Regras puras de movimentação de estoque (TDD: tests/unit/movement-rules.test.ts).
// Nenhum acesso a banco aqui — só classificação, validação e custo médio.

export const ENTRADA_TYPES = [
  "ENTRADA_COMPRA",
  "ENTRADA_DEVOLUCAO",
  "ENTRADA_AJUSTE",
  "TRANSFERENCIA_ENTRADA",
] as const;

export const SAIDA_TYPES = [
  "SAIDA_VENDA",
  "SAIDA_DEVOLUCAO_FORNECEDOR",
  "SAIDA_PERDA",
  "SAIDA_QUEBRA",
  "SAIDA_VENCIMENTO",
  "SAIDA_AJUSTE",
  "TRANSFERENCIA_SAIDA",
] as const;

export type EntradaType = (typeof ENTRADA_TYPES)[number];
export type SaidaType = (typeof SAIDA_TYPES)[number];
export type MovementType = EntradaType | SaidaType;

export function isEntrada(type: string): type is EntradaType {
  return (ENTRADA_TYPES as readonly string[]).includes(type);
}

export function isSaida(type: string): type is SaidaType {
  return (SAIDA_TYPES as readonly string[]).includes(type);
}

/** +1 para entrada, -1 para saída. Tipo desconhecido lança erro. */
export function movementSignal(type: string): 1 | -1 {
  if (isEntrada(type)) return 1;
  if (isSaida(type)) return -1;
  throw new Error(`Tipo de movimentação inválido: ${type}`);
}

export type RuleResult = { ok: true } | { ok: false; reason: string };

export function validateMovement(input: {
  type: string;
  quantity: number;
  unitCostCents?: number;
  trackBatch: boolean;
  batchNumber?: string;
}): RuleResult {
  if (!isEntrada(input.type) && !isSaida(input.type)) {
    return { ok: false, reason: "Tipo de movimentação inválido." };
  }
  if (!(input.quantity > 0) || !Number.isFinite(input.quantity)) {
    return { ok: false, reason: "Quantidade deve ser maior que zero." };
  }
  if (isEntrada(input.type)) {
    const c = input.unitCostCents;
    if (c === undefined || !Number.isInteger(c) || c < 0) {
      return {
        ok: false,
        reason: "Informe o custo unitário da entrada (≥ 0).",
      };
    }
  }
  if (input.trackBatch && !input.batchNumber?.trim()) {
    return {
      ok: false,
      reason: "Informe o número do lote: o produto controla lote.",
    };
  }
  return { ok: true };
}

/**
 * Custo médio móvel em centavos (inteiro — nunca float).
 * 10@R$10 + 10@R$12 → 1100 (R$11,00). Quantidade em unidades decimais.
 */
export function calcAvgCostCents(
  oldQty: number,
  oldCostCents: number,
  newQty: number,
  newCostCents: number,
): number {
  const toMilli = (q: number) => BigInt(Math.round(q * 1000));
  const oldM = toMilli(oldQty);
  const newM = toMilli(newQty);
  const denom = oldM + newM;
  if (denom <= 0n) {
    throw new Error("calcAvgCostCents: quantidade total deve ser > 0");
  }
  const numer = oldM * BigInt(oldCostCents) + newM * BigInt(newCostCents);
  // arredonda para o centavo mais próximo (meio para cima)
  return Number((numer + denom / 2n) / denom);
}

export function availableQty(quantity: number, reserved: number): number {
  return Math.max(quantity - reserved, 0);
}
