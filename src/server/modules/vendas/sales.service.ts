import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  batchBalances,
  batches,
  customers,
  members,
  products,
  salesOrderItems,
  salesOrders,
  stockBalances,
  stockReservations,
  tenantSettings,
  users,
  warehouses,
} from "@/server/db/schema";
import type { TenantTx } from "@/server/tenant/with-tenant";
import { fromCents } from "@/lib/money";
import { nextCounter } from "@/server/db/counter";
import {
  applyMovement,
  MovementError,
} from "@/server/modules/estoque/movement.service";
import { selectFefoBatch } from "@/server/modules/estoque/fefo-rules";
import {
  SALE_NUMBER_PREFIX,
  SALE_NUMBER_WIDTH,
  assertTransition,
  calcSaleTotals,
  validateSaleDiscount,
  validateSaleEditing,
  type SaleStatus,
  type SaleTotals,
} from "./sales-rules";

// Vendas (Fase 10): DRAFT → CONFIRMED → BILLED, com reserva de estoque na
// confirmação e baixa (applyMovement) no faturamento. Tudo roda dentro de
// withTenant() (RLS); totais e desconto SEMPRE recalculados no servidor.

export class SaleError extends Error {}

export type SaleContext = {
  tenantId: string;
  userId?: string | null;
  /** papel do usuário na empresa (members.role) */
  role: string;
  /** resolvePermissions(role).includes("sales.discount") */
  salesDiscount: boolean;
};

export type SaleItemInput = {
  productId: string;
  quantity: number;
  unitPriceCents: number;
  discountCents?: number;
};

export type SaleInput = {
  warehouseId: string;
  customerId?: string | null;
  sellerId?: string | null;
  notes?: string | null;
  items: readonly SaleItemInput[];
  orderDiscountCents?: number;
};

const COUNTER_KEY = "sale";

type Settings = {
  maxDescontoVendedorPct: number;
  maxDescontoGerentePct: number;
  reservaEstoque: boolean;
  expiraReservaHoras: number;
  bloqueioVendaVencido: boolean;
};

function qtyDb(n: number): string {
  return n.toFixed(3);
}

function fmtQty(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function parsePct(value: string | null | undefined): number {
  const n = value === null || value === undefined ? NaN : parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function loadSettings(tx: TenantTx, tenantId: string): Promise<Settings> {
  const [s] = await tx
    .select({
      maxDescontoVendedor: tenantSettings.maxDescontoVendedor,
      maxDescontoGerente: tenantSettings.maxDescontoGerente,
      reservaEstoque: tenantSettings.reservaEstoque,
      expiraReservaHoras: tenantSettings.expiraReservaHoras,
      bloqueioVendaVencido: tenantSettings.bloqueioVendaVencido,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1);

  return {
    maxDescontoVendedorPct: parsePct(s?.maxDescontoVendedor),
    maxDescontoGerentePct: parsePct(s?.maxDescontoGerente),
    reservaEstoque: s?.reservaEstoque ?? true,
    expiraReservaHoras: s?.expiraReservaHoras ?? 24,
    bloqueioVendaVencido: s?.bloqueioVendaVencido ?? false,
  };
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
  if (!w) throw new SaleError("Depósito não encontrado.");
}

async function assertCustomer(
  tx: TenantTx,
  tenantId: string,
  customerId: string,
): Promise<void> {
  const [c] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, tenantId),
        eq(customers.id, customerId),
        isNull(customers.deletedAt),
      ),
    )
    .limit(1);
  if (!c) throw new SaleError("Cliente não encontrado.");
}

async function assertSeller(
  tx: TenantTx,
  tenantId: string,
  sellerId: string,
): Promise<void> {
  const [m] = await tx
    .select({ userId: members.userId })
    .from(members)
    .where(
      and(eq(members.organizationId, tenantId), eq(members.userId, sellerId)),
    )
    .limit(1);
  if (!m) throw new SaleError("Vendedor não faz parte desta empresa.");
}

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  status: string;
  trackBatch: boolean;
  salePrice: string;
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
      salePrice: products.salePrice,
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

