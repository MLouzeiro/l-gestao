import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  products,
  transferItems,
  transfers,
  users,
  warehouses,
} from "@/server/db/schema";
import { audit } from "@/server/audit/log";
import { nextCounter } from "@/server/db/counter";
import type { TenantTx } from "@/server/tenant/with-tenant";
import {
  applyMovement,
  MovementError,
} from "@/server/modules/estoque/movement.service";
import {
  assertWarehouseAccessible,
} from "@/server/modules/unidades/warehouse.service";
import {
  assertTransferItems,
  assertTransferTransition,
  formatTransferNumber,
  shouldReleaseOnSend,
  TransferError,
  type TransferItemInput,
  type TransferSettleOn,
  type TransferStatus,
} from "./transfer-rules";

export { TransferError };
export type { TransferSettleOn, TransferStatus };

// Transferências entre unidades (E4+E6): fluxo simples (saída+entrada na hora)
// e workflow DRAFT → SENT → RECEIVED / CANCELLED. O modo de baixa define se a
// origem perde saldo no envio (SEND) ou só no recebimento (RECEIVE).
// Todo movimento é applyMovement() com transfer_id — livro imutável.

export type TransferContext = {
  tenantId: string;
  userId: string;
  role: string;
};

export type CreateTransferInput = {
  fromWarehouseId: string;
  toWarehouseId: string;
  settleOn: TransferSettleOn;
  notes?: string | null;
  items: TransferItemInput[];
  /** true = fluxo simples: envia e recebe na mesma transação */
  immediate?: boolean;
};

export type TransferListItem = {
  id: string;
  number: number;
  transferNumber: string;
  status: TransferStatus;
  settleOn: TransferSettleOn;
  fromWarehouseName: string;
  toWarehouseName: string;
  userName: string | null;
  itemCount: number;
  sentAt: Date | null;
  receivedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
};

export type TransferDetail = {
  id: string;
  number: number;
  transferNumber: string;
  status: TransferStatus;
  settleOn: TransferSettleOn;
  fromWarehouseId: string;
  fromWarehouseName: string;
  toWarehouseId: string;
  toWarehouseName: string;
  userName: string | null;
  notes: string | null;
  sentAt: Date | null;
  receivedAt: Date | null;
  cancelledAt: Date | null;
  items: {
    productId: string;
    sku: string;
    name: string;
    batchNumber: string | null;
    quantity: number;
  }[];
};

async function loadTransferRow(
  tx: TenantTx,
  tenantId: string,
  transferId: string,
): Promise<{
  id: string;
  number: number;
  status: TransferStatus;
  settleOn: TransferSettleOn;
  fromWarehouseId: string;
  toWarehouseId: string;
  userId: string | null;
  notes: string | null;
}> {
  const [row] = await tx
    .select({
      id: transfers.id,
      number: transfers.number,
      status: transfers.status,
      settleOn: transfers.settleOn,
      fromWarehouseId: transfers.fromWarehouseId,
      toWarehouseId: transfers.toWarehouseId,
      userId: transfers.userId,
      notes: transfers.notes,
    })
    .from(transfers)
    .where(and(eq(transfers.tenantId, tenantId), eq(transfers.id, transferId)))
    .limit(1);
  if (!row) throw new TransferError("Transferência não encontrada.");
  return row;
}

async function assertWarehousesAccessible(
  tx: TenantTx,
  ctx: TransferContext,
  fromWarehouseId: string,
  toWarehouseId: string,
): Promise<void> {
  if (fromWarehouseId === toWarehouseId) {
    throw new TransferError(
      "Origem e destino devem ser unidades diferentes.",
    );
  }
  for (const wh of [fromWarehouseId, toWarehouseId]) {
    const [exists] = await tx
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(
        and(
          eq(warehouses.tenantId, ctx.tenantId),
          eq(warehouses.id, wh),
          isNull(warehouses.deletedAt),
        ),
      )
      .limit(1);
    if (!exists) throw new TransferError("Unidade não encontrada.");
    await assertWarehouseAccessible(
      tx,
      ctx.tenantId,
      ctx.userId,
      ctx.role,
      wh,
    );
  }
}

async function insertItems(
  tx: TenantTx,
  tenantId: string,
  transferId: string,
  items: readonly TransferItemInput[],
): Promise<void> {
  await tx.insert(transferItems).values(
    items.map((it) => ({
      tenantId,
      transferId,
      productId: it.productId,
      batchNumber: it.batchNumber?.trim() || null,
      quantity: String(it.quantity),
    })),
  );
}

/**
 * Baixa os itens da ORIGEM (TRANSFERENCIA_SAIDA). Retorna o custo/lote
 * efetivos por item para o par de entrada preservar o valor.
 */
