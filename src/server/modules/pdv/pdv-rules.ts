import type { SalePaymentMethodValue } from "@/server/db/schema";

// Regras puras do PDV: troco, formas de pagamento, livro-caixa (esperado por
// forma de contagem) e limites de sangria — sem banco, sem framework.

export class PdvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdvError";
  }
}

export type CashBucket = "cash" | "card" | "pix" | "other";

export type CashMovementTypeValue =
  | "ABERTURA"
  | "VENDA"
  | "SUPRIMENTO"
  | "SANGRIA"
  | "FECHAMENTO";

export const PAYMENT_METHOD_BUCKET: Record<SalePaymentMethodValue, CashBucket> =
  {
    DINHEIRO: "cash",
    PIX: "pix",
    DEBITO: "card",
    CREDITO: "card",
    VALE: "other",
    OUTRO: "other",
  };

export type RuleOk<T> = { ok: true } & T;
export type RuleOkBare = { ok: true };
export type RuleFail = { ok: false; reason: string };

function fail(reason: string): RuleFail {
  return { ok: false, reason };
}

function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Troco = recebido − total; recusa valor faltante/negativo/abaixo do total. */
export function calcTroco(
  receivedCents: number,
  totalCents: number,
): RuleOk<{ trocoCents: number }> | RuleFail {
  if (!isCents(receivedCents) || !isCents(totalCents) || totalCents <= 0) {
    return fail("Valores de pagamento inválidos.");
  }
  if (receivedCents < totalCents) {
    return fail("Valor recebido é menor que o total da venda.");
  }
  return { ok: true, trocoCents: receivedCents - totalCents };
}

export type PdvPaymentInput = {
  paymentMethod: SalePaymentMethodValue;
  installments: number;
  totalCents: number;
  receivedCents?: number | null;
};

/**
 * DINHEIRO exige valor recebido ≥ total (gera troco); CREDITO aceita 1–12
 * parcelas; demais formas são à vista (1 parcela).
 */
export function validatePdvPayment(
  input: PdvPaymentInput,
): RuleOk<{ trocoCents: number }> | RuleFail {
  if (!isCents(input.totalCents) || input.totalCents <= 0) {
    return fail("Venda sem valor: verifique os itens.");
  }
  const installments = input.installments;
  if (!Number.isInteger(installments) || installments < 1 || installments > 12) {
    return fail("Número de parcelas deve estar entre 1 e 12.");
  }

  if (input.paymentMethod === "CREDITO") {
    return { ok: true, trocoCents: 0 };
  }
  if (installments !== 1) {
    return fail("Somente o crédito permite parcelar.");
  }
  if (input.paymentMethod === "DINHEIRO") {
    if (input.receivedCents == null) {
      return fail("Informe o valor recebido em dinheiro.");
    }
    return calcTroco(input.receivedCents, input.totalCents);
  }
  return { ok: true, trocoCents: 0 };
}

export type CashMovementRow = {
  type: CashMovementTypeValue;
  amountCents: number;
  paymentMethod: SalePaymentMethodValue | null;
};

/**
 * Esperado por forma de contagem: abertura (em dinheiro) + vendas pela forma
 * de cada venda + suprimentos − sangrias. Lançamentos ABERTURA/FECHAMENTO do
 * livro não contam (a abertura entra pelo valor do caixa; fechamento é contagem).
 */
export function computeExpectedByBucket(
  openingAmountCents: number,
  movements: readonly CashMovementRow[],
): Record<CashBucket, number> {
  const expected: Record<CashBucket, number> = {
    cash: isCents(openingAmountCents) ? openingAmountCents : 0,
    card: 0,
    pix: 0,
    other: 0,
  };
  for (const m of movements) {
    const amount = isCents(m.amountCents) ? m.amountCents : 0;
    if (m.type === "VENDA") {
      const bucket = m.paymentMethod
        ? PAYMENT_METHOD_BUCKET[m.paymentMethod]
        : "other";
      expected[bucket] += amount;
    } else if (m.type === "SUPRIMENTO") {
      expected.cash += amount;
    } else if (m.type === "SANGRIA") {
      expected.cash -= amount;
    }
  }
  return expected;
}

export function validateSangria(
  sangriaCents: number,
  expectedCashCents: number,
): RuleOkBare | RuleFail {
  if (!isCents(sangriaCents) || sangriaCents <= 0) {
    return fail("Valor de sangria deve ser maior que zero.");
  }
  if (sangriaCents > expectedCashCents) {
    return fail("Sangria acima do saldo em caixa.");
  }
  return { ok: true };
}

/** Diferença do fechamento = contagem total − esperado total (sobrou → positiva). */
export function computeDifference(
  counted: Record<CashBucket, number>,
  expected: Record<CashBucket, number>,
): number {
  const sum = (r: Record<CashBucket, number>): number =>
    r.cash + r.card + r.pix + r.other;
  return sum(counted) - sum(expected);
}