function centsDb(cents: number): string {
  return fromCents(cents);
}

/** Totais + limite de desconto do papel — sempre no servidor. */
async function prepareTotals(
  tx: TenantTx,
  ctx: SaleContext,
  input: SaleInput,
): Promise<{ totals: SaleTotals; settings: Settings }> {
  const settings = await loadSettings(tx, ctx.tenantId);

  const totalsResult = calcSaleTotals(input.items, {
    orderDiscountCents: input.orderDiscountCents ?? 0,
  });
  if (!totalsResult.ok) throw new SaleError(totalsResult.reason);

  const discountCheck = validateSaleDiscount({
    role: ctx.role,
    salesDiscount: ctx.salesDiscount,
    subtotalCents: totalsResult.totals.subtotalCents,
    itemDiscountCents: totalsResult.totals.itemDiscountCents,
    orderDiscountCents: totalsResult.totals.orderDiscountCents,
    maxDescontoVendedorPct: settings.maxDescontoVendedorPct,
    maxDescontoGerentePct: settings.maxDescontoGerentePct,
  });
  if (!discountCheck.ok) throw new SaleError(discountCheck.reason);

  return { totals: totalsResult.totals, settings };
}

async function writeItems(
  tx: TenantTx,
  tenantId: string,
  saleId: string,
  items: readonly SaleItemInput[],
): Promise<void> {
  const now = new Date();
  const values = items.map((it) => ({
    tenantId,
    salesOrderId: saleId,
    productId: it.productId,
    batchId: null,
    quantity: qtyDb(it.quantity),
    unitPrice: centsDb(it.unitPriceCents),
    discount: centsDb(it.discountCents ?? 0),
    createdAt: now,
    updatedAt: now,
  }));
  await tx.insert(salesOrderItems).values(values);
}

/** Cria o rascunho (DRAFT) com numeração por tenant e totais recalculados. */
export async function createSale(
  tx: TenantTx,
  ctx: SaleContext,
  input: SaleInput,
): Promise<{ saleId: string; number: number; totals: SaleTotals }> {
  if (input.items.length === 0) {
    throw new SaleError("Pedido sem itens: adicione ao menos um item.");
  }

  await assertWarehouse(tx, ctx.tenantId, input.warehouseId);
  if (input.customerId) await assertCustomer(tx, ctx.tenantId, input.customerId);
  const sellerId = input.sellerId ?? ctx.userId ?? null;
  if (sellerId) await assertSeller(tx, ctx.tenantId, sellerId);

  const catalog = await loadProducts(
    tx,
    ctx.tenantId,
    input.items.map((i) => i.productId),
  );
  for (const item of input.items) {
    const p = catalog.get(item.productId);
    if (!p) throw new SaleError("Produto não encontrado.");
    if (p.status !== "ACTIVE") {
      throw new SaleError(`Produto ${p.sku} não está ativo.`);
    }
  }

  const { totals } = await prepareTotals(tx, ctx, input);
  const number = await nextCounter(tx, ctx.tenantId, COUNTER_KEY);

  const [order] = await tx
    .insert(salesOrders)
    .values({
      tenantId: ctx.tenantId,
      number,
      customerId: input.customerId ?? null,
      warehouseId: input.warehouseId,
      sellerId,
      status: "DRAFT",
      subtotal: centsDb(totals.subtotalCents),
      itemDiscount: centsDb(totals.itemDiscountCents),
      orderDiscount: centsDb(totals.orderDiscountCents),
      total: centsDb(totals.totalCents),
      notes: input.notes?.trim() || null,
    })
    .returning({ id: salesOrders.id });

  await writeItems(tx, ctx.tenantId, order.id, input.items);

  return { saleId: order.id, number, totals };
}

