"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PermissionError, resolvePermissions } from "@/server/rbac/permissions";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import {
  SaleError,
  billSale,
  cancelSale,
  confirmSale,
  createSale,
  deleteSale,
  updateSale,
  type SaleContext,
} from "@/server/modules/vendas/sales.service";
import { formatSaleNumber } from "@/server/modules/vendas/sales-rules";

// Ações de vendas (Fase 10): requirePermission + Zod + withTenant().
// Retorno { ok, message } ou { error } — totais e desconto são recalculados
// no servidor (a action só transporta dados).

export type VendaFormState =
  | { ok?: boolean; error?: string; message?: string; saleId?: string }
  | null;

async function saleContext(permission: string): Promise<SaleContext> {
  const { session, tenantId, role } = await requirePermission(permission);
  return {
    tenantId,
    userId: session.user.id,
    role,
    salesDiscount: resolvePermissions(role).includes("sales.discount"),
  };
}

async function withPermission(
  permission: string,
): Promise<{ ok: true; ctx: SaleContext } | { ok: false; error: string }> {
  try {
    return { ok: true, ctx: await saleContext(permission) };
  } catch (err) {
    if (err instanceof PermissionError) return { ok: false, error: err.message };
    throw err;
  }
}

const itemSchema = z.object({
  productId: z.string().uuid("Produto inválido."),
  quantity: z.number().positive("Quantidade deve ser maior que zero."),
  unitPriceCents: z.number().int("Preço inválido.").min(0),
  discountCents: z.number().int("Desconto inválido.").min(0).optional(),
});

const vendaSchema = z.object({
  saleId: z.string().uuid().optional(),
  warehouseId: z.string().uuid("Selecione o depósito."),
  customerId: z.string().uuid().nullable().optional(),
  sellerId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).optional(),
  installments: z
    .number()
    .int("Parcelas inválidas.")
    .min(1, "Mínimo de 1 parcela.")
    .max(12, "Máximo de 12 parcelas.")
    .optional(),
  orderDiscountCents: z.number().int().min(0).optional(),
  items: z
    .array(itemSchema)
    .min(1, "Adicione ao menos um item.")
    .max(500, "Pedido com itens demais."),
});

const acaoSchema = z.object({ saleId: z.string().uuid("Venda inválida.") });

/** `saleId` do form (escondido) — ausente/inválido vira null, nunca vazia. */
function parseSaleId(formData: FormData): string | null {
  const raw = formData.get("saleId");
  const parsed = acaoSchema.safeParse({
    saleId: typeof raw === "string" && raw.length > 0 ? raw : "",
  });
  return parsed.success ? parsed.data.saleId : null;
}

function parseJson(raw: FormDataEntryValue | null): unknown {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function revalidateVendas(saleId?: string): void {
  revalidatePath("/vendas");
  if (saleId) revalidatePath(`/vendas/${saleId}`);
}

/** Cria (sem saleId) ou atualiza (com saleId) — sempre em DRAFT. */
export async function _salvarVenda(
  _prev: VendaFormState,
  formData: FormData,
): Promise<VendaFormState> {
  const perm = await withPermission("sales.manage");
  if (!perm.ok) return { error: perm.error };

  const parsed = vendaSchema.safeParse(parseJson(formData.get("payload")));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const d = parsed.data;
  const saleId = d.saleId;

  try {
    if (saleId) {
      await withTenant(perm.ctx.tenantId, (tx) =>
        updateSale(tx, perm.ctx, saleId, d),
      );
      revalidateVendas(saleId);
      return { ok: true, message: "Venda salva.", saleId };
    }

    const result = await withTenant(perm.ctx.tenantId, (tx) =>
      createSale(tx, perm.ctx, d),
    );
    revalidateVendas(result.saleId);
    return {
      ok: true,
      message: `Venda ${formatSaleNumber(result.number)} salva.`,
      saleId: result.saleId,
    };
  } catch (err) {
    if (err instanceof SaleError) return { error: err.message };
    console.error("Falha ao salvar venda:", err);
    return { error: "Falha ao salvar a venda. Tente novamente." };
  }
}

export async function _apagarVenda(
  _prev: VendaFormState,
  formData: FormData,
): Promise<VendaFormState> {
  const perm = await withPermission("sales.manage");
  if (!perm.ok) return { error: perm.error };

  const saleId = parseSaleId(formData);
  if (!saleId) return { error: "Venda inválida." };

  try {
    await withTenant(perm.ctx.tenantId, (tx) =>
      deleteSale(tx, perm.ctx, saleId),
    );
    revalidateVendas(saleId);
    return { ok: true, message: "Venda excluída." };
  } catch (err) {
    if (err instanceof SaleError) return { error: err.message };
    console.error("Falha ao apagar venda:", err);
    return { error: "Falha ao excluir a venda." };
  }
}

export async function _confirmarVenda(
  _prev: VendaFormState,
  formData: FormData,
): Promise<VendaFormState> {
  const perm = await withPermission("sales.manage");
  if (!perm.ok) return { error: perm.error };

  const saleId = parseSaleId(formData);
  if (!saleId) return { error: "Venda inválida." };

  try {
    await withTenant(perm.ctx.tenantId, (tx) =>
      confirmSale(tx, perm.ctx, saleId),
    );
    revalidateVendas(saleId);
    return { ok: true, message: "Venda confirmada — estoque reservado." };
  } catch (err) {
    if (err instanceof SaleError) return { error: err.message };
    console.error("Falha ao confirmar venda:", err);
    return { error: "Falha ao confirmar a venda." };
  }
}

export async function _cancelarVenda(
  _prev: VendaFormState,
  formData: FormData,
): Promise<VendaFormState> {
  const perm = await withPermission("sales.manage");
  if (!perm.ok) return { error: perm.error };

  const saleId = parseSaleId(formData);
  if (!saleId) return { error: "Venda inválida." };

  try {
    await withTenant(perm.ctx.tenantId, (tx) =>
      cancelSale(tx, perm.ctx, saleId),
    );
    revalidateVendas(saleId);
    return { ok: true, message: "Venda cancelada." };
  } catch (err) {
    if (err instanceof SaleError) return { error: err.message };
    console.error("Falha ao cancelar venda:", err);
    return { error: "Falha ao cancelar a venda." };
  }
}

export async function _faturarVenda(
  _prev: VendaFormState,
  formData: FormData,
): Promise<VendaFormState> {
  const perm = await withPermission("sales.billing");
  if (!perm.ok) return { error: perm.error };

  const saleId = parseSaleId(formData);
  if (!saleId) return { error: "Venda inválida." };

  try {
    await withTenant(perm.ctx.tenantId, (tx) =>
      billSale(tx, perm.ctx, saleId),
    );
    revalidateVendas(saleId);
    return {
      ok: true,
      message: "Venda faturada — estoque baixado.",
    };
  } catch (err) {
    if (err instanceof SaleError) return { error: err.message };
    console.error("Falha ao faturar venda:", err);
    return { error: "Falha ao faturar a venda." };
  }
}
