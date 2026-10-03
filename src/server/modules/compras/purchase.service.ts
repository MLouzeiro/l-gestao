import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  products,
  purchaseEntries,
  purchaseEntryItems,
  suppliers,
  warehouses,
} from "@/server/db/schema";
import type { TenantTx } from "@/server/tenant/with-tenant";
import { fromCents, toCents } from "@/lib/money";
import { nextCounter } from "@/server/db/counter";
import { createPayables } from "@/server/modules/financeiro/financial.service";
import { audit } from "@/server/audit/log";
import {
  applyMovement,
  MovementError,
} from "@/server/modules/estoque/movement.service";
import {
  PURCHASE_NUMBER_PREFIX,
  PURCHASE_NUMBER_WIDTH,
  assertPurchaseTransition,
  calcPurchaseTotalCents,
  formatPurchaseNumber,
  parseEntryDate,
  validatePurchaseInstallments,
  validatePurchaseItems,
  type PurchaseItemInput,
  type PurchaseStatus,
} from "./purchase-rules";

// Compras (Fase 11 / M4): nota de entrada OPEN → CONFIRMED, com movimento
// ENTRADA_COMPRA no estoque e conta a pagar (parcelas) na confirmação.
// Tudo roda dentro de withTenant() (RLS), na MESMA transação.

export class PurchaseError extends Error {}

export type PurchaseContext = {
  tenantId: string;
  userId?: string | null;
};

export type PurchaseInput = {
  supplierId: string;
  warehouseId: string;
  /** AAAA-MM-DD — ausente usa current_date do banco */
  entryDate?: string | null;
  documentNumber?: string | null;
  notes?: string | null;
  installments: number;
  items: readonly PurchaseItemInput[];
};

const COUNTER_KEY = "purchase";

function qtyDb(n: number): string {
  return n.toFixed(3);
}

function centsDb(cents: number): string {
  return fromCents(cents);
}

async function assertSupplier(
  tx: TenantTx,
  tenantId: string,
  supplierId: string,
): Promise<void> {
  const [s] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.tenantId, tenantId),
        eq(suppliers.id, supplierId),
        isNull(suppliers.deletedAt),
      ),
    )
    .limit(1);
  if (!s) throw new PurchaseError("Fornecedor não encontrado.");
}

async function assertWarehouse(
  tx: TenantTx,
  tenantId: string,
  warehouseId: string,
): Promise<void> {
  const [w] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.tenantId, tenantId),
        eq(warehouses.id, warehouseId),
        isNull(warehouses.deletedAt),
      ),
    )
    .limit(1);
  if (!w) throw new PurchaseError("Depósito não encontrado.");
}

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  status: string;
  trackBatch: boolean;
};

async function loadProducts(
  tx: TenantTx,
  tenantId: string,
  ids: string[],
): Promise<Map<string, ProductRow>> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return new Map();
  const rows = await tx
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      status: products.status,
      trackBatch: products.trackBatch,
    })
    .from(products)
    .where(
      and(
        eq(products.tenantId, tenantId),
        inArray(products.id, uniq),
        isNull(products.deletedAt),
      ),
    );
  return new Map(rows.map((p) => [p.id, p]));
}

async function assertItemsValid(
  tx: TenantTx,
  tenantId: string,
  items: readonly PurchaseItemInput[],
): Promise<void> {
  const check = validatePurchaseItems(items);
  if (!check.ok) throw new PurchaseError(check.reason);

  const catalog = await loadProducts(
    tx,
    tenantId,
    items.map((i) => i.productId),
  );
  for (const item of items) {
    const p = catalog.get(item.productId);
    if (!p) throw new PurchaseError("Produto não encontrado.");
    if (p.status !== "ACTIVE") {
      throw new PurchaseError(`Produto ${p.sku} não está ativo.`);
    }
    if (p.trackBatch && !(item.batchNumber ?? "").trim()) {
      throw new PurchaseError(
        `Produto ${p.sku} controla lote: informe o número do lote.`,
      );
    }
  }
}