async function releaseOrigin(
  tx: TenantTx,
  ctx: TransferContext,
  transferId: string,
  fromWarehouseId: string,
  toWarehouseId: string,
  items: readonly TransferItemInput[],
): Promise<Map<string, { unitCostCents: number; batchNumber: string | null }>> {
  const saidos = new Map<
    string,
    { unitCostCents: number; batchNumber: string | null }
  >();
  for (const it of items) {
    const out = await applyMovement(tx, {
      tenantId: ctx.tenantId,
      type: "TRANSFERENCIA_SAIDA",
      productId: it.productId,
      warehouseId: fromWarehouseId,
      toWarehouseId,
      quantity: it.quantity,
      batchNumber: it.batchNumber?.trim() || undefined,
      transferId,
      userId: ctx.userId,
    });
    saidos.set(it.productId, {
      unitCostCents: out.unitCostCents,
      batchNumber: out.batchNumber,
    });
  }
  return saidos;
}

/** Entrada dos itens no DESTINO (TRANSFERENCIA_ENTRADA) preservando o custo. */
async function receiveAtDestination(
  tx: TenantTx,
  ctx: TransferContext,
  transferId: string,
  toWarehouseId: string,
  items: readonly TransferItemInput[],
  custos: Map<string, { unitCostCents: number; batchNumber: string | null }>,
): Promise<void> {
  for (const it of items) {
    const saida = custos.get(it.productId);
    await applyMovement(tx, {
      tenantId: ctx.tenantId,
      type: "TRANSFERENCIA_ENTRADA",
      productId: it.productId,
      warehouseId: toWarehouseId,
      quantity: it.quantity,
      unitCostCents: saida?.unitCostCents ?? 0,
      batchNumber: saida?.batchNumber ?? it.batchNumber?.trim() ?? undefined,
      transferId,
      userId: ctx.userId,
    });
  }
}

export async function createTransfer(
  tx: TenantTx,
  ctx: TransferContext,
  input: CreateTransferInput,
): Promise<{ id: string; transferNumber: string; status: TransferStatus }> {
  assertTransferItems(input.items);
  await assertWarehousesAccessible(
    tx,
    ctx,
    input.fromWarehouseId,
    input.toWarehouseId,
  );

  const number = await nextCounter(tx, ctx.tenantId, "transfer");
  const [row] = await tx
    .insert(transfers)
    .values({
      tenantId: ctx.tenantId,
      number,
      status: "DRAFT",
      settleOn: input.settleOn,
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      userId: ctx.userId,
      notes: input.notes ?? null,
    })
    .returning({ id: transfers.id });

  await insertItems(tx, ctx.tenantId, row.id, input.items);

  await audit(tx, {
    action: "TRANSFERENCIA",
    module: "transferencias",
    entityType: "transfer",
    entityId: row.id,
    after: {
      transferNumber: formatTransferNumber(number),
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      settleOn: input.settleOn,
      items: input.items.length,
    },
    userId: ctx.userId,
  });

  if (input.immediate) {
    await sendTransfer(tx, ctx, row.id);
    await receiveTransfer(tx, ctx, row.id);
    return {
      id: row.id,
      transferNumber: formatTransferNumber(number),
      status: "RECEIVED",
    };
  }

  return {
    id: row.id,
    transferNumber: formatTransferNumber(number),
    status: "DRAFT",
  };
}

export async function sendTransfer(
  tx: TenantTx,
  ctx: TransferContext,
  transferId: string,
): Promise<void> {
  const t = await loadTransferRow(tx, ctx.tenantId, transferId);
  assertTransferTransition(t.status, "send");

  const items = await tx
    .select({
      productId: transferItems.productId,
      batchNumber: transferItems.batchNumber,
      quantity: transferItems.quantity,
    })
    .from(transferItems)
    .where(
      and(
        eq(transferItems.tenantId, ctx.tenantId),
        eq(transferItems.transferId, transferId),
      ),
    );
  const inputs: TransferItemInput[] = items.map((i) => ({
    productId: i.productId,
    batchNumber: i.batchNumber,
    quantity: Number(i.quantity),
  }));

  if (shouldReleaseOnSend(t.settleOn)) {
    const saidos = await releaseOrigin(
      tx,
      ctx,
      transferId,
      t.fromWarehouseId,
      t.toWarehouseId,
      inputs,
    );
    // Grava o custo/lote efetivos para o par de entrada (recebimento) e o
    // estorno de eventual cancelamento preservarem o valor.
    for (const it of inputs) {
      const s = saidos.get(it.productId);
      if (!s) continue;
      await tx
        .update(transferItems)
        .set({
          unitCost: String(s.unitCostCents / 100),
          batchNumber: s.batchNumber ?? it.batchNumber?.trim() ?? null,
        })
        .where(
          and(
            eq(transferItems.tenantId, ctx.tenantId),
            eq(transferItems.transferId, transferId),
            eq(transferItems.productId, it.productId),
          ),
        );
    }
  }

  await tx
    .update(transfers)
    .set({ status: "SENT", sentAt: new Date() })
    .where(and(eq(transfers.tenantId, ctx.tenantId), eq(transfers.id, transferId)));

  await audit(tx, {
    action: "TRANSFERENCIA",
    module: "transferencias",
    entityType: "transfer",
    entityId: transferId,
    after: { status: "SENT", settleOn: t.settleOn },
    userId: ctx.userId,
  });
}

