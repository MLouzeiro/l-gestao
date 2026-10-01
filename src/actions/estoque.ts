"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { batchBalances, batches, products, units } from "@/server/db/schema";
import { fromCents, toCents } from "@/lib/money";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import {
  applyMovement,
  MovementError,
} from "@/server/modules/estoque/movement.service";
import { ENTRADA_TYPES, SAIDA_TYPES } from "@/server/modules/estoque/movement-rules";
import { isBatchExpired, sortFefo } from "@/server/modules/estoque/fefo-rules";

// Ações do estoque (Fase 6). Toda ação passa por requirePermission e roda
// dentro de withTenant() (RLS + transação). Saldo NUNCA é editado direto:
// tudo passa por applyMovement().

export type EstoqueFormState =
  | { ok?: boolean; error?: string; message?: string }
  | null;

export type LoteInfo = {
  batchNumber: string;
  /** "YYYY-MM-DD" ou null */
  expiresAt: string | null;
  available: number;
  vencido: boolean;
};

/** Lotes com saldo do produto+depósito, ordenados FEFO (saída). RLS + sessão. */
export async function _buscarLotes(
  productId: string,
  warehouseId: string,
): Promise<LoteInfo[]> {
  const { tenantId } = await requirePermission("stock.view");
  const uuid = z.string().uuid();
  if (!uuid.safeParse(productId).success || !uuid.safeParse(warehouseId).success) {
    return [];
  }

  return withTenant(tenantId, async (tx) => {
    const rows = await tx
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
          eq(batchBalances.warehouseId, warehouseId),
          eq(batchBalances.tenantId, batches.tenantId),
        ),
      )
      .where(
        and(
          eq(batches.tenantId, tenantId),
          eq(batches.productId, productId),
        ),
      );

    const ymd = (d: Date | string | null): string | null =>
      d ? new Date(d).toISOString().slice(0, 10) : null;

    return sortFefo(
      rows.map((r) => ({
        batchNumber: r.batchNumber,
        expiresAt: ymd(r.expiresAt),
        createdAt: r.createdAt.toISOString(),
        available: Number(r.available),
      })),
    )
      .filter((l) => l.available > 0)
      .map((l) => ({
        batchNumber: l.batchNumber,
        expiresAt: l.expiresAt,
        available: l.available,
        vencido: isBatchExpired(l.expiresAt),
      }));
  });
}

const TODOS_TIPOS = [...ENTRADA_TYPES, ...SAIDA_TYPES] as const;

const movimentacaoSchema = z.object({
  type: z.enum(TODOS_TIPOS),
  productId: z.string().uuid("Selecione o produto."),
  warehouseId: z.string().uuid("Selecione o depósito."),
  quantity: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d{1,3})?$/, "Quantidade inválida (ex.: 10 ou 2,5)."),
  unitCost: z.string().trim().optional(),
  batchNumber: z.string().trim().max(80).optional(),
  batchExpiresAt: z.string().trim().optional(),
  reason: z.string().trim().max(500).optional(),
});

function parseQty(value: string): number {
  const n = parseFloat(value.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) throw new Error("Quantidade inválida.");
  return n;
}

export async function _movimentar(
  _prev: EstoqueFormState,
  formData: FormData,
): Promise<EstoqueFormState> {
  const { tenantId, session } = await requirePermission("stock.manage");

  const parsed = movimentacaoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const d = parsed.data;

  let quantity: number;
  try {
    quantity = parseQty(d.quantity);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Quantidade inválida." };
  }

  const isEntrada = (ENTRADA_TYPES as readonly string[]).includes(d.type);
  let unitCostCents: number | undefined;
  if (isEntrada) {
    if (!d.unitCost) return { error: "Informe o custo unitário da entrada." };
    try {
      unitCostCents = toCents(d.unitCost);
    } catch {
      return { error: "Custo unitário inválido (ex.: 10,50)." };
    }
  }

  try {
    await withTenant(tenantId, (tx) =>
      applyMovement(tx, {
        tenantId,
        type: d.type,
        productId: d.productId,
        warehouseId: d.warehouseId,
        quantity,
        unitCostCents,
        batchNumber: d.batchNumber || undefined,
        batchExpiresAt: d.batchExpiresAt || null,
        reason: d.reason || undefined,
        userId: session.user.id,
      }),
    );
  } catch (err) {
    if (err instanceof MovementError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Falha ao movimentar." };
  }

  revalidatePath("/estoque");
  return { ok: true, message: "Movimentação registrada." };
}

const produtoSchema = z.object({
  sku: z.string().trim().min(2, "SKU muito curto.").max(64, "SKU muito longo."),
  name: z.string().trim().min(2, "Nome muito curto.").max(200, "Nome muito longo."),
  salePrice: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d{1,2})?$/, "Preço de venda inválido (ex.: 19,90)."),
  costPrice: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d{1,2})?$/, "Custo inválido (ex.: 10,50).")
    .optional()
    .or(z.literal("")),
  unitKey: z.string().optional(),
  trackBatch: z.string().optional(),
});

export async function _criarProduto(
  _prev: EstoqueFormState,
  formData: FormData,
): Promise<EstoqueFormState> {
  const { tenantId } = await requirePermission("stock.manage");

  const parsed = produtoSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const d = parsed.data;
  const sku = d.sku.toUpperCase();

  let unitId: string | null = null;
  if (d.unitKey) {
    const [unit] = await db
      .select({ id: units.id })
      .from(units)
      .where(eq(units.key, d.unitKey))
      .limit(1);
    unitId = unit?.id ?? null;
  }

  try {
    await withTenant(tenantId, async (tx) => {
      const [existing] = await tx
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.tenantId, tenantId),
            eq(products.sku, sku),
            isNull(products.deletedAt),
          ),
        )
        .limit(1);
      if (existing) {
        throw new MovementError(`Já existe um produto com o SKU ${sku}.`);
      }
      await tx.insert(products).values({
        tenantId,
        sku,
        name: d.name,
        unitId,
        salePrice: fromCents(toCents(d.salePrice)),
        costPrice: d.costPrice ? fromCents(toCents(d.costPrice)) : "0",
        trackBatch: d.trackBatch === "on",
      });
    });
  } catch (err) {
    if (err instanceof MovementError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Falha ao cadastrar." };
  }

  revalidatePath("/estoque");
  return { ok: true, message: `Produto ${sku} cadastrado.` };
}