function assertInstallments(count: number): void {
  const check = validatePurchaseInstallments(count);
  if (!check.ok) throw new PurchaseError(check.reason);
}

async function writeItems(
  tx: TenantTx,
  tenantId: string,
  purchaseId: string,
  items: readonly PurchaseItemInput[],
): Promise<void> {
  const now = new Date();
  await tx.insert(purchaseEntryItems).values(
    items.map((it) => ({
      tenantId,
      purchaseEntryId: purchaseId,
      productId: it.productId,
      batchNumber: it.batchNumber?.trim() || null,
      expiresAt: it.expiresAt ? parseEntryDate(it.expiresAt) : null,
      quantity: qtyDb(it.quantity),
      unitCost: centsDb(it.unitCostCents),
      createdAt: now,
    })),
  );
}

function resolveEntryDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = parseEntryDate(value);
  if (!parsed) throw new PurchaseError("Data de entrada inválida (use AAAA-MM-DD).");
  return parsed;
}

/** Cria a nota (OPEN) com numeração por tenant e total recalculado no servidor. */
export async function createPurchase(
  tx: TenantTx,
  ctx: PurchaseContext,
  input: PurchaseInput,
): Promise<{ purchaseId: string; number: number; totalCents: number }> {
  assertInstallments(input.installments);
  await assertItemsValid(tx, ctx.tenantId, input.items);
  await assertSupplier(tx, ctx.tenantId, input.supplierId);
  await assertWarehouse(tx, ctx.tenantId, input.warehouseId);

  const totalCents = calcPurchaseTotalCents(input.items);
  const number = await nextCounter(tx, ctx.tenantId, COUNTER_KEY);

  const [entry] = await tx
    .insert(purchaseEntries)
    .values({
      tenantId: ctx.tenantId,
      number,
      supplierId: input.supplierId,
      warehouseId: input.warehouseId,
      status: "OPEN",
      documentNumber: input.documentNumber?.trim() || null,
      entryDate: resolveEntryDate(input.entryDate),
      total: centsDb(totalCents),
      installments: input.installments,
      notes: input.notes?.trim() || null,
      userId: ctx.userId ?? null,
    })
    .returning({ id: purchaseEntries.id });

  await writeItems(tx, ctx.tenantId, entry.id, input.items);

  await audit(tx, {
    action: "CRIACAO_COMPRA",
    module: "compras",
    entityType: "purchase_entry",
    entityId: entry.id,
    after: {
      status: "OPEN",
      supplierId: input.supplierId,
      totalCents,
      installments: input.installments,
      itemCount: input.items.length,
    },
    tenantId: ctx.tenantId,
    userId: ctx.userId ?? null,
  });

  return { purchaseId: entry.id, number, totalCents };
}

/** Substitui o conteúdo de uma nota (somente OPEN). */
export async function updatePurchase(
  tx: TenantTx,
  ctx: PurchaseContext,
  purchaseId: string,
  input: PurchaseInput,
): Promise<{ purchaseId: string; totalCents: number }> {
  const entry = await lockPurchase(tx, ctx.tenantId, purchaseId);
  assertEditable(entry.status);

  assertInstallments(input.installments);
  await assertItemsValid(tx, ctx.tenantId, input.items);
  await assertSupplier(tx, ctx.tenantId, input.supplierId);
  await assertWarehouse(tx, ctx.tenantId, input.warehouseId);

  const totalCents = calcPurchaseTotalCents(input.items);

  await tx
    .delete(purchaseEntryItems)
    .where(
      and(
        eq(purchaseEntryItems.tenantId, ctx.tenantId),
        eq(purchaseEntryItems.purchaseEntryId, purchaseId),
      ),
    );
  await writeItems(tx, ctx.tenantId, purchaseId, input.items);

  const entryDate = resolveEntryDate(input.entryDate);
  await tx
    .update(purchaseEntries)
    .set({
      supplierId: input.supplierId,
      warehouseId: input.warehouseId,
      documentNumber: input.documentNumber?.trim() || null,
      ...(entryDate ? { entryDate } : {}),
      total: centsDb(totalCents),
      installments: input.installments,
      notes: input.notes?.trim() || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(purchaseEntries.tenantId, ctx.tenantId),
        eq(purchaseEntries.id, purchaseId),
      ),
    );

  await audit(tx, {
    action: "ALTERACAO_COMPRA",
    module: "compras",
    entityType: "purchase_entry",
    entityId: purchaseId,
    before: {
      status: entry.status,
      totalCents: toCents(entry.total),
      installments: entry.installments,
      warehouseId: entry.warehouseId,
    },
    after: {
      status: entry.status,
      supplierId: input.supplierId,
      totalCents,
      installments: input.installments,
      warehouseId: input.warehouseId,
    },
    tenantId: ctx.tenantId,
    userId: ctx.userId ?? null,
  });

  return { purchaseId, totalCents };
}

