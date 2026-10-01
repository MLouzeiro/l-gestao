import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  batchBalances,
  batches,
  inventoryItems,
  inventories,
  products,
  stockBalances,
  warehouses,
} from "@/server/db/schema";
import type { TenantTx } from "@/server/tenant/with-tenant";
import { applyMovement, MovementError } from "./movement.service";
import { planInventoryAdjustments, type CountItem } from "./inventory-rules";

// Inventário (Fase 9): abertura com snapshot do saldo do sistema, contagem e
// aplicação — contagem → diferença → movimento de ajuste (regra do AGENTS.md).
// Tudo roda dentro de withTenant() (RLS); saldo só muda via applyMovement().

export class InventoryError extends Error {}

export type CreateInventoryInput = {
  tenantId: string;
  warehouseId: string;
  userId?: string | null;
  notes?: string | null;
};

export type CountEntry = {
  itemId: string;
  /** null = continua sem contagem */
  countedQty: number | null;
};

function qtyDb(n: number): string {
  return n.toFixed(3);
}

function toCounted(v: number): number {
  if (!Number.isFinite(v) || v < 0) {
    throw new InventoryError(
      "Contagem inválida: informe um valor maior ou igual a zero.",
    );
  }
  return Math.round(v * 1000) / 1000;
}

/** Abre o inventário de um depósito e congela o saldo do sistema por item. */
export async function createInventory(
  tx: TenantTx,
  input: CreateInventoryInput,
): Promise<{ inventoryId: string; itemCount: number }> {
  const [warehouse] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.tenantId, input.tenantId),
        eq(warehouses.id, input.warehouseId),
        isNull(warehouses.deletedAt),
      ),
    )
    .limit(1);
  if (!warehouse) throw new InventoryError("Depósito não encontrado.");

  const [aberto] = await tx
    .select({ id: inventories.id })
    .from(inventories)
    .where(
      and(
        eq(inventories.tenantId, input.tenantId),
        eq(inventories.warehouseId, input.warehouseId),
        isNull(inventories.appliedAt),
      ),
    )
    .limit(1);
  if (aberto) {
    throw new InventoryError(
      "Já existe um inventário em aberto para este depósito.",
    );
  }

  // produtos sem controle de lote: saldo por produto+depósito
  const semLote = await tx
    .select({
      productId: stockBalances.productId,
      quantity: stockBalances.quantity,
    })
    .from(stockBalances)
    .innerJoin(
      products,
      and(
        eq(products.id, stockBalances.productId),
        eq(products.tenantId, stockBalances.tenantId),
      ),
    )
    .where(
      and(
        eq(stockBalances.tenantId, input.tenantId),
        eq(stockBalances.warehouseId, input.warehouseId),
        eq(products.trackBatch, false),
        isNull(products.deletedAt),
        sql`${stockBalances.quantity} > 0`,
      ),
    );

  // produtos com controle de lote: um item por lote com saldo
  const comLote = await tx
    .select({
      productId: batches.productId,
      batchId: batchBalances.batchId,
      batchNumber: batches.batchNumber,
      quantity: batchBalances.quantity,
    })
    .from(batchBalances)
    .innerJoin(
      batches,
      and(
        eq(batches.id, batchBalances.batchId),
        eq(batches.tenantId, batchBalances.tenantId),
      ),
    )
    .where(
      and(
        eq(batchBalances.tenantId, input.tenantId),
        eq(batchBalances.warehouseId, input.warehouseId),
        sql`${batchBalances.quantity} > 0`,
      ),
    );

  const [inv] = await tx
    .insert(inventories)
    .values({
      tenantId: input.tenantId,
      warehouseId: input.warehouseId,
      userId: input.userId ?? null,
      notes: input.notes?.trim() || null,
    })
    .returning({ id: inventories.id });

  const rows = [
    ...semLote.map((r) => ({
      tenantId: input.tenantId,
      inventoryId: inv.id,
      productId: r.productId,
      batchId: null,
      systemQty: qtyDb(Number(r.quantity)),
    })),
    ...comLote.map((r) => ({
      tenantId: input.tenantId,
      inventoryId: inv.id,
      productId: r.productId,
      batchId: r.batchId,
      systemQty: qtyDb(Number(r.quantity)),
    })),
  ];

  if (rows.length > 0) {
    await tx.insert(inventoryItems).values(rows);
  }

  return { inventoryId: inv.id, itemCount: rows.length };
}

/** Grava as contagens informadas (apenas itens do inventário em aberto). */
export async function saveCounts(
  tx: TenantTx,
  input: { tenantId: string; inventoryId: string; counts: CountEntry[] },
): Promise<{ counted: number }> {
  const inv = await lockOpenInventory(tx, input.tenantId, input.inventoryId);

  const itens = await tx
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.tenantId, input.tenantId),
        eq(inventoryItems.inventoryId, inv.id),
      ),
    );
  const validos = new Set(itens.map((i) => i.id));

  const values: { id: string; countedQty: string | null; updatedAt: Date }[] = [];
  for (const c of input.counts) {
    if (!validos.has(c.itemId)) {
      throw new InventoryError("Item do inventário não encontrado.");
    }
    values.push({
      id: c.itemId,
      countedQty: c.countedQty === null ? null : qtyDb(toCounted(c.countedQty)),
      updatedAt: new Date(),
    });
  }

  for (const v of values) {
    await tx
      .update(inventoryItems)
      .set({ countedQty: v.countedQty, updatedAt: v.updatedAt })
      .where(
        and(
          eq(inventoryItems.tenantId, input.tenantId),
          eq(inventoryItems.id, v.id),
        ),
      );
  }

  return { counted: values.length };
}

