import { and, eq } from "drizzle-orm";
import {
  batchBalances,
  batches,
  products,
  stockBalances,
  stockMovements,
  tenantSettings,
  warehouses,
} from "@/server/db/schema";
import type { TenantTx } from "@/server/tenant/with-tenant";
import { audit } from "@/server/audit/log";
import { auditActionForMovement } from "@/server/modules/auditoria/audit-rules";
import { fromCents } from "@/lib/money";
import {
  isBatchExpired,
  selectFefoBatch,
} from "./fefo-rules";
import {
  calcAvgCostCents,
  isEntrada,
  isSaida,
  movementSignal,
  validateMovement,
  type MovementType,
} from "./movement-rules";

// applyMovement: único caminho para alterar saldo (regra M2).
// Livro (stock_movements) + cache (stock_balances/batch_balances) na MESMA
// transação — o chamador roda dentro de withTenant() (RLS + atomicidade).
// Nunca editar saldo direto: correção é novo movimento (estorno/ajuste).

export class MovementError extends Error {}

export type MovementInput = {
  tenantId: string;
  type: MovementType;
  productId: string;
  warehouseId: string;
  /** unidades (decimal) — sempre > 0 */
  quantity: number;
  /** centavos — obrigatório em entradas (validado pelas regras) */
  unitCostCents?: number;
  /** exigido quando o produto controla lote (trackBatch) */
  batchNumber?: string;
  /** validade na criação do lote (entrada) */
  batchExpiresAt?: string | null;
  reason?: string;
  notes?: string;
  userId?: string | null;
  referenceType?: string;
  referenceId?: string;
  occurredAt?: Date;
};