/** Apaga a nota (somente OPEN — itens caem em cascata). */
export async function deletePurchase(
  tx: TenantTx,
  ctx: PurchaseContext,
  purchaseId: string,
): Promise<{ purchaseId: string }> {
  const entry = await lockPurchase(tx, ctx.tenantId, purchaseId);
  assertEditable(entry.status);

  await tx
    .delete(purchaseEntryItems)
    .where(
      and(
        eq(purchaseEntryItems.tenantId, ctx.tenantId),
        eq(purchaseEntryItems.purchaseEntryId, purchaseId),
      ),
    );
  await tx
    .delete(purchaseEntries)
    .where(
      and(
        eq(purchaseEntries.tenantId, ctx.tenantId),
        eq(purchaseEntries.id, purchaseId),
      ),
    );

  await audit(tx, {
    action: "EXCLUSAO_COMPRA",
    module: "compras",
    entityType: "purchase_entry",
    entityId: purchaseId,
    before: {
      status: entry.status,
      number: entry.number,
      totalCents: toCents(entry.total),
      installments: entry.installments,
    },
    tenantId: ctx.tenantId,
    userId: ctx.userId ?? null,
  });

  return { purchaseId };
}

/**
 * OPEN → CONFIRMED: entrada no estoque (applyMovement) + conta a pagar
 * (parcelas a partir da data da entrada) — tudo na mesma transação.
 */
export async function confirmPurchase(
  tx: TenantTx,
  ctx: PurchaseContext,
  purchaseId: string,
): Promise<{ purchaseId: string; movements: number; payables: number }> {
  const entry = await lockPurchase(tx, ctx.tenantId, purchaseId);
  assertTransitionOrThrow(entry.status, "CONFIRMED");

  const items = await getItems(tx, ctx.tenantId, purchaseId);
  if (items.length === 0) throw new PurchaseError("Nota sem itens.");

  let movements = 0;
  for (const item of items) {
    try {
      await applyMovement(tx, {
        tenantId: ctx.tenantId,
        type: "ENTRADA_COMPRA",
        productId: item.productId,
        warehouseId: entry.warehouseId,
        quantity: item.quantity,
        unitCostCents: item.unitCostCents,
        batchNumber: item.batchNumber ?? undefined,
        batchExpiresAt: item.expiresAt,
        reason: "Compra",
        notes: formatPurchaseNumber(entry.number),
        userId: ctx.userId ?? null,
        referenceType: "PURCHASE",
        referenceId: purchaseId,
      });
    } catch (err) {
      if (err instanceof MovementError) {
        throw new PurchaseError(`Confirmação recusada: ${err.message}`);
      }
      throw err;
    }
    movements += 1;
  }

  // baseDate = dia calendário da entrada (coluna date = UTC midnight →
  // converter para meia-noite LOCAL do mesmo dia antes do splitInstallments)
  const baseDate = new Date(
    entry.entryDate.getUTCFullYear(),
    entry.entryDate.getUTCMonth(),
    entry.entryDate.getUTCDate(),
  );
  const { ids } = await createPayables(
    tx,
    { tenantId: ctx.tenantId, userId: ctx.userId },
    {
      sourceId: purchaseId,
      description: formatPurchaseNumber(entry.number),
      totalCents: toCents(entry.total),
      installments: entry.installments,
      baseDate,
    },
  );

  await tx
    .update(purchaseEntries)
    .set({ status: "CONFIRMED", confirmedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(purchaseEntries.tenantId, ctx.tenantId),
        eq(purchaseEntries.id, purchaseId),
      ),
    );

  await audit(tx, {
    action: "CONFIRMACAO_COMPRA",
    module: "compras",
    entityType: "purchase_entry",
    entityId: purchaseId,
    before: { status: entry.status },
    after: { status: "CONFIRMED", movements, payables: ids.length },
    tenantId: ctx.tenantId,
    userId: ctx.userId ?? null,
  });

  return { purchaseId, movements, payables: ids.length };
}

