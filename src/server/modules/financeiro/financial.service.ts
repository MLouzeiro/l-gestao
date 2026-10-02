import { and, desc, eq, inArray, lt, ilike, sql } from "drizzle-orm";
import {
  customers,
  financialAccounts,
  financialPayments,
  purchaseEntries,
  salesOrders,
  suppliers,
  tenants,
} from "@/server/db/schema";
import { fromCents, toCents } from "@/lib/money";
import type { TenantTx } from "@/server/tenant/with-tenant";
import {
  FinancialError,
  asUtcDay,
  computeAccountStatus,
  splitInstallments,
  validatePayment,
  type FinancialStatus,
} from "./financial-rules";

// Serviço financeiro (Fase 11): parcelas no faturamento/compra, baixa via
// financial_payments (imutável) e recálculo de status na mesma transação.

export type FinancialContext = {
  tenantId: string;
  userId?: string | null;
};

export type CreateAccountsInput = {
  direction: "RECEIVABLE" | "PAYABLE";
  source: "SALE" | "PURCHASE" | "RETURN" | "MANUAL";
  sourceId: string | null;
  description: string;
  totalCents: number;
  installments: number;
  /** data do 1º vencimento (dia do faturamento/entrada) */
  baseDate: Date;
  notes?: string | null;
};

function dateOnly(d: Date): Date {
  return asUtcDay(d);
}

/** Grava as parcelas (OPEN) — usada pelo faturamento de venda e pela compra. */
export async function createAccounts(
  tx: TenantTx,
  ctx: FinancialContext,
  input: CreateAccountsInput,
): Promise<{ ids: string[] }> {
  // splitInstallments normaliza baseDate (dia local → UTC midnight) uma única vez
  const parts = splitInstallments(input.totalCents, input.installments, input.baseDate);
  const rows = parts.map((p) => ({
    tenantId: ctx.tenantId,
    direction: input.direction,
    source: input.source,
    sourceId: input.sourceId,
    description: input.description,
    dueDate: p.dueDate, // já normalizado (UTC midnight) pelo splitInstallments
    installmentNumber: p.number,
    installmentCount: input.installments,
    amount: fromCents(p.amountCents),
    paidAmount: "0",
    status: "OPEN" as FinancialStatus,
    notes: input.notes ?? null,
  }));
  const inserted = await tx
    .insert(financialAccounts)
    .values(rows)
    .returning({ id: financialAccounts.id });
  return { ids: inserted.map((r) => r.id) };
}

export async function createReceivables(
  tx: TenantTx,
  ctx: FinancialContext,
  input: Omit<CreateAccountsInput, "direction" | "source">,
): Promise<{ ids: string[] }> {
  return createAccounts(tx, ctx, { ...input, direction: "RECEIVABLE", source: "SALE" });
}

export async function createPayables(
  tx: TenantTx,
  ctx: FinancialContext,
  input: Omit<CreateAccountsInput, "direction" | "source">,
): Promise<{ ids: string[] }> {
  return createAccounts(tx, ctx, { ...input, direction: "PAYABLE", source: "PURCHASE" });
}

export type RegisterPaymentInput = {
  amountCents: number;
  interestCents?: number;
  discountCents?: number;
  paymentMethod: string;
  paidAt?: Date;
  notes?: string | null;
};

/**
 * Baixa de uma conta: lock da linha, valida saldo, grava o pagamento
 * (append-only) e recalcula paid_amount + status na mesma transação.
 */
export async function registerPayment(
  tx: TenantTx,
  ctx: FinancialContext,
  accountId: string,
  input: RegisterPaymentInput,
): Promise<{ accountId: string; status: FinancialStatus; paidCents: number }> {
  const [account] = await tx
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.tenantId, ctx.tenantId), eq(financialAccounts.id, accountId)))
    .for("update");
  if (!account) throw new FinancialError("Conta não encontrada.");
  if (account.status === "CANCELLED") {
    throw new FinancialError("Conta cancelada não pode receber baixa.");
  }

  const amountCents = toCents(account.amount);
  const paidCents = toCents(account.paidAmount);
  const remainingCents = amountCents - paidCents;

  const check = validatePayment({
    amountCents: input.amountCents,
    interestCents: input.interestCents ?? 0,
    discountCents: input.discountCents ?? 0,
    remainingCents,
  });
  if (!check.ok) throw new FinancialError(check.reason);

  const newPaidCents = paidCents + input.amountCents;
  const status = computeAccountStatus({
    amountCents,
    paidCents: newPaidCents,
    dueDate: account.dueDate,
    today: new Date(),
  });

  const method = input.paymentMethod.trim();
  if (!method) throw new FinancialError("Informe a forma de pagamento.");

  await tx.insert(financialPayments).values({
    tenantId: ctx.tenantId,
    financialAccountId: accountId,
    amount: fromCents(input.amountCents),
    interest: fromCents(input.interestCents ?? 0),
    discount: fromCents(input.discountCents ?? 0),
    paymentMethod: method,
    paidAt: dateOnly(input.paidAt ?? new Date()),
    receivedBy: ctx.userId ?? null,
    notes: input.notes?.trim() || null,
  });

  await tx
    .update(financialAccounts)
    .set({
      paidAmount: fromCents(newPaidCents),
      status,
      paidAt: status === "PAID" ? new Date() : account.paidAt,
      updatedAt: new Date(),
    })
    .where(and(eq(financialAccounts.tenantId, ctx.tenantId), eq(financialAccounts.id, accountId)));

  return { accountId, status, paidCents: newPaidCents };
}