export async function receiveTransfer(
  tx: TenantTx,
  ctx: TransferContext,
  transferId: string,
): Promise<void> {
  const t = await loadTransferRow(tx, ctx.tenantId, transferId);
  assertTransferTransition(t.status, "receive");

  const items = await tx
    .select({
      productId: transferItems.productId,
      batchNumber: transferItems.batchNumber,
      quantity: transferItems.quantity,
    })
    .from(transferItems)
    .where(
      and(
        eq(transferItems.tenantId, ctx.tenantId),
        eq(transferItems.transferId, transferId),
      ),
    );
  const inputs: TransferItemInput[] = items.map((i) => ({
    productId: i.productId,
    batchNumber: i.batchNumber,
    quantity: Number(i.quantity),
  }));

  let custos: Map<string, { unitCostCents: number; batchNumber: string | null }>;
  if (shouldReleaseOnSend(t.settleOn)) {
    // Origem já baixou no envio (com custo/lote gravados no item):
    // só entra no destino, preservando o valor.
    const rows = await tx
      .select({
        productId: transferItems.productId,
        batchNumber: transferItems.batchNumber,
        unitCost: transferItems.unitCost,
      })
      .from(transferItems)
      .where(
        and(
          eq(transferItems.tenantId, ctx.tenantId),
          eq(transferItems.transferId, transferId),
        ),
      );
    custos = new Map(
      rows.map((r) => [
        r.productId,
        {
          unitCostCents: Math.round(Number(r.unitCost) * 100),
          batchNumber: r.batchNumber,
        },
      ]),
    );
  } else {
    // Baixa no recebimento: saída na origem + entrada no destino agora.
    custos = await releaseOrigin(
      tx,
      ctx,
      transferId,
      t.fromWarehouseId,
      t.toWarehouseId,
      inputs,
    );
    for (const it of inputs) {
      const c = custos.get(it.productId);
      if (!c) continue;
      await tx
        .update(transferItems)
        .set({ unitCost: String(c.unitCostCents / 100) })
        .where(
          and(
            eq(transferItems.tenantId, ctx.tenantId),
            eq(transferItems.transferId, transferId),
            eq(transferItems.productId, it.productId),
          ),
        );
    }
  }

  await receiveAtDestination(
    tx,
    ctx,
    transferId,
    t.toWarehouseId,
    inputs,
    custos,
  );

  await tx
    .update(transfers)
    .set({ status: "RECEIVED", receivedAt: new Date() })
    .where(and(eq(transfers.tenantId, ctx.tenantId), eq(transfers.id, transferId)));

  await audit(tx, {
    action: "TRANSFERENCIA",
    module: "transferencias",
    entityType: "transfer",
    entityId: transferId,
    after: { status: "RECEIVED", settleOn: t.settleOn },
    userId: ctx.userId,
  });
}

export async function cancelTransfer(
  tx: TenantTx,
  ctx: TransferContext,
  transferId: string,
): Promise<void> {
  const t = await loadTransferRow(tx, ctx.tenantId, transferId);
  assertTransferTransition(t.status, "cancel");

  // SENT + baixa no envio: o material saiu da origem — estorna com
  // TRANSFERENCIA_ENTRADA de volta na origem (livro imutável: novo movimento).
  if (t.status === "SENT" && shouldReleaseOnSend(t.settleOn)) {
    const items = await tx
      .select({
        productId: transferItems.productId,
        batchNumber: transferItems.batchNumber,
        quantity: transferItems.quantity,
        unitCost: transferItems.unitCost,
      })
      .from(transferItems)
      .where(
        and(
          eq(transferItems.tenantId, ctx.tenantId),
          eq(transferItems.transferId, transferId),
        ),
      );
    for (const it of items) {
      await applyMovement(tx, {
        tenantId: ctx.tenantId,
        type: "TRANSFERENCIA_ENTRADA",
        productId: it.productId,
        warehouseId: t.fromWarehouseId,
        quantity: Number(it.quantity),
        unitCostCents: Math.round(Number(it.unitCost) * 100),
        batchNumber: it.batchNumber?.trim() || undefined,
        transferId,
        userId: ctx.userId,
        reason: `Estorno de cancelamento ${formatTransferNumber(t.number)}`,
      });
    }
  }

  await tx
    .update(transfers)
    .set({ status: "CANCELLED", cancelledAt: new Date() })
    .where(and(eq(transfers.tenantId, ctx.tenantId), eq(transfers.id, transferId)));

  await audit(tx, {
    action: "TRANSFERENCIA",
    module: "transferencias",
    entityType: "transfer",
    entityId: transferId,
    after: { status: "CANCELLED", previousStatus: t.status },
    userId: ctx.userId,
  });
}

