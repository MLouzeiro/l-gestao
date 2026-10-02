// Regras puras do financeiro (TDD: tests/unit/financial-rules.test.ts).
// Nenhum acesso a banco aqui — só cálculo de parcelas, status e validação de baixa.
// Dinheiro sempre em CENTAVOS (integer), conforme AGENTS.md.

export class FinancialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancialError";
  }
}

export type FinancialStatus = "OPEN" | "OVERDUE" | "PAID" | "PARTIAL" | "CANCELLED";

export type Installment = {
  number: number;
  amountCents: number;
  dueDate: Date;
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Dia calendário das colunas `date` do banco — chegam como UTC midnight
 * (`new Date("2026-10-01")`), então o dia SEMPRE sai dos getters UTC.
 */
function utcKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Dia calendário local (relógio de parede do servidor = "hoje"). */
function localKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Normaliza para UTC midnight do dia local — exatamente como o Drizzle
 * persiste as colunas `date` (toISOString → dia UTC). Usa os getters LOCAIS
 * de propósito: um `new Date()` de 23h deve virar o dia local, não o UTC.
 */
export function asUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/** +n meses CLAMPADO no fim do mês (31/01 +1 → 28/02; 31/01/2028 +1 → 29/02). */
export function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/**
 * Divide o total em `count` parcelas mensais a partir de `firstDueDate`.
 * O resto de centavos vai para as ÚLTIMAS parcelas (soma bate sempre).
 */
export function splitInstallments(
  totalCents: number,
  count: number,
  firstDueDate: Date,
): Installment[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new FinancialError("Valor total da conta deve ser maior que zero.");
  }
  if (!Number.isInteger(count) || count < 1 || count > 99) {
    throw new FinancialError("Quantidade de parcelas deve estar entre 1 e 99.");
  }

  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;

  // entrada normalizada para o dia local em UTC midnight (formato do banco)
  const start = asUtcDay(firstDueDate);

  const out: Installment[] = [];
  for (let i = 0; i < count; i++) {
    const extra = i >= count - remainder ? 1 : 0;
    out.push({
      number: i + 1,
      amountCents: base + extra,
      dueDate: i === 0 ? new Date(start.getTime()) : addMonthsClamped(start, i),
    });
  }
  return out;
}

/**
 * Status calculado da conta: CANCELLED é definido fora (pelo serviço);
 * aqui a prioridade é PAID > OVERDUE > PARTIAL > OPEN.
 * Inadimplência (OVERDUE) vence parcial: vencida e não quitada.
 */
export function computeAccountStatus(input: {
  amountCents: number;
  paidCents: number;
  dueDate: Date;
  today: Date;
}): FinancialStatus {
  const { amountCents, paidCents, dueDate, today } = input;
  if (!Number.isInteger(paidCents) || paidCents < 0) {
    throw new FinancialError("Valor pago inválido.");
  }
  if (paidCents > amountCents) {
    throw new FinancialError("Valor pago maior que o valor da conta.");
  }
  if (paidCents === amountCents) return "PAID";
  // dueDate: dia do banco (UTC) · today: relógio local do servidor
  if (utcKey(dueDate) < localKey(today)) return "OVERDUE";
  if (paidCents > 0) return "PARTIAL";
  return "OPEN";
}

export type PaymentValidation =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Valida uma baixa ANTES de gravar.
 * `remainingCents = amount - paidAmount` (saldo da conta).
 * Juros/desconto são informativos na v1: não alteram o saldo da conta
 * (paid_amount continua ≤ amount; quitação exige valor = saldo).
 */
export function validatePayment(input: {
  amountCents: number;
  interestCents?: number;
  discountCents?: number;
  remainingCents: number;
}): PaymentValidation {
  const interest = input.interestCents ?? 0;
  const discount = input.discountCents ?? 0;

  if (!Number.isInteger(interest) || !Number.isInteger(discount) || interest < 0 || discount < 0) {
    return { ok: false, reason: "Juros e desconto não podem ser negativos." };
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, reason: "Informe o valor da baixa maior que zero." };
  }
  if (input.amountCents > input.remainingCents) {
    return { ok: false, reason: "Valor da baixa maior que o saldo da conta." };
  }
  return { ok: true };
}