/** Vira OVERDUE tudo que venceu e ainda está OPEN/PARTIAL (cron diário). */
export async function markAccountsOverdue(
  tx: TenantTx,
  tenantId: string,
  today: Date = new Date(),
): Promise<number> {
  const updated = await tx
    .update(financialAccounts)
    .set({ status: "OVERDUE", updatedAt: new Date() })
    .where(
      and(
        eq(financialAccounts.tenantId, tenantId),
        inArray(financialAccounts.status, ["OPEN", "PARTIAL"]),
        lt(financialAccounts.dueDate, dateOnly(today)),
      ),
    )
    .returning({ id: financialAccounts.id });
  return updated.length;
}

/**
 * Cancela as contas de uma origem (ex.: compra cancelada).
 * Recusado se alguma conta já tem baixa — correção seria estorno (v2).
 */
export async function cancelAccountsForSource(
  tx: TenantTx,
  ctx: FinancialContext,
  source: "SALE" | "PURCHASE" | "RETURN" | "MANUAL",
  sourceId: string,
): Promise<number> {
  const accounts = await tx
    .select({
      id: financialAccounts.id,
      paidAmount: financialAccounts.paidAmount,
      status: financialAccounts.status,
    })
    .from(financialAccounts)
    .where(
      and(
        eq(financialAccounts.tenantId, ctx.tenantId),
        eq(financialAccounts.source, source),
        eq(financialAccounts.sourceId, sourceId),
      ),
    )
    .for("update");

  if (accounts.length === 0) return 0;
  const paid = accounts.filter((a) => toCents(a.paidAmount) > 0);
  if (paid.length > 0) {
    throw new FinancialError("Não é possível cancelar: já existem baixas nas parcelas.");
  }

  await tx
    .update(financialAccounts)
    .set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(financialAccounts.tenantId, ctx.tenantId),
        eq(financialAccounts.source, source),
        eq(financialAccounts.sourceId, sourceId),
        inArray(financialAccounts.status, ["OPEN", "PARTIAL", "OVERDUE"]),
      ),
    );
  return accounts.length;
}

/** Ids de todos os tenants (sem contexto de RLS — tenants não tem policy). */
export async function listTenantIdsForCron(tx: TenantTx): Promise<string[]> {
  const rows = await tx.select({ id: tenants.id }).from(tenants);
  return rows.map((r) => r.id);
}

// ------------------------------------------------------------------ leituras

export type AccountListFilters = {
  direction?: "RECEIVABLE" | "PAYABLE";
  status?: FinancialStatus[];
  search?: string;
  limit?: number;
  offset?: number;
};

export type AccountListRow = {
  id: string;
  direction: "RECEIVABLE" | "PAYABLE";
  source: string;
  sourceId: string | null;
  description: string;
  partyName: string | null;
  dueDate: Date;
  installmentNumber: number | null;
  installmentCount: number | null;
  amountCents: number;
  paidCents: number;
  status: FinancialStatus;
};

/**
 * Lista de contas com nome do cliente/fornecedor da origem
 * (integridade de source_id é por app — não há FK).
 */
