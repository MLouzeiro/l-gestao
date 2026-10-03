"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PermissionError, resolvePermissions } from "@/server/rbac/permissions";
import { requirePermission } from "@/server/rbac/require-permission";
import { ModuleError } from "@/server/modules/tenancy/module.service";
import { withTenant } from "@/server/tenant/with-tenant";
import {
  addSangria,
  addSupply,
  closeCash,
  openCash,
  type CloseCashInput,
} from "@/server/modules/pdv/cash.service";
import {
  PdvError,
  checkoutPdv,
  type PdvCheckoutResult,
} from "@/server/modules/pdv/pdv.service";

// Ações do PDV (balcão): checkout em uma transação + caixa.
// Toda entrada validada com Zod AQUI (nunca confiar no cliente).

export type PdvActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const paymentMethod = z.enum([
  "DINHEIRO",
  "PIX",
  "DEBITO",
  "CREDITO",
  "VALE",
  "OUTRO",
]);

const checkoutSchema = z.object({
  warehouseId: z.string().uuid("Depósito inválido."),
  customerId: z.string().uuid().nullable().optional(),
  paymentMethod,
  installments: z.number().int().min(1).max(12).optional(),
  receivedCents: z.number().int().min(0).nullable().optional(),
  orderDiscountCents: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid("Produto inválido."),
        quantity: z.number().positive("Quantidade deve ser maior que zero."),
        unitPriceCents: z.number().int().min(0),
        discountCents: z.number().int().min(0).optional(),
      }),
    )
    .min(1, "Carrinho vazio.")
    .max(200, "Venda com itens demais."),
});

const openCashSchema = z.object({
  openingAmountCents: z.number().int().min(0),
  notes: z.string().max(500).optional(),
});

const closeCashSchema = z.object({
  countedCashCents: z.number().int().min(0),
  countedCardCents: z.number().int().min(0),
  countedPixCents: z.number().int().min(0),
  countedOtherCents: z.number().int().min(0),
  notes: z.string().max(500).optional(),
});

const movementSchema = z.object({
  amountCents: z.number().int().positive("Valor deve ser maior que zero."),
  description: z.string().max(500).optional(),
});

function fail<T>(error: string): PdvActionResult<T> {
  return { ok: false, error };
}

function unexpected<T>(err: unknown, what: string): PdvActionResult<T> {
  if (
    err instanceof PdvError ||
    err instanceof PermissionError ||
    err instanceof ModuleError
  ) {
    return { ok: false, error: err.message };
  }
  console.error(`Falha ao ${what}:`, err);
  return { ok: false, error: `Falha ao ${what}. Tente novamente.` };
}

async function sessionCtx(permission: string) {
  const { session, tenantId, role } = await requirePermission(permission);
  return { tenantId, userId: session.user.id, role };
}

export async function _checkoutPdv(
  raw: unknown,
): Promise<PdvActionResult<PdvCheckoutResult>> {
  let ctx: { tenantId: string; userId: string; role: string };
  try {
    ctx = await sessionCtx("sales.manage");
  } catch (err) {
    return unexpected(err, "realizar a venda");
  }

  const parsed = checkoutSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  try {
    const data = await withTenant(ctx.tenantId, ctx.userId, (tx) =>
      checkoutPdv(
        tx,
        {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          role: ctx.role,
          salesDiscount: resolvePermissions(ctx.role).includes("sales.discount"),
        },
        parsed.data,
      ),
    );
    revalidatePath("/pdv");
    return { ok: true, data };
  } catch (err) {
    return unexpected(err, "realizar a venda");
  }
}

export async function _abrirCaixa(
  raw: unknown,
): Promise<PdvActionResult<{ cashRegisterId: string; number: number }>> {
  let ctx: { tenantId: string; userId: string; role: string };
  try {
    ctx = await sessionCtx("sales.manage");
  } catch (err) {
    return unexpected(err, "abrir o caixa");
  }

  const parsed = openCashSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  try {
    const data = await withTenant(ctx.tenantId, ctx.userId, (tx) =>
      openCash(tx, ctx, parsed.data),
    );
    revalidatePath("/pdv");
    return { ok: true, data };
  } catch (err) {
    return unexpected(err, "abrir o caixa");
  }
}

export async function _fecharCaixa(
  raw: unknown,
): Promise<PdvActionResult<{ cashRegisterId: string; differenceCents: number }>> {
  let ctx: { tenantId: string; userId: string; role: string };
  try {
    ctx = await sessionCtx("sales.manage");
  } catch (err) {
    return unexpected(err, "fechar o caixa");
  }

  const parsed = closeCashSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  try {
    const data = await withTenant(ctx.tenantId, ctx.userId, (tx) =>
      closeCash(tx, ctx, parsed.data as CloseCashInput),
    );
    revalidatePath("/pdv");
    return { ok: true, data };
  } catch (err) {
    return unexpected(err, "fechar o caixa");
  }
}

export async function _suprimento(
  raw: unknown,
): Promise<PdvActionResult<{ cashMovementId: string }>> {
  let ctx: { tenantId: string; userId: string; role: string };
  try {
    ctx = await sessionCtx("finance.manage");
  } catch (err) {
    return unexpected(err, "lançar o suprimento");
  }

  const parsed = movementSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  try {
    const data = await withTenant(ctx.tenantId, ctx.userId, (tx) =>
      addSupply(tx, ctx, parsed.data),
    );
    revalidatePath("/pdv");
    return { ok: true, data };
  } catch (err) {
    return unexpected(err, "lançar o suprimento");
  }
}

export async function _sangria(
  raw: unknown,
): Promise<PdvActionResult<{ cashMovementId: string }>> {
  let ctx: { tenantId: string; userId: string; role: string };
  try {
    ctx = await sessionCtx("finance.manage");
  } catch (err) {
    return unexpected(err, "lançar a sangria");
  }

  const parsed = movementSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  try {
    const data = await withTenant(ctx.tenantId, ctx.userId, (tx) =>
      addSangria(tx, ctx, parsed.data),
    );
    revalidatePath("/pdv");
    return { ok: true, data };
  } catch (err) {
    return unexpected(err, "lançar a sangria");
  }
}
