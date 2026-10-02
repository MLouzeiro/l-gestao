import { and, eq } from "drizzle-orm";
import { cashMovements, cashRegisters } from "@/server/db/schema";
import type { SalePaymentMethodValue } from "@/server/db/schema";
import { nextCounter } from "@/server/db/counter";
import { fromCents, toCents } from "@/lib/money";
import type { TenantTx } from "@/server/tenant/with-tenant";
import {
  PdvError,
  computeDifference,
  computeExpectedByBucket,
  validateSangria,
  type CashBucket,
  type CashMovementRow,
  type CashMovementTypeValue,
} from "./pdv-rules";

// Caixa do PDV: abertura (fundo de troco), suprimentos, sangrias e fechamento
// com contagem por forma. Movimentos gravados no livro imutável
// `cash_movements` (append-only) e esperado calculado só no servidor.

export type CashContext = {
  tenantId: string;
  userId?: string | null;
};

export type OpenCashInfo = {
  id: string;
  number: number;
  openedAt: Date;
  openingAmountCents: number;
};

export type CashSummary = {
  open: boolean;
  cashRegisterId: string | null;
  number: number | null;
  openedAt: Date | null;
  openingAmountCents: number;
  salesCount: number;
  salesTotalCents: number;
  suppliesCents: number;
  sangriasCents: number;
  expected: Record<CashBucket, number>;
};

export type CloseCashInput = {
  countedCashCents: number;
  countedCardCents: number;
  countedPixCents: number;
  countedOtherCents: number;
  notes?: string | null;
};

function assertCents(value: number, message: string): number {
  if (!Number.isInteger(value) || value < 0) throw new PdvError(message);
  return value;
}