export type ApplyInventoryResult = {
  /** ajustes de fato gravados no livro */
  applied: number;
  /** itens sem diferença (nada a fazer) */
  unchanged: number;
};

/**
 * Aplica a contagem: diferença → movimento de ajuste (ENTRADA_AJUSTE /
 * SAIDA_AJUSTE) no MESMO depósito do inventário, referenciando o inventário.
 * Itens pendentes (sem contagem) bloqueiam a aplicação.
 */
export async function applyInventory(
  tx: TenantTx,
  input: { tenantId: string; inventoryId: string; userId?: string | null },
): Promise<ApplyInventoryResult> {
  const inv = await lockOpenInventory(tx, input.tenantId, input.inventoryId);

  const itens = await tx
    .select({
      id: inventoryItems.id,
      productId: inventoryItems.productId,
      batchId: inventoryItems.batchId,
      systemQty: inventoryItems.systemQty,
      countedQty: inventoryItems.countedQty,
      batchNumber: batches.batchNumber,
    })
    .from(inventoryItems)
    .leftJoin(
      batches,
      and(
        eq(batches.id, inventoryItems.batchId),
        eq(batches.tenantId, inventoryItems.tenantId),
      ),
    )
    .where(
      and(
        eq(inventoryItems.tenantId, input.tenantId),
        eq(inventoryItems.inventoryId, inv.id),
      ),
    )
    .orderBy(inventoryItems.id);

  const counts: CountItem[] = itens.map((i) => ({
    itemId: i.id,
    productId: i.productId,
    batchNumber: i.batchNumber ?? null,
    systemQty: Number(i.systemQty),
    countedQty: i.countedQty === null ? null : Number(i.countedQty),
  }));

  const plan = planInventoryAdjustments(counts);
  if (!plan.ok) throw new InventoryError(plan.reason);
  if (plan.pending > 0) {
    throw new InventoryError(
      `${plan.pending} item(ns) ainda não contado(s) — conclua a contagem antes de aplicar.`,
    );
  }
  if (plan.adjustments.length === 0) {
    await tx
      .update(inventories)
      .set({ appliedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(inventories.tenantId, input.tenantId),
          eq(inventories.id, inv.id),
        ),
      );
    return { applied: 0, unchanged: counts.length };
  }

  // custo de entrada = custo médio atual (o ajuste não distorce o custo)
  const ids = [...new Set(plan.adjustments.map((a) => a.productId))];
  const custos = await tx
    .select({ id: products.id, costPrice: products.costPrice })
    .from(products)
    .where(and(eq(products.tenantId, input.tenantId), inArray(products.id, ids)));
  const custoPorProduto = new Map(
    custos.map((p) => [p.id, Math.round(parseFloat(p.costPrice) * 100)]),
  );

  for (const adj of plan.adjustments) {
    const custo = custoPorProduto.get(adj.productId);
    if (custo === undefined) {
      throw new InventoryError("Produto do inventário não encontrado.");
    }
    try {
      await applyMovement(tx, {
        tenantId: input.tenantId,
        type: adj.direction === "ENTRADA" ? "ENTRADA_AJUSTE" : "SAIDA_AJUSTE",
        productId: adj.productId,
        warehouseId: inv.warehouseId,
        quantity: adj.quantity,
        unitCostCents: adj.direction === "ENTRADA" ? custo : undefined,
        batchNumber: adj.batchNumber ?? undefined,
        reason: "Inventário",
        notes: `Contagem ${qtyDb(adj.difference)} vs sistema`,
        userId: input.userId ?? null,
        referenceType: "INVENTORY",
        referenceId: inv.id,
      });
    } catch (err) {
      if (err instanceof MovementError) {
        throw new InventoryError(
          `Ajuste do produto ${adj.productId} recusado: ${err.message}`,
        );
      }
      throw err;
    }
  }

  await tx
    .update(inventories)
    .set({ appliedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(inventories.tenantId, input.tenantId),
        eq(inventories.id, inv.id),
      ),
    );

  return { applied: plan.adjustments.length, unchanged: counts.length - plan.changed };
}

/** Trava o inventário (FOR UPDATE) e exige que esteja em aberto. */
async function lockOpenInventory(
  tx: TenantTx,
  tenantId: string,
  inventoryId: string,
): Promise<{ id: string; warehouseId: string }> {
  const [inv] = await tx
    .select({ id: inventories.id, warehouseId: inventories.warehouseId, appliedAt: inventories.appliedAt })
    .from(inventories)
    .where(and(eq(inventories.tenantId, tenantId), eq(inventories.id, inventoryId)))
    .for("update")
    .limit(1);
  if (!inv) throw new InventoryError("Inventário não encontrado.");
  if (inv.appliedAt) {
    throw new InventoryError("Inventário já aplicado — não pode ser alterado.");
  }
  return { id: inv.id, warehouseId: inv.warehouseId };
}