/** Substitui o conteúdo de um rascunho (somente DRAFT). */
export async function updateSale(
  tx: TenantTx,
  ctx: SaleContext,
  saleId: string,
  input: SaleInput,
): Promise<{ saleId: string; totals: SaleTotals }> {
  const order = await lockOrder(tx, ctx.tenantId, saleId);
  assertEditable(order.status);

  if (input.items.length === 0) {
    throw new SaleError("Pedido sem itens: adicione ao menos um item.");
  }

  await assertWarehouse(tx, ctx.tenantId, input.warehouseId);
  if (input.customerId) await assertCustomer(tx, ctx.tenantId, input.customerId);
  const sellerId = input.sellerId ?? order.sellerId ?? ctx.userId ?? null;
  if (sellerId) await assertSeller(tx, ctx.tenantId, sellerId);

  const catalog = await loadProducts(
    tx,
    ctx.tenantId,
    input.items.map((i) => i.productId),
  );
  for (const item of input.items) {
    const p = catalog.get(item.productId);
    if (!p) throw new SaleError("Produto não encontrado.");
    if (p.status !== "ACTIVE") {
      throw new SaleError(`Produto ${p.sku} não está ativo.`);
    }
  }

  const { totals } = await prepareTotals(tx, ctx, input);

  await tx
    .delete(salesOrderItems)
    .where(
      and(
        eq(salesOrderItems.tenantId, ctx.tenantId),
        eq(salesOrderItems.salesOrderId, saleId),
      ),
    );
  await writeItems(tx, ctx.tenantId, saleId, input.items);

  await tx
    .update(salesOrders)
    .set({
      customerId: input.customerId ?? null,
      warehouseId: input.warehouseId,
      sellerId,
      subtotal: centsDb(totals.subtotalCents),
      itemDiscount: centsDb(totals.itemDiscountCents),
      orderDiscount: centsDb(totals.orderDiscountCents),
      total: centsDb(totals.totalCents),
      notes: input.notes?.trim() || null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(salesOrders.tenantId, ctx.tenantId), eq(salesOrders.id, saleId)),
    );

  return { saleId, totals };
}

/** Apaga o rascunho (somente DRAFT). */
export async function deleteSale(
  tx: TenantTx,
  ctx: SaleContext,
  saleId: string,
): Promise<{ saleId: string }> {
  const order = await lockOrder(tx, ctx.tenantId, saleId);
  assertEditable(order.status);

  await tx
    .delete(salesOrderItems)
    .where(
      and(
        eq(salesOrderItems.tenantId, ctx.tenantId),
        eq(salesOrderItems.salesOrderId, saleId),
      ),
    );
  await tx
    .delete(salesOrders)
    .where(
      and(eq(salesOrders.tenantId, ctx.tenantId), eq(salesOrders.id, saleId)),
    );

  return { saleId };
}

/** CONFIRMED → reserva estoque (quando tenant_settings.reserva_estoque). */
export async function confirmSale(
  tx: TenantTx,
  ctx: SaleContext,
  saleId: string,
): Promise<{ saleId: string; reserved: number }> {
  const order = await lockOrder(tx, ctx.tenantId, saleId);
  assertTransitionOrThrow(order.status, "CONFIRMED");

  const settings = await loadSettings(tx, ctx.tenantId);
  const items = await getItems(tx, ctx.tenantId, saleId);
  if (items.length === 0) throw new SaleError("Venda sem itens.");

  let reserved = 0;
  if (settings.reservaEstoque) {
    const expiresAt = new Date(
      Date.now() + settings.expiraReservaHoras * 3_600_000,
    );
    for (const item of items) {
      await reserveItem(
        tx,
        ctx.tenantId,
        order.warehouseId,
        saleId,
        item,
        expiresAt,
      );
      reserved += item.quantity;
    }
  }

  await tx
    .update(salesOrders)
    .set({
      status: "CONFIRMED",
      confirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(salesOrders.tenantId, ctx.tenantId), eq(salesOrders.id, saleId)),
    );

  return { saleId, reserved };
}