export async function getOpenCash(
  tx: TenantTx,
  tenantId: string,
): Promise<OpenCashInfo | null> {
  const [row] = await tx
    .select()
    .from(cashRegisters)
    .where(
      and(
        eq(cashRegisters.tenantId, tenantId),
        eq(cashRegisters.status, "OPEN"),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    number: row.number,
    openedAt: row.openedAt,
    openingAmountCents: toCents(row.openingAmount),
  };
}

async function loadMovements(
  tx: TenantTx,
  tenantId: string,
  cashRegisterId: string,
): Promise<CashMovementRow[]> {
  const rows = await tx
    .select()
    .from(cashMovements)
    .where(
      and(
        eq(cashMovements.tenantId, tenantId),
        eq(cashMovements.cashRegisterId, cashRegisterId),
      ),
    );
  return rows.map((m) => ({
    type: m.type as CashMovementTypeValue,
    amountCents: toCents(m.amount),
    paymentMethod: (m.paymentMethod ?? null) as SalePaymentMethodValue | null,
  }));
}

export async function openCash(
  tx: TenantTx,
  ctx: CashContext,
  input: { openingAmountCents: number; notes?: string | null },
): Promise<{ cashRegisterId: string; number: number }> {
  const opening = assertCents(input.openingAmountCents, "Valor de abertura inválido.");
  const existing = await getOpenCash(tx, ctx.tenantId);
  if (existing) throw new PdvError("Já existe um caixa aberto para esta empresa.");

  const number = await nextCounter(tx, ctx.tenantId, "cash");
  const [row] = await tx
    .insert(cashRegisters)
    .values({
      tenantId: ctx.tenantId,
      number,
      status: "OPEN",
      openingAmount: fromCents(opening),
      openedBy: ctx.userId ?? null,
      notes: input.notes?.trim() || null,
    })
    .returning({ id: cashRegisters.id });

  await tx.insert(cashMovements).values({
    tenantId: ctx.tenantId,
    cashRegisterId: row.id,
    type: "ABERTURA",
    amount: fromCents(opening),
    description: "Abertura de caixa",
    userId: ctx.userId ?? null,
  });

  return { cashRegisterId: row.id, number };
}

export async function closeCash(
  tx: TenantTx,
  ctx: CashContext,
  input: CloseCashInput,
): Promise<{ cashRegisterId: string; differenceCents: number }> {
  const open = await getOpenCash(tx, ctx.tenantId);
  if (!open) throw new PdvError("Não há caixa aberto para fechar.");

  const counted: Record<CashBucket, number> = {
    cash: assertCents(input.countedCashCents, "Contagem de dinheiro inválida."),
    card: assertCents(input.countedCardCents, "Contagem de cartão inválida."),
    pix: assertCents(input.countedPixCents, "Contagem de PIX inválida."),
    other: assertCents(input.countedOtherCents, "Contagem inválida."),
  };

  const movements = await loadMovements(tx, ctx.tenantId, open.id);
  const expected = computeExpectedByBucket(open.openingAmountCents, movements);
  const difference = computeDifference(counted, expected);
  const closingAmount = counted.cash + counted.card + counted.pix + counted.other;

  await tx
    .update(cashRegisters)
    .set({
      status: "CLOSED",
      closedAt: new Date(),
      closedBy: ctx.userId ?? null,
      closingAmount: fromCents(closingAmount),
      countedCash: fromCents(counted.cash),
      countedCard: fromCents(counted.card),
      countedPix: fromCents(counted.pix),
      countedOther: fromCents(counted.other),
      expectedCash: fromCents(expected.cash),
      expectedCard: fromCents(expected.card),
      expectedPix: fromCents(expected.pix),
      expectedOther: fromCents(expected.other),
      difference: fromCents(difference),
      notes: input.notes?.trim() || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(cashRegisters.tenantId, ctx.tenantId),
        eq(cashRegisters.id, open.id),
      ),
    );

  await tx.insert(cashMovements).values({
    tenantId: ctx.tenantId,
    cashRegisterId: open.id,
    type: "FECHAMENTO",
    amount: fromCents(closingAmount),
    description: "Fechamento de caixa",
    userId: ctx.userId ?? null,
  });

  return { cashRegisterId: open.id, differenceCents: difference };
}

export async function addSupply(
  tx: TenantTx,
  ctx: CashContext,
  input: { amountCents: number; description?: string | null },
): Promise<{ cashMovementId: string }> {
  const amount = assertCents(input.amountCents, "Valor do suprimento inválido.");
  if (amount <= 0) throw new PdvError("Valor do suprimento deve ser maior que zero.");

  const open = await getOpenCash(tx, ctx.tenantId);
  if (!open) throw new PdvError("Abra o caixa antes de lançar suprimento.");

  const [m] = await tx
    .insert(cashMovements)
    .values({
      tenantId: ctx.tenantId,
      cashRegisterId: open.id,
      type: "SUPRIMENTO",
      amount: fromCents(amount),
      description: input.description?.trim() || "Suprimento de caixa",
      userId: ctx.userId ?? null,
    })
    .returning({ id: cashMovements.id });
  return { cashMovementId: m.id };
}

export async function addSangria(
  tx: TenantTx,
  ctx: CashContext,
  input: { amountCents: number; description?: string | null },
): Promise<{ cashMovementId: string }> {
  const amount = assertCents(input.amountCents, "Valor da sangria inválido.");
  const open = await getOpenCash(tx, ctx.tenantId);
  if (!open) throw new PdvError("Abra o caixa antes de lançar sangria.");

  const movements = await loadMovements(tx, ctx.tenantId, open.id);
  const expected = computeExpectedByBucket(open.openingAmountCents, movements);
  const check = validateSangria(amount, expected.cash);
  if (!check.ok) throw new PdvError(check.reason);

  const [m] = await tx
    .insert(cashMovements)
    .values({
      tenantId: ctx.tenantId,
      cashRegisterId: open.id,
      type: "SANGRIA",
      amount: fromCents(amount),
      description: input.description?.trim() || "Sangria de caixa",
      userId: ctx.userId ?? null,
    })
    .returning({ id: cashMovements.id });
  return { cashMovementId: m.id };
}

export async function getCashSummary(
  tx: TenantTx,
  tenantId: string,
): Promise<CashSummary> {
  const open = await getOpenCash(tx, tenantId);
  const zero: Record<CashBucket, number> = {
    cash: 0,
    card: 0,
    pix: 0,
    other: 0,
  };
  if (!open) {
    return {
      open: false,
      cashRegisterId: null,
      number: null,
      openedAt: null,
      openingAmountCents: 0,
      salesCount: 0,
      salesTotalCents: 0,
      suppliesCents: 0,
      sangriasCents: 0,
      expected: zero,
    };
  }

  const movements = await loadMovements(tx, tenantId, open.id);
  const expected = computeExpectedByBucket(open.openingAmountCents, movements);
  let salesCount = 0;
  let salesTotalCents = 0;
  let suppliesCents = 0;
  let sangriasCents = 0;
  for (const m of movements) {
    if (m.type === "VENDA") {
      salesCount += 1;
      salesTotalCents += m.amountCents;
    } else if (m.type === "SUPRIMENTO") {
      suppliesCents += m.amountCents;
    } else if (m.type === "SANGRIA") {
      sangriasCents += m.amountCents;
    }
  }

  return {
    open: true,
    cashRegisterId: open.id,
    number: open.number,
    openedAt: open.openedAt,
    openingAmountCents: open.openingAmountCents,
    salesCount,
    salesTotalCents,
    suppliesCents,
    sangriasCents,
    expected,
  };
}