/** OPEN → CANCELLED (rascunho descartado — sem estoque/financeiro a estornar). */
export async function cancelPurchase(
  tx: TenantTx,
  ctx: PurchaseContext,
  purchaseId: string,
): Promise<{ purchaseId: string }> {
  const entry = await lockPurchase(tx, ctx.tenantId, purchaseId);
  assertTransitionOrThrow(entry.status, "CANCELLED");

  await tx
    .update(purchaseEntries)
    .set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(purchaseEntries.tenantId, ctx.tenantId),
        eq(purchaseEntries.id, purchaseId),
      ),
    );

  await audit(tx, {
    action: "CANCELAMENTO_COMPRA",
    module: "compras",
    entityType: "purchase_entry",
    entityId: purchaseId,
    before: { status: entry.status },
    after: { status: "CANCELLED" },
    tenantId: ctx.tenantId,
    userId: ctx.userId ?? null,
  });

  return { purchaseId };
}

// ---------------------------------------------------------------- leituras

export type PurchaseListRow = {
  id: string;
  number: number;
  status: PurchaseStatus;
  supplierName: string | null;
  totalCents: number;
  installments: number;
  entryDate: Date;
  itemCount: number;
  createdAt: Date;
};

export type ListPurchasesFilter = {
  status?: PurchaseStatus | "ALL";
  search?: string;
  page?: number;
  pageSize?: number;
};

export async function listPurchases(
  tx: TenantTx,
  tenantId: string,
  filter: ListPurchasesFilter = {},
): Promise<{ rows: PurchaseListRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 20, 1), 100);
  const page = Math.max(filter.page ?? 1, 1);
  const search = filter.search?.trim() ?? "";

  const conditions = [eq(purchaseEntries.tenantId, tenantId)];
  if (filter.status && filter.status !== "ALL") {
    conditions.push(eq(purchaseEntries.status, filter.status));
  }
  if (search) {
    const term = `%${search}%`;
    const numeroFormatado = sql<string>`concat(${PURCHASE_NUMBER_PREFIX}::text, '-', lpad(${purchaseEntries.number}::text, ${PURCHASE_NUMBER_WIDTH}::integer, '0'))`;
    conditions.push(
      sql`(${numeroFormatado} ILIKE ${term} OR ${suppliers.name} ILIKE ${term})`,
    );
  }

  const [countRow] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(purchaseEntries)
    .leftJoin(
      suppliers,
      and(
        eq(suppliers.id, purchaseEntries.supplierId),
        eq(suppliers.tenantId, purchaseEntries.tenantId),
      ),
    )
    .where(and(...conditions));

  const rows = await tx
    .select({
      id: purchaseEntries.id,
      number: purchaseEntries.number,
      status: purchaseEntries.status,
      supplierName: suppliers.name,
      total: purchaseEntries.total,
      installments: purchaseEntries.installments,
      entryDate: purchaseEntries.entryDate,
      createdAt: purchaseEntries.createdAt,
      itemCount: sql<number>`(
        SELECT count(*)::int FROM purchase_entry_items i
        WHERE i.purchase_entry_id = ${purchaseEntries.id}
          AND i.tenant_id = ${purchaseEntries.tenantId}
      )`,
    })
    .from(purchaseEntries)
    .leftJoin(
      suppliers,
      and(
        eq(suppliers.id, purchaseEntries.supplierId),
        eq(suppliers.tenantId, purchaseEntries.tenantId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(purchaseEntries.createdAt), desc(purchaseEntries.number))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      supplierName: r.supplierName,
      totalCents: Math.round(parseFloat(r.total) * 100),
      installments: r.installments,
      entryDate: r.entryDate,
      itemCount: r.itemCount,
      createdAt: r.createdAt,
    })),
    total: countRow?.n ?? 0,
    page,
    pageSize,
  };
}