/** Libera a reserva (DRAFT/CONFIRMED → CANCELLED). */
export async function cancelSale(
  tx: TenantTx,
  ctx: SaleContext,
  saleId: string,
): Promise<{ saleId: string; released: number }> {
  const order = await lockOrder(tx, ctx.tenantId, saleId);
  assertTransitionOrThrow(order.status, "CANCELLED");

  const released = await settleReservations(
    tx,
    ctx.tenantId,
    saleId,
    "RELEASED",
  );

  await tx
    .update(salesOrders)
    .set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(salesOrders.tenantId, ctx.tenantId), eq(salesOrders.id, saleId)),
    );

  return { saleId, released };
}

/**
 * CONFIRMED → BILLED: consome a reserva (libera o `reserved`), baixa o estoque
 * via applyMovement (FEFO/bloqueio de vencido já resolvem lá) e marca faturada.
 * Fase 11 gera as parcelas a receber.
 */
export async function billSale(
  tx: TenantTx,
  ctx: SaleContext,
  saleId: string,
): Promise<{ saleId: string; movements: number }> {
  const order = await lockOrder(tx, ctx.tenantId, saleId);
  assertTransitionOrThrow(order.status, "BILLED");

  const settings = await loadSettings(tx, ctx.tenantId);
  const items = await getItems(tx, ctx.tenantId, saleId);
  if (items.length === 0) throw new SaleError("Venda sem itens.");

  const catalog = await loadProducts(
    tx,
    ctx.tenantId,
    items.map((i) => i.productId),
  );

  // 1) consome a reserva ANTES de baixar: senão o próprio `reserved` derruba
  //    o disponível na checagem do applyMovement.
  await settleReservations(tx, ctx.tenantId, saleId, "CONSUMED");

  // 2) baixa de estoque item a item
  let movements = 0;
  for (const item of items) {
    const product = catalog.get(item.productId);
    if (!product) throw new SaleError("Produto não encontrado.");

    const batch = await resolveBatch(
      tx,
      ctx.tenantId,
      order.warehouseId,
      product,
      item.quantity,
      settings,
    );

    try {
      await applyMovement(tx, {
        tenantId: ctx.tenantId,
        type: "SAIDA_VENDA",
        productId: item.productId,
        warehouseId: order.warehouseId,
        quantity: item.quantity,
        batchNumber: batch?.batchNumber,
        reason: "Venda",
        notes: `VENDA-${String(order.number).padStart(6, "0")}`,
        userId: ctx.userId ?? null,
        referenceType: "SALE",
        referenceId: saleId,
      });
    } catch (err) {
      if (err instanceof MovementError) {
        throw new SaleError(`Faturamento recusado: ${err.message}`);
      }
      throw err;
    }

    if (batch?.batchId && item.batchId !== batch.batchId) {
      await tx
        .update(salesOrderItems)
        .set({ batchId: batch.batchId, updatedAt: new Date() })
        .where(
          and(
            eq(salesOrderItems.tenantId, ctx.tenantId),
            eq(salesOrderItems.id, item.id),
          ),
        );
    }
    movements += 1;
  }

  await tx
    .update(salesOrders)
    .set({ status: "BILLED", billedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(salesOrders.tenantId, ctx.tenantId), eq(salesOrders.id, saleId)),
    );

  return { saleId, movements };
}

// ---------------------------------------------------------------- leituras

export type SaleListRow = {
  id: string;
  number: number;
  status: SaleStatus;
  customerName: string | null;
  totalCents: number;
  itemCount: number;
  createdAt: Date;
};

export type ListSalesFilter = {
  status?: SaleStatus | "ALL";
  search?: string;
  page?: number;
  pageSize?: number;
};