export async function listAccounts(
  tx: TenantTx,
  tenantId: string,
  filters: AccountListFilters = {},
): Promise<{ rows: AccountListRow[]; total: number }> {
  const conditions = [eq(financialAccounts.tenantId, tenantId)];
  if (filters.direction) conditions.push(eq(financialAccounts.direction, filters.direction));
  if (filters.status && filters.status.length > 0) {
    conditions.push(inArray(financialAccounts.status, filters.status));
  }
  if (filters.search?.trim()) {
    const q = `%${filters.search.trim()}%`;
    conditions.push(ilike(financialAccounts.description, q));
  }
  const where = and(...conditions);

  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(financialAccounts)
    .where(where);

  const rows = await tx
    .select({
      id: financialAccounts.id,
      direction: financialAccounts.direction,
      source: financialAccounts.source,
      sourceId: financialAccounts.sourceId,
      description: financialAccounts.description,
      partyName: sql<string | null>`coalesce(${customers.name}, ${suppliers.name})`,
      dueDate: financialAccounts.dueDate,
      installmentNumber: financialAccounts.installmentNumber,
      installmentCount: financialAccounts.installmentCount,
      amount: financialAccounts.amount,
      paidAmount: financialAccounts.paidAmount,
      status: financialAccounts.status,
    })
    .from(financialAccounts)
    .leftJoin(
      salesOrders,
      and(
        eq(salesOrders.tenantId, financialAccounts.tenantId),
        eq(salesOrders.id, financialAccounts.sourceId),
      ),
    )
    .leftJoin(
      customers,
      and(eq(customers.tenantId, financialAccounts.tenantId), eq(customers.id, salesOrders.customerId)),
    )
    .leftJoin(
      purchaseEntries,
      and(
        eq(purchaseEntries.tenantId, financialAccounts.tenantId),
        eq(purchaseEntries.id, financialAccounts.sourceId),
      ),
    )
    .leftJoin(
      suppliers,
      and(eq(suppliers.tenantId, financialAccounts.tenantId), eq(suppliers.id, purchaseEntries.supplierId)),
    )
    .where(where)
    .orderBy(financialAccounts.dueDate, financialAccounts.description)
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  const cents = (v: string) => Math.round(parseFloat(v) * 100);

  return {
    total: count ?? 0,
    rows: rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      source: r.source,
      sourceId: r.sourceId,
      description: r.description,
      partyName: r.partyName,
      dueDate: r.dueDate,
      installmentNumber: r.installmentNumber,
      installmentCount: r.installmentCount,
      amountCents: cents(r.amount),
      paidCents: cents(r.paidAmount),
      status: r.status,
    })),
  };
}

export type AccountDetail = AccountListRow & {
  notes: string | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
  payments: {
    id: string;
    amountCents: number;
    interestCents: number;
    discountCents: number;
    paymentMethod: string;
    paidAt: Date;
    notes: string | null;
    receivedBy: string | null;
    createdAt: Date;
  }[];
};

export async function getAccountDetail(
  tx: TenantTx,
  tenantId: string,
  accountId: string,
): Promise<AccountDetail | null> {
  const [account] = await tx
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.tenantId, tenantId), eq(financialAccounts.id, accountId)))
    .limit(1);
  if (!account) return null;

  let partyName: string | null = null;
  if (account.source === "SALE" && account.sourceId) {
    const [row] = await tx
      .select({ name: customers.name })
      .from(salesOrders)
      .leftJoin(
        customers,
        and(eq(customers.tenantId, salesOrders.tenantId), eq(customers.id, salesOrders.customerId)),
      )
      .where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, account.sourceId)))
      .limit(1);
    partyName = row?.name ?? null;
  } else if (account.source === "PURCHASE" && account.sourceId) {
    const [row] = await tx
      .select({ name: suppliers.name })
      .from(purchaseEntries)
      .leftJoin(
        suppliers,
        and(eq(suppliers.tenantId, purchaseEntries.tenantId), eq(suppliers.id, purchaseEntries.supplierId)),
      )
      .where(and(eq(purchaseEntries.tenantId, tenantId), eq(purchaseEntries.id, account.sourceId)))
      .limit(1);
    partyName = row?.name ?? null;
  }

  const payments = await tx
    .select()
    .from(financialPayments)
    .where(
      and(
        eq(financialPayments.tenantId, tenantId),
        eq(financialPayments.financialAccountId, accountId),
      ),
    )
    .orderBy(desc(financialPayments.paidAt), desc(financialPayments.createdAt));

  const cents = (v: string) => Math.round(parseFloat(v) * 100);

  return {
    id: account.id,
    direction: account.direction,
    source: account.source,
    sourceId: account.sourceId,
    description: account.description,
    partyName,
    dueDate: account.dueDate,
    installmentNumber: account.installmentNumber,
    installmentCount: account.installmentCount,
    amountCents: cents(account.amount),
    paidCents: cents(account.paidAmount),
    status: account.status,
    notes: account.notes,
    paidAt: account.paidAt,
    cancelledAt: account.cancelledAt,
    payments: payments.map((p) => ({
      id: p.id,
      amountCents: cents(p.amount),
      interestCents: cents(p.interest),
      discountCents: cents(p.discount),
      paymentMethod: p.paymentMethod,
      paidAt: p.paidAt,
      notes: p.notes,
      receivedBy: p.receivedBy,
      createdAt: p.createdAt,
    })),
  };
}
