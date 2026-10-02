"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PurchaseError } from "@/server/modules/compras/purchase.service";
import {
  cancelPurchase,
  confirmPurchase,
  createPurchase,
  deletePurchase,
  updatePurchase,
} from "@/server/modules/compras/purchase.service";
import { PermissionError } from "@/server/rbac/permissions";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";

// Ações de compras (Fase 11): requirePermission + Zod + withTenant().
// Totais são recalculados no servidor (a action só transporta dados).

export type CompraFormState =
  | { ok?: boolean; error?: string; message?: string; purchaseId?: string }
  | null;

const itemSchema = z.object({
  productId: z.string().uuid("Produto inválido."),
  quantity: z.number().positive("Quantidade deve ser maior que zero."),
  unitCostCents: z.number().int("Custo inválido.").min(0),
  batchNumber: z.string().max(100).nullable().optional(),
  expiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Validade inválida.")
    .nullable()
    .optional(),
});

const compraSchema = z.object({
  purchaseId: z.string().uuid().optional(),
  supplierId: z.string().uuid("Selecione o fornecedor."),
  warehouseId: z.string().uuid("Selecione o depósito."),
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de entrada inválida.")
    .nullable()
    .optional(),
  documentNumber: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).optional(),
  installments: z
    .number()
    .int("Parcelas inválidas.")
    .min(1, "Mínimo de 1 parcela.")
    .max(12, "Máximo de 12 parcelas."),
  items: z
    .array(itemSchema)
    .min(1, "Adicione ao menos um item.")
    .max(500, "Nota com itens demais."),
});

const acaoSchema = z.object({ purchaseId: z.string().uuid("Compra inválida.") });

function parseJson(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseCompraId(formData: FormData): string | null {
  const raw = formData.get("purchaseId");
  const parsed = acaoSchema.safeParse({
    purchaseId: typeof raw === "string" && raw.length > 0 ? raw : "",
  });
  return parsed.success ? parsed.data.purchaseId : null;
}

function revalidateCompras(purchaseId?: string): void {
  revalidatePath("/compras");
  if (purchaseId) revalidatePath(`/compras/${purchaseId}`);
}

async function withPermission(
  permission: string,
): Promise<{ ok: true; tenantId: string; userId: string } | { ok: false; error: string }> {
  try {
    const ctx = await requirePermission(permission);
    return { ok: true, tenantId: ctx.tenantId, userId: ctx.session.user.id };
  } catch (err) {
    if (err instanceof PermissionError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Cria (sem purchaseId) ou atualiza (com purchaseId) — sempre OPEN. */
export async function _salvarCompra(
  _prev: CompraFormState,
  formData: FormData,
): Promise<CompraFormState> {
  const perm = await withPermission("purchases.manage");
  if (!perm.ok) return { error: perm.error };

  const parsed = compraSchema.safeParse(parseJson(formData.get("payload")));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const d = parsed.data;

  try {
    if (d.purchaseId) {
      await withTenant(perm.tenantId, (tx) =>
        updatePurchase(
          tx,
          { tenantId: perm.tenantId, userId: perm.userId },
          d.purchaseId!,
          d,
        ),
      );
      revalidateCompras(d.purchaseId);
      return { ok: true, purchaseId: d.purchaseId, message: "Nota atualizada." };
    }
    const created = await withTenant(perm.tenantId, (tx) =>
      createPurchase(tx, { tenantId: perm.tenantId, userId: perm.userId }, d),
    );
    revalidateCompras(created.purchaseId);
    return { ok: true, purchaseId: created.purchaseId, message: "Nota criada." };
  } catch (err) {
    if (err instanceof PurchaseError) return { error: err.message };
    throw err;
  }
}

async function acao(
  permission: string,
  formData: FormData,
  fn: (
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    ctx: { tenantId: string; userId: string },
    purchaseId: string,
  ) => Promise<{ purchaseId: string }>,
  message: string,
): Promise<CompraFormState> {
  const perm = await withPermission(permission);
  if (!perm.ok) return { error: perm.error };

  const purchaseId = parseCompraId(formData);
  if (!purchaseId) return { error: "Compra inválida." };

  try {
    await withTenant(perm.tenantId, (tx) =>
      fn(tx, { tenantId: perm.tenantId, userId: perm.userId }, purchaseId),
    );
    revalidateCompras(purchaseId);
    return { ok: true, purchaseId, message };
  } catch (err) {
    if (err instanceof PurchaseError) return { error: err.message };
    throw err;
  }
}

export async function _confirmarCompra(
  _prev: CompraFormState,
  formData: FormData,
): Promise<CompraFormState> {
  return acao(
    "purchases.manage",
    formData,
    (tx, ctx, id) => confirmPurchase(tx, ctx, id),
    "Nota confirmada: estoque entrado e conta a pagar gerada.",
  );
}

export async function _cancelarCompra(
  _prev: CompraFormState,
  formData: FormData,
): Promise<CompraFormState> {
  return acao(
    "purchases.manage",
    formData,
    (tx, ctx, id) => cancelPurchase(tx, ctx, id),
    "Nota cancelada.",
  );
}

export async function _excluirCompra(
  _prev: CompraFormState,
  formData: FormData,
): Promise<CompraFormState> {
  return acao(
    "purchases.manage",
    formData,
    (tx, ctx, id) => deletePurchase(tx, ctx, id),
    "Nota excluída.",
  );
}