export async function listSales(
  tx: TenantTx,
  tenantId: string,
  filter: ListSalesFilter = {},
): Promise<{ rows: SaleListRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 20, 1), 100);
  const page = Math.max(filter.page ?? 1, 1);
  const search = filter.search?.trim() ?? "";

  const conditions = [eq(salesOrders.tenantId, tenantId)];
  if (filter.status && filter.status !== "ALL") {
    conditions.push(eq(salesOrders.status, filter.status));
  }
  if (search) {
    const term = `%${search}%`;
    // Busca pelo número COMO EXIBIDO na UI ("VENDA-000001"), não pelo inteiro.
    const numeroFormatado = sql<string>`concat(${SALE_NUMBER_PREFIX}::text, '-', lpad(${salesOrders.number}::text, ${SALE_NUMBER_WIDTH}::integer, '0'))`;
    conditions.push(
      sql`(${numeroFormatado} ILIKE ${term} OR ${customers.name} ILIKE ${term})`,
    );
  }

  const [countRow] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(salesOrders)
    .leftJoin(
      customers,
      and(
        eq(customers.id, salesOrders.customerId),
        eq(customers.tenantId, salesOrders.tenantId),
      ),
    )
    .where(and(...conditions));

  const rows = await tx
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      customerName: customers.name,
      total: salesOrders.total,
      createdAt: salesOrders.createdAt,
      itemCount: sql<number>`(
        SELECT count(*)::int FROM sales_order_items i
        WHERE i.sales_order_id = ${salesOrders.id}
          AND i.tenant_id = ${salesOrders.tenantId}
      )`,
    })
    .from(salesOrders)
    .leftJoin(
      customers,
      and(
        eq(customers.id, salesOrders.customerId),
        eq(customers.tenantId, salesOrders.tenantId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(salesOrders.createdAt), desc(salesOrders.number))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      customerName: r.customerName,
      totalCents: Math.round(parseFloat(r.total) * 100),
      itemCount: r.itemCount,
      createdAt: r.createdAt,
    })),
    total: countRow?.n ?? 0,
    page,
    pageSize,
  };
}

export type SaleDetailItem = {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  lineTotalCents: number;
  batchNumber: string | null;
};

export type SaleDetail = {
  id: string;
  number: number;
  status: SaleStatus;
  customerId: string | null;
  customerName: string | null;
  warehouseId: string;
  warehouseName: string;
  sellerId: string | null;
  sellerName: string | null;
  subtotalCents: number;
  itemDiscountCents: number;
  orderDiscountCents: number;
  totalCents: number;
  notes: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  billedAt: Date | null;
  cancelledAt: Date | null;
  items: SaleDetailItem[];
};

export async function getSaleDetail(
  tx: TenantTx,
  tenantId: string,
  saleId: string,
): Promise<SaleDetail | null> {
  const [order] = await tx
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      customerId: salesOrders.customerId,
      customerName: customers.name,
      warehouseId: salesOrders.warehouseId,
      warehouseName: warehouses.name,
      sellerId: salesOrders.sellerId,
      sellerName: users.name,
      subtotal: salesOrders.subtotal,
      itemDiscount: salesOrders.itemDiscount,
      orderDiscount: salesOrders.orderDiscount,
      total: salesOrders.total,
      notes: salesOrders.notes,
      createdAt: salesOrders.createdAt,
      confirmedAt: salesOrders.confirmedAt,
      billedAt: salesOrders.billedAt,
      cancelledAt: salesOrders.cancelledAt,
    })
    .from(salesOrders)
    .leftJoin(
      customers,
      and(
        eq(customers.id, salesOrders.customerId),
        eq(customers.tenantId, salesOrders.tenantId),
      ),
    )
    .innerJoin(
      warehouses,
      and(
        eq(warehouses.id, salesOrders.warehouseId),
        eq(warehouses.tenantId, salesOrders.tenantId),
      ),
    )
    .leftJoin(users, eq(users.id, salesOrders.sellerId))
    .where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, saleId)))
    .limit(1);
  if (!order) return null;

  const itemRows = await tx
    .select({
      id: salesOrderItems.id,
      productId: salesOrderItems.productId,
      sku: products.sku,
      productName: products.name,
      quantity: salesOrderItems.quantity,
      unitPrice: salesOrderItems.unitPrice,
      discount: salesOrderItems.discount,
      lineTotal: salesOrderItems.lineTotal,
      batchNumber: batches.batchNumber,
    })
    .from(salesOrderItems)
    .innerJoin(
      products,
      and(
        eq(products.id, salesOrderItems.productId),
        eq(products.tenantId, salesOrderItems.tenantId),
      ),
    )
    .leftJoin(
      batches,
      and(
        eq(batches.id, salesOrderItems.batchId),
        eq(batches.tenantId, salesOrderItems.tenantId),
      ),
    )
    .where(
      and(
        eq(salesOrderItems.tenantId, tenantId),
        eq(salesOrderItems.salesOrderId, saleId),
      ),
    )
    .orderBy(salesOrderItems.createdAt, salesOrderItems.id);

  const cents = (v: string) => Math.round(parseFloat(v) * 100);

  return {
    id: order.id,
    number: order.number,
    status: order.status,
    customerId: order.customerId,
    customerName: order.customerName,
    warehouseId: order.warehouseId,
    warehouseName: order.warehouseName,
    sellerId: order.sellerId,
    sellerName: order.sellerName,
    subtotalCents: cents(order.subtotal),
    itemDiscountCents: cents(order.itemDiscount),
    orderDiscountCents: cents(order.orderDiscount),
    totalCents: cents(order.total),
    notes: order.notes,
    createdAt: order.createdAt,
    confirmedAt: order.confirmedAt,
    billedAt: order.billedAt,
    cancelledAt: order.cancelledAt,
    items: itemRows.map((i) => ({
      id: i.id,
      productId: i.productId,
      sku: i.sku,
      productName: i.productName,
      quantity: Number(i.quantity),
      unitPriceCents: cents(i.unitPrice),
      discountCents: cents(i.discount),
      lineTotalCents: cents(i.lineTotal ?? "0"),
      batchNumber: i.batchNumber,
    })),
  };
}

