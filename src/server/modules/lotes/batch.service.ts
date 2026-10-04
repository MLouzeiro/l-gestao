import { and, eq, isNull, sql } from "drizzle-orm";
import {
  batchBalances,
  batches,
  customers,
  products,
  salesOrders,
  stockMovements,
  tenantSettings,
  users,
  warehouses,
} from "@/server/db/schema";
import type { TenantTx } from "@/server/tenant/with-tenant";
import {
  batchLabelData,
  classifyExpiry,
  daysUntil,
  expiryLabel,
  summarizeTrace,
  type BatchLabel,
  type ExpiryStatus,
  type TraceMovement,
  type TraceSummary,
} from "./batch-rules";

// Lotes e validade (E5): visão de lotes com saldo por unidade, rastreio
// lote → movimentações → vendas → clientes e alertas de vencimento.
// Somente leitura — o livro de movimentações continua sendo a única fonte.

export type LoteItem = {
  batchId: string;
  productId: string;
  productName: string;
  sku: string;
  batchNumber: string;
  expiresAt: string | null;
  daysToExpire: number | null;
  status: ExpiryStatus;
  statusLabel: string;
  totalQty: number;
  warehouses: { name: string; qty: number }[];
};

export type AlertaValidade = {
  batchId: string;
  productId: string;
  productName: string;
  sku: string;
  batchNumber: string;
  expiresAt: string | null;
  daysToExpire: number;
  status: ExpiryStatus;
  statusLabel: string;
  qty: number;
};

export type RastreioLote = {
  batchId: string;
  productName: string;
  sku: string;
  batchNumber: string;
  expiresAt: string | null;
  label: BatchLabel;
  summary: TraceSummary;
  movements: TraceMovement[];
};

const toYmd = (d: Date | string | null): string | null => {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
};

async function alertWindows(
  tx: TenantTx,
  tenantId: string,
): Promise<number[]> {
  const [s] = await tx
    .select({ dias: tenantSettings.diasAlertaValidade })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1);
  return (s?.dias ?? []).map(Number);
}

/** Lotes com saldo por unidade + classificação de validade. */
export async function listBatches(
  tx: TenantTx,
  tenantId: string,
  opts?: { productId?: string; warehouseId?: string; somenteAlerta?: boolean },
): Promise<LoteItem[]> {
  const janelas = await alertWindows(tx, tenantId);
  const hoje = toYmd(new Date())!;

  const rows = await tx
    .select({
      batchId: batches.id,
      productId: products.id,
      productName: products.name,
      sku: products.sku,
      batchNumber: batches.batchNumber,
      expiresAt: batches.expiresAt,
      whName: warehouses.name,
      qty: batchBalances.quantity,
    })
    .from(batchBalances)
    .innerJoin(
      batches,
      and(
        eq(batches.id, batchBalances.batchId),
        eq(batches.tenantId, batchBalances.tenantId),
      ),
    )
    .innerJoin(
      products,
      and(
        eq(products.id, batches.productId),
        eq(products.tenantId, batches.tenantId),
      ),
    )
    .innerJoin(
      warehouses,
      and(
        eq(warehouses.id, batchBalances.warehouseId),
        eq(warehouses.tenantId, batchBalances.tenantId),
      ),
    )
    .where(
      and(
        eq(batchBalances.tenantId, tenantId),
        opts?.productId ? eq(batches.productId, opts.productId) : undefined,
        opts?.warehouseId
          ? eq(batchBalances.warehouseId, opts.warehouseId)
          : undefined,
      ),
    );

  const byBatch = new Map<string, LoteItem>();
  for (const r of rows) {
    const ymd = toYmd(r.expiresAt);
    const status = classifyExpiry(ymd, janelas, hoje);
    let item = byBatch.get(r.batchId);
    if (!item) {
      item = {
        batchId: r.batchId,
        productId: r.productId,
        productName: r.productName,
        sku: r.sku,
        batchNumber: r.batchNumber,
        expiresAt: ymd,
        daysToExpire: daysUntil(ymd, hoje),
        status,
        statusLabel: expiryLabel(status),
        totalQty: 0,
        warehouses: [],
      };
      byBatch.set(r.batchId, item);
    }
    const qty = Number(r.qty);
    item.totalQty += qty;
    if (qty > 0) item.warehouses.push({ name: r.whName, qty });
  }

  let items = [...byBatch.values()].filter((i) => i.totalQty > 0);
  if (opts?.somenteAlerta) {
    items = items.filter(
      (i) => i.status === "VENCIDO" || i.status === "CRITICO" || i.status === "PROXIMO",
    );
  }
  return items.sort((a, b) =>
    (a.expiresAt ?? "9999").localeCompare(b.expiresAt ?? "9999"),
  );
}