function fmtQty(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function qtyDb(n: number): string {
  return n.toFixed(3);
}

/** Date (driver) → "YYYY-MM-DD" usando o instante UTC (date do PG é UTC). */
function toYmd(d: Date | string | null): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

export async function applyMovement(
  tx: TenantTx,
  input: MovementInput,
): Promise<{ movementId: string }> {
  const signal = movementSignal(input.type);

  // ---- produto (escopo do tenant via RLS) ----
  const [product] = await tx
    .select()
    .from(products)
    .where(
      and(
        eq(products.tenantId, input.tenantId),
        eq(products.id, input.productId),
      ),
    )
    .limit(1);
  if (!product) throw new MovementError("Produto não encontrado.");
  if (product.deletedAt || product.status !== "ACTIVE") {
    throw new MovementError("Produto inativo não pode ser movimentado.");
  }

  // ---- depósito ----
  const [warehouse] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(
      and(
        eq(warehouses.tenantId, input.tenantId),
        eq(warehouses.id, input.warehouseId),
      ),
    )
    .limit(1);
  if (!warehouse) throw new MovementError("Depósito não encontrado.");

  // ---- settings da empresa (custo + flags de lote/validade) ----
  const [settings] = await tx
    .select({
      custoMetodo: tenantSettings.custoMetodo,
      controleFefo: tenantSettings.controleFefo,
      bloqueioVendaVencido: tenantSettings.bloqueioVendaVencido,
    })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, input.tenantId))
    .limit(1);
  if (settings?.custoMetodo === "FIFO") {
    throw new MovementError(
      "Custo FIFO ainda não está disponível — use o método Médio (padrão).",
    );
  }

  // ---- lote: saída sem número + controle_fefo → auto-aloca por FEFO ----
  let batchNumber = (input.batchNumber ?? "").trim();
  if (
    product.trackBatch &&
    !batchNumber &&
    isSaida(input.type) &&
    settings?.controleFefo
  ) {
    const lotes = await tx
      .select({
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
          eq(batchBalances.warehouseId, input.warehouseId),
          eq(batchBalances.tenantId, batches.tenantId),
        ),
      )
      .where(
        and(
          eq(batches.tenantId, input.tenantId),
          eq(batches.productId, input.productId),
        ),
      );

    const plano = selectFefoBatch(
      lotes.map((l) => ({
        batchNumber: l.batchNumber,
        expiresAt: toYmd(l.expiresAt),
        createdAt: (l.createdAt instanceof Date
          ? l.createdAt
          : new Date(l.createdAt)
        ).toISOString(),
        available: Number(l.available),
      })),
      input.quantity,
      { bloqueioVencido: settings?.bloqueioVendaVencido ?? false },
    );
    if (!plano.ok) throw new MovementError(plano.reason);
    batchNumber = plano.batchNumber;
  }

  // ---- regras puras (TDD) ----
  const check = validateMovement({
    type: input.type,
    quantity: input.quantity,
    unitCostCents: input.unitCostCents,
    trackBatch: product.trackBatch,
    batchNumber,
  });
  if (!check.ok) throw new MovementError(check.reason);

  // ---- lote (produto com trackBatch) ----
  let batchId: string | null = null;
  if (product.trackBatch) {
    const [found] = await tx
      .select({ id: batches.id, expiresAt: batches.expiresAt })
      .from(batches)
      .where(
        and(
          eq(batches.tenantId, input.tenantId),
          eq(batches.productId, input.productId),
          eq(batches.batchNumber, batchNumber),
        ),
      )
      .limit(1);

    if (found) {
      batchId = found.id;
      // bloqueio_venda_vencido: só a VENDA é barrada — perda/ajuste/
      // vencimento continuam permitidos (baixa operacional do vencido).
      if (
        input.type === "SAIDA_VENDA" &&
        settings?.bloqueioVendaVencido &&
        isBatchExpired(toYmd(found.expiresAt))
      ) {
        throw new MovementError(
          `Lote ${batchNumber} vencido em ${toYmd(found.expiresAt)} — ` +
            `venda bloqueada pela configuração (bloqueio_venda_vencido).`,
        );
      }
    } else if (isEntrada(input.type)) {
      const [created] = await tx
        .insert(batches)
        .values({
          tenantId: input.tenantId,
          productId: input.productId,
          batchNumber,
          expiresAt: input.batchExpiresAt
            ? new Date(input.batchExpiresAt)
            : null,
        })
        .returning({ id: batches.id });
      batchId = created.id;
    } else {
      throw new MovementError(`Lote ${batchNumber} não encontrado.`);
    }
  }

  // ---- saldo produto+depósito: cria linha zerada, trava e valida ----
  await tx
    .insert(stockBalances)
    .values({
      tenantId: input.tenantId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity: "0",
    })
    .onConflictDoNothing();

  const balanceWhere = and(
    eq(stockBalances.tenantId, input.tenantId),
    eq(stockBalances.productId, input.productId),
    eq(stockBalances.warehouseId, input.warehouseId),
  );
  const [bal] = await tx
    .select()
    .from(stockBalances)
    .where(balanceWhere)
    .for("update");
  if (!bal) throw new MovementError("Saldo não encontrado (erro interno).");

  const currentQty = Number(bal.quantity);
  const currentReserved = Number(bal.reserved);
  if (signal === -1) {
    const available = currentQty - currentReserved;
    if (available < input.quantity) {
      throw new MovementError(
        `Saldo insuficiente: disponível ${fmtQty(available)} ` +
          `(físico ${fmtQty(currentQty)} − reservado ${fmtQty(currentReserved)}).`,
      );
    }
  }
  const nextQty =
    signal === -1 ? currentQty - input.quantity : currentQty + input.quantity;
  await tx
    .update(stockBalances)
    .set({ quantity: qtyDb(nextQty), updatedAt: new Date() })
    .where(balanceWhere);

  // ---- saldo do lote ----
  if (product.trackBatch && batchId) {
    await tx
      .insert(batchBalances)
      .values({
        tenantId: input.tenantId,
        batchId,
        warehouseId: input.warehouseId,
        quantity: "0",
      })
      .onConflictDoNothing();

    const bbWhere = and(
      eq(batchBalances.tenantId, input.tenantId),
      eq(batchBalances.batchId, batchId),
      eq(batchBalances.warehouseId, input.warehouseId),
    );
    const [bb] = await tx
      .select()
      .from(batchBalances)
      .where(bbWhere)
      .for("update");
    if (!bb) throw new MovementError("Saldo de lote não encontrado.");

    const bbQty = Number(bb.quantity);
    if (signal === -1 && bbQty < input.quantity) {
      throw new MovementError(
        `Saldo do lote insuficiente: disponível ${fmtQty(bbQty)}.`,
      );
    }
    const bbNext = signal === -1 ? bbQty - input.quantity : bbQty + input.quantity;
    await tx
      .update(batchBalances)
      .set({ quantity: qtyDb(bbNext), updatedAt: new Date() })
      .where(bbWhere);
  }

  // ---- custo médio: só entrada recalcula (trava de linha já adquirida) ----
  let unitCostCents: number;
  if (isEntrada(input.type)) {
    const provided = input.unitCostCents as number;
    const avg = calcAvgCostCents(
      currentQty,
      parseCostToCents(product.costPrice),
      input.quantity,
      provided,
    );
    await tx
      .update(products)
      .set({ costPrice: fromCents(avg), updatedAt: new Date() })
      .where(
        and(
          eq(products.tenantId, input.tenantId),
          eq(products.id, input.productId),
        ),
      );
    unitCostCents = provided;
  } else {
    unitCostCents = parseCostToCents(product.costPrice);
  }

  // ---- livro razão (imutável) ----
  const totalCents = Math.round(unitCostCents * input.quantity);
  const [movement] = await tx
    .insert(stockMovements)
    .values({
      tenantId: input.tenantId,
      type: input.type,
      productId: input.productId,
      warehouseId: input.warehouseId,
      batchId,
      quantity: qtyDb(input.quantity),
      unitCost: fromCents(unitCostCents),
      totalCost: fromCents(totalCents),
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      userId: input.userId ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      reason: input.reason ?? null,
      notes: input.notes ?? null,
    })
    .returning({ id: stockMovements.id });

  await audit(tx, {
    action: auditActionForMovement(input.type),
    module: "estoque",
    entityType: "stock_movement",
    entityId: movement.id,
    after: {
      type: input.type,
      productId: input.productId,
      warehouseId: input.warehouseId,
      batchNumber: batchNumber || null,
      quantity: input.quantity,
      unitCostCents,
      totalCents,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      reason: input.reason ?? null,
    },
    tenantId: input.tenantId,
    userId: input.userId ?? null,
  });

  return { movementId: movement.id };
}

function parseCostToCents(value: string): number {
  return Math.round(parseFloat(value) * 100);
}