// ------------------------------------------------------------- internos

async function lockOrder(
  tx: TenantTx,
  tenantId: string,
  saleId: string,
): Promise<{
  id: string;
  status: SaleStatus;
  warehouseId: string;
  number: number;
  sellerId: string | null;
}> {
  const [order] = await tx
    .select({
      id: salesOrders.id,
      status: salesOrders.status,
      warehouseId: salesOrders.warehouseId,
      number: salesOrders.number,
      sellerId: salesOrders.sellerId,
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, saleId)))
    .for("update")
    .limit(1);
  if (!order) throw new SaleError("Venda não encontrada.");
  return order;
}

function assertEditable(status: SaleStatus): void {
  const check = validateSaleEditing(status);
  if (!check.ok) throw new SaleError(check.reason);
}

function assertTransitionOrThrow(from: SaleStatus, to: SaleStatus): void {
  const check = assertTransition(from, to);
  if (!check.ok) throw new SaleError(check.reason);
}

async function getItems(
  tx: TenantTx,
  tenantId: string,
  saleId: string,
): Promise<
  { id: string; productId: string; quantity: number; batchId: string | null }[]
> {
  const rows = await tx
    .select({
      id: salesOrderItems.id,
      productId: salesOrderItems.productId,
      quantity: salesOrderItems.quantity,
      batchId: salesOrderItems.batchId,
    })
    .from(salesOrderItems)
    .where(
      and(
        eq(salesOrderItems.tenantId, tenantId),
        eq(salesOrderItems.salesOrderId, saleId),
      ),
    )
    .orderBy(salesOrderItems.createdAt, salesOrderItems.id);

  return rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    quantity: Number(r.quantity),
    batchId: r.batchId,
  }));
}

/** Reserva por item: trava o saldo, chega disponibilidade e sobe `reserved`. */
async function reserveItem(
  tx: TenantTx,
  tenantId: string,
  warehouseId: string,
  saleId: string,
  item: { productId: string; quantity: number },
  expiresAt: Date,
): Promise<void> {
  const where = and(
    eq(stockBalances.tenantId, tenantId),
    eq(stockBalances.productId, item.productId),
    eq(stockBalances.warehouseId, warehouseId),
  );

  await tx
    .insert(stockBalances)
    .values({
      tenantId,
      productId: item.productId,
      warehouseId,
      quantity: "0",
      reserved: "0",
    })
    .onConflictDoNothing();

  const [bal] = await tx
    .select()
    .from(stockBalances)
    .where(where)
    .for("update")
    .limit(1);
  if (!bal) throw new SaleError("Saldo não encontrado (erro interno).");

  const quantity = Number(bal.quantity);
  const reserved = Number(bal.reserved);
  const available = quantity - reserved;
  if (available < item.quantity) {
    throw new SaleError(
      `Saldo insuficiente para reservar: disponível ${fmtQty(available)}.`,
    );
  }

  await tx
    .update(stockBalances)
    .set({ reserved: qtyDb(reserved + item.quantity), updatedAt: new Date() })
    .where(where);

  await tx.insert(stockReservations).values({
    tenantId,
    productId: item.productId,
    warehouseId,
    quantity: qtyDb(item.quantity),
    status: "ACTIVE",
    referenceType: "SALE",
    referenceId: saleId,
    expiresAt,
  });
}