/** Alertas de validade: lotes com saldo que entram nas janelas (inclusive vencidos). */
export async function listExpiryAlerts(
  tx: TenantTx,
  tenantId: string,
): Promise<AlertaValidade[]> {
  const items = await listBatches(tx, tenantId, { somenteAlerta: true });
  return items.map((i) => ({
    batchId: i.batchId,
    productId: i.productId,
    productName: i.productName,
    sku: i.sku,
    batchNumber: i.batchNumber,
    expiresAt: i.expiresAt,
    daysToExpire: i.daysToExpire ?? 0,
    status: i.status,
    statusLabel: i.statusLabel,
    qty: i.totalQty,
  }));
}

/**
 * Rastreio do lote: movimentações (com venda/cliente quando aplicável),
 * consolidação (entradas/saídas/saldo/vendas/clientes) e dados da etiqueta.
 */
export async function getBatchTrace(
  tx: TenantTx,
  tenantId: string,
  batchId: string,
): Promise<RastreioLote | null> {
  const [b] = await tx
    .select({
      batchId: batches.id,
      productId: products.id,
      productName: products.name,
      sku: products.sku,
      barcode: products.barcode,
      batchNumber: batches.batchNumber,
      expiresAt: batches.expiresAt,
    })
    .from(batches)
    .innerJoin(
      products,
      and(
        eq(products.id, batches.productId),
        eq(products.tenantId, batches.tenantId),
      ),
    )
    .where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId)))
    .limit(1);
  if (!b) return null;

  const movRows = await tx
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      occurredAt: stockMovements.occurredAt,
      whName: warehouses.name,
      userName: users.name,
      referenceType: stockMovements.referenceType,
      referenceId: stockMovements.referenceId,
    })
    .from(stockMovements)
    .innerJoin(
      warehouses,
      and(
        eq(warehouses.id, stockMovements.warehouseId),
        eq(warehouses.tenantId, stockMovements.tenantId),
      ),
    )
    .leftJoin(users, eq(users.id, stockMovements.userId))
    .where(
      and(
        eq(stockMovements.tenantId, tenantId),
        eq(stockMovements.batchId, batchId),
      ),
    )
    .orderBy(stockMovements.occurredAt);

  // Vendas/clientes das saídas com referenceType SALE (sequencial no mesmo tx)
  const saleIds = movRows
    .filter((m) => m.referenceType === "SALE" && m.referenceId)
    .map((m) => m.referenceId!);
  const saleMap = new Map<
    string,
    { saleNumber: number; customerName: string | null }
  >();
  for (const saleId of saleIds) {
    const [s] = await tx
      .select({
        saleNumber: salesOrders.number,
        customerName: customers.name,
      })
      .from(salesOrders)
      .leftJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(
        and(
          eq(salesOrders.tenantId, tenantId),
          eq(salesOrders.id, saleId),
        ),
      )
      .limit(1);
    if (s) {
      saleMap.set(saleId, { saleNumber: s.saleNumber, customerName: s.customerName });
    }
  }

  const movements: TraceMovement[] = movRows.map((m) => {
    const sale = m.referenceType === "SALE" && m.referenceId
      ? saleMap.get(m.referenceId)
      : undefined;
    return {
      id: m.id,
      type: m.type,
      quantity: Number(m.quantity),
      occurredAt: m.occurredAt.toISOString(),
      warehouseName: m.whName,
      userName: m.userName,
      saleId: m.referenceType === "SALE" ? m.referenceId : null,
      saleNumber: sale?.saleNumber ?? null,
      customerName: sale?.customerName ?? null,
    };
  });

  const ymd = toYmd(b.expiresAt);
  const totalQty = movements.reduce(
    (acc, m) => acc + (m.type.startsWith("ENTRADA") ? m.quantity : -m.quantity),
    0,
  );

  return {
    batchId: b.batchId,
    productName: b.productName,
    sku: b.sku,
    batchNumber: b.batchNumber,
    expiresAt: ymd,
    label: batchLabelData({
      productName: b.productName,
      sku: b.sku,
      barcode: b.barcode,
      batchNumber: b.batchNumber,
      expiresAt: ymd,
      quantity: totalQty,
    }),
    summary: summarizeTrace(movements),
    movements,
  };
}

/** Configuração da janela de alerta de validade (dias). */
export async function getAlertSettings(
  tx: TenantTx,
  tenantId: string,
): Promise<number[]> {
  return alertWindows(tx, tenantId);
}