export type PurchaseDetailItem = {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitCostCents: number;
  lineTotalCents: number;
  batchNumber: string | null;
  expiresAt: Date | null;
};

export type PurchaseDetail = {
  id: string;
  number: number;
  status: PurchaseStatus;
  supplierId: string;
  supplierName: string | null;
  warehouseId: string;
  warehouseName: string;
  documentNumber: string | null;
  entryDate: Date;
  totalCents: number;
  installments: number;
  notes: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  items: PurchaseDetailItem[];
};

export async function getPurchaseDetail(
  tx: TenantTx,
  tenantId: string,
  purchaseId: string,
): Promise<PurchaseDetail | null> {
  const [entry] = await tx
    .select({
      id: purchaseEntries.id,
      number: purchaseEntries.number,
      status: purchaseEntries.status,
      supplierId: purchaseEntries.supplierId,
      supplierName: suppliers.name,
      warehouseId: purchaseEntries.warehouseId,
      warehouseName: warehouses.name,
      documentNumber: purchaseEntries.documentNumber,
      entryDate: purchaseEntries.entryDate,
      total: purchaseEntries.total,
      installments: purchaseEntries.installments,
      notes: purchaseEntries.notes,
      createdAt: purchaseEntries.createdAt,
      confirmedAt: purchaseEntries.confirmedAt,
      cancelledAt: purchaseEntries.cancelledAt,
    })
    .from(purchaseEntries)
    .leftJoin(
      suppliers,
      and(
        eq(suppliers.id, purchaseEntries.supplierId),
        eq(suppliers.tenantId, purchaseEntries.tenantId),
      ),
    )
    .innerJoin(
      warehouses,
      and(
        eq(warehouses.id, purchaseEntries.warehouseId),
        eq(warehouses.tenantId, purchaseEntries.tenantId),
      ),
    )
    .where(
      and(
        eq(purchaseEntries.tenantId, tenantId),
        eq(purchaseEntries.id, purchaseId),
      ),
    )
    .limit(1);
  if (!entry) return null;

  const itemRows = await tx
    .select({
      id: purchaseEntryItems.id,
      productId: purchaseEntryItems.productId,
      sku: products.sku,
      productName: products.name,
      quantity: purchaseEntryItems.quantity,
      unitCost: purchaseEntryItems.unitCost,
      lineTotal: purchaseEntryItems.totalCost,
      batchNumber: purchaseEntryItems.batchNumber,
      expiresAt: purchaseEntryItems.expiresAt,
    })
    .from(purchaseEntryItems)
    .innerJoin(
      products,
      and(
        eq(products.id, purchaseEntryItems.productId),
        eq(products.tenantId, purchaseEntryItems.tenantId),
      ),
    )
    .where(
      and(
        eq(purchaseEntryItems.tenantId, tenantId),
        eq(purchaseEntryItems.purchaseEntryId, purchaseId),
      ),
    )
    .orderBy(purchaseEntryItems.createdAt, purchaseEntryItems.id);

  const cents = (v: string) => Math.round(parseFloat(v) * 100);

  return {
    id: entry.id,
    number: entry.number,
    status: entry.status,
    supplierId: entry.supplierId,
    supplierName: entry.supplierName,
    warehouseId: entry.warehouseId,
    warehouseName: entry.warehouseName,
    documentNumber: entry.documentNumber,
    entryDate: entry.entryDate,
    totalCents: cents(entry.total),
    installments: entry.installments,
    notes: entry.notes,
    createdAt: entry.createdAt,
    confirmedAt: entry.confirmedAt,
    cancelledAt: entry.cancelledAt,
    items: itemRows.map((i) => ({
      id: i.id,
      productId: i.productId,
      sku: i.sku,
      productName: i.productName,
      quantity: Number(i.quantity),
      unitCostCents: cents(i.unitCost),
      lineTotalCents: cents(i.lineTotal ?? "0"),
      batchNumber: i.batchNumber,
      expiresAt: i.expiresAt,
    })),
  };
}