/**
 * Sai as reservas ATIVAS da venda (RELEASED no cancelamento, CONSUMED no
 * faturamento) e baixa `stock_balances.reserved` na mesma transação.
 */
async function settleReservations(
  tx: TenantTx,
  tenantId: string,
  saleId: string,
  next: "RELEASED" | "CONSUMED",
): Promise<number> {
  const rows = await tx
    .select({
      id: stockReservations.id,
      productId: stockReservations.productId,
      warehouseId: stockReservations.warehouseId,
      quantity: stockReservations.quantity,
    })
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.tenantId, tenantId),
        eq(stockReservations.referenceType, "SALE"),
        eq(stockReservations.referenceId, saleId),
        eq(stockReservations.status, "ACTIVE"),
      ),
    )
    .for("update");

  for (const r of rows) {
    await tx
      .update(stockReservations)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(stockReservations.id, r.id));

    const where = and(
      eq(stockBalances.tenantId, tenantId),
      eq(stockBalances.productId, r.productId),
      eq(stockBalances.warehouseId, r.warehouseId),
    );
    const [bal] = await tx
      .select()
      .from(stockBalances)
      .where(where)
      .for("update")
      .limit(1);
    if (bal) {
      const released = Math.max(Number(bal.reserved) - Number(r.quantity), 0);
      await tx
        .update(stockBalances)
        .set({ reserved: qtyDb(released), updatedAt: new Date() })
        .where(where);
    }
  }

  return rows.length;
}

/**
 * Escolhe o lote da saída quando o produto controla lote: FEFO com uma única
 * fonte (selectFefoBatch) — respeita `bloqueio_venda_vencido`.
 */
async function resolveBatch(
  tx: TenantTx,
  tenantId: string,
  warehouseId: string,
  product: { id: string; trackBatch: boolean },
  quantity: number,
  settings: Settings,
): Promise<{ batchNumber: string; batchId: string } | null> {
  if (!product.trackBatch) return null;

  const lotes = await tx
    .select({
      id: batches.id,
      batchNumber: batches.batchNumber,
      expiresAt: batches.expiresAt,
      createdAt: batches.createdAt,
      available: batchBalances.quantity,
    })
    .from(batches)
    .innerJoin(
      batchBalances,
      and(
        eq(batchBalances.batchId, batches.id),
        eq(batchBalances.warehouseId, warehouseId),
        eq(batchBalances.tenantId, batches.tenantId),
      ),
    )
    .where(
      and(eq(batches.tenantId, tenantId), eq(batches.productId, product.id)),
    );

  const plano = selectFefoBatch(
    lotes.map((l) => ({
      batchNumber: l.batchNumber,
      expiresAt: toYmd(l.expiresAt),
      createdAt: toIso(l.createdAt),
      available: Number(l.available),
    })),
    quantity,
    { bloqueioVencido: settings.bloqueioVendaVencido },
  );
  if (!plano.ok) throw new SaleError(plano.reason);

  const chosen = lotes.find((l) => l.batchNumber === plano.batchNumber);
  if (!chosen) throw new SaleError("Lote não encontrado (erro interno).");
  return { batchNumber: chosen.batchNumber, batchId: chosen.id };
}

function toYmd(d: Date | string | null): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

function toIso(d: Date | string): string {
  return (d instanceof Date ? d : new Date(d)).toISOString();
}