export async function listTransfers(
  tx: TenantTx,
  tenantId: string,
): Promise<TransferListItem[]> {
  const rows = await tx
    .select({
      id: transfers.id,
      number: transfers.number,
      status: transfers.status,
      settleOn: transfers.settleOn,
      fromWarehouseId: transfers.fromWarehouseId,
      toWarehouseId: transfers.toWarehouseId,
      userName: users.name,
      sentAt: transfers.sentAt,
      receivedAt: transfers.receivedAt,
      cancelledAt: transfers.cancelledAt,
      createdAt: transfers.createdAt,
    })
    .from(transfers)
    .leftJoin(users, eq(users.id, transfers.userId))
    .where(eq(transfers.tenantId, tenantId))
    .orderBy(desc(transfers.createdAt))
    .limit(200);

  const whNames = await tx
    .select({ id: warehouses.id, name: warehouses.name })
    .from(warehouses)
    .where(eq(warehouses.tenantId, tenantId));
  const nomes = new Map(whNames.map((w) => [w.id, w.name]));

  const out: TransferListItem[] = [];
  for (const r of rows) {
    const [count] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(transferItems)
      .where(
        and(
          eq(transferItems.tenantId, tenantId),
          eq(transferItems.transferId, r.id),
        ),
      );
    out.push({
      id: r.id,
      number: r.number,
      transferNumber: formatTransferNumber(r.number),
      status: r.status,
      settleOn: r.settleOn,
      fromWarehouseName: nomes.get(r.fromWarehouseId) ?? "—",
      toWarehouseName: nomes.get(r.toWarehouseId) ?? "—",
      userName: r.userName,
      itemCount: count?.total ?? 0,
      sentAt: r.sentAt,
      receivedAt: r.receivedAt,
      cancelledAt: r.cancelledAt,
      createdAt: r.createdAt,
    });
  }
  return out;
}

export async function getTransferDetail(
  tx: TenantTx,
  tenantId: string,
  transferId: string,
): Promise<TransferDetail | null> {
  const [row] = await tx
    .select({
      id: transfers.id,
      number: transfers.number,
      status: transfers.status,
      settleOn: transfers.settleOn,
      fromWarehouseId: transfers.fromWarehouseId,
      fromName: warehouses.name,
      toWarehouseId: transfers.toWarehouseId,
      userName: users.name,
      notes: transfers.notes,
      sentAt: transfers.sentAt,
      receivedAt: transfers.receivedAt,
      cancelledAt: transfers.cancelledAt,
    })
    .from(transfers)
    .innerJoin(
      warehouses,
      and(
        eq(warehouses.id, transfers.fromWarehouseId),
        eq(warehouses.tenantId, transfers.tenantId),
      ),
    )
    .leftJoin(users, eq(users.id, transfers.userId))
    .where(and(eq(transfers.tenantId, tenantId), eq(transfers.id, transferId)))
    .limit(1);
  if (!row) return null;

  const [dest] = await tx
    .select({ name: warehouses.name })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.tenantId, tenantId),
        eq(warehouses.id, row.toWarehouseId),
      ),
    )
    .limit(1);

  const items = await tx
    .select({
      productId: transferItems.productId,
      sku: products.sku,
      name: products.name,
      batchNumber: transferItems.batchNumber,
      quantity: transferItems.quantity,
    })
    .from(transferItems)
    .innerJoin(
      products,
      and(
        eq(products.id, transferItems.productId),
        eq(products.tenantId, transferItems.tenantId),
      ),
    )
    .where(
      and(
        eq(transferItems.tenantId, tenantId),
        eq(transferItems.transferId, transferId),
      ),
    )
    .orderBy(products.name);

  return {
    id: row.id,
    number: row.number,
    transferNumber: formatTransferNumber(row.number),
    status: row.status,
    settleOn: row.settleOn,
    fromWarehouseId: row.fromWarehouseId,
    fromWarehouseName: row.fromName,
    toWarehouseId: row.toWarehouseId,
    toWarehouseName: dest?.name ?? "—",
    userName: row.userName,
    notes: row.notes,
    sentAt: row.sentAt,
    receivedAt: row.receivedAt,
    cancelledAt: row.cancelledAt,
    items: items.map((i) => ({
      productId: i.productId,
      sku: i.sku,
      name: i.name,
      batchNumber: i.batchNumber,
      quantity: Number(i.quantity),
    })),
  };
}

export { MovementError };