// ------------------------------------------------------------- internos

async function lockPurchase(
  tx: TenantTx,
  tenantId: string,
  purchaseId: string,
): Promise<{
  id: string;
  status: PurchaseStatus;
  warehouseId: string;
  number: number;
  total: string;
  installments: number;
  entryDate: Date;
}> {
  const [entry] = await tx
    .select({
      id: purchaseEntries.id,
      status: purchaseEntries.status,
      warehouseId: purchaseEntries.warehouseId,
      number: purchaseEntries.number,
      total: purchaseEntries.total,
      installments: purchaseEntries.installments,
      entryDate: purchaseEntries.entryDate,
    })
    .from(purchaseEntries)
    .where(
      and(eq(purchaseEntries.tenantId, tenantId), eq(purchaseEntries.id, purchaseId)),
    )
    .for("update")
    .limit(1);
  if (!entry) throw new PurchaseError("Compra não encontrada.");
  return entry;
}

function assertEditable(status: PurchaseStatus): void {
  if (status !== "OPEN") {
    throw new PurchaseError(
      status === "CANCELLED"
        ? "Nota cancelada não pode ser editada."
        : "Nota confirmada não pode ser editada — confirmação é definitiva na v1.",
    );
  }
}

function assertTransitionOrThrow(from: PurchaseStatus, to: PurchaseStatus): void {
  const check = assertPurchaseTransition(from, to);
  if (!check.ok) throw new PurchaseError(check.reason);
}

async function getItems(
  tx: TenantTx,
  tenantId: string,
  purchaseId: string,
): Promise<
  {
    productId: string;
    quantity: number;
    unitCostCents: number;
    batchNumber: string | null;
    expiresAt: string | null;
  }[]
> {
  const rows = await tx
    .select({
      productId: purchaseEntryItems.productId,
      quantity: purchaseEntryItems.quantity,
      unitCost: purchaseEntryItems.unitCost,
      batchNumber: purchaseEntryItems.batchNumber,
      expiresAt: purchaseEntryItems.expiresAt,
    })
    .from(purchaseEntryItems)
    .where(
      and(
        eq(purchaseEntryItems.tenantId, tenantId),
        eq(purchaseEntryItems.purchaseEntryId, purchaseId),
      ),
    )
    .orderBy(purchaseEntryItems.createdAt, purchaseEntryItems.id);

  return rows.map((r) => ({
    productId: r.productId,
    quantity: Number(r.quantity),
    unitCostCents: Math.round(parseFloat(r.unitCost) * 100),
    batchNumber: r.batchNumber,
    // coluna date → "AAAA-MM-DD" (getters UTC) para o batchExpiresAt do movimento
    expiresAt: r.expiresAt
      ? `${String(r.expiresAt.getUTCFullYear()).padStart(4, "0")}-${String(
          r.expiresAt.getUTCMonth() + 1,
        ).padStart(2, "0")}-${String(r.expiresAt.getUTCDate()).padStart(2, "0")}`
      : null,
  }));
}
