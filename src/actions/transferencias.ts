"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PermissionError } from "@/server/rbac/permissions";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import {
  ModuleError,
  requireModule,
} from "@/server/modules/tenancy/module.service";
import {
  cancelTransfer,
  createTransfer,
  MovementError,
  receiveTransfer,
  sendTransfer,
  TransferError,
} from "@/server/modules/transferencias/transfer.service";
import { UnitError } from "@/server/modules/unidades/warehouse.service";

// Transferências entre unidades (E4+E6). Toda mutação audita dentro da
// transação e exige o módulo TRANSFERENCIAS contratado.

export type TransferenciaActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const itemSchema = z.object({
  productId: z.string().uuid("Produto inválido."),
  batchNumber: z.string().trim().max(64).nullable().optional(),
  quantity: z.coerce
    .number()
    .positive("A quantidade deve ser maior que zero."),
});

const criarSchema = z.object({
  fromWarehouseId: z.string().uuid("Unidade de origem inválida."),
  toWarehouseId: z.string().uuid("Unidade de destino inválida."),
  settleOn: z.enum(["SEND", "RECEIVE"], {
    message: "Modo de baixa inválido.",
  }),
  notes: z.string().trim().max(500).nullable().optional(),
  immediate: z.boolean().optional(),
  items: z
    .array(itemSchema)
    .min(1, "Adicione ao menos um item.")
    .max(200, "Máximo de 200 itens."),
});

const idSchema = z.string().uuid("Transferência inválida.");

function toFormState<T>(issues: z.ZodIssue[]): TransferenciaActionResult<T> {
  const fieldErrors: Record<string, string[]> = {};
  for (const i of issues) {
    const key = i.path.join(".") || "_";
    (fieldErrors[key] ??= []).push(i.message);
  }
  return {
    ok: false,
    error: "Verifique os campos destacados.",
    fieldErrors,
  };
}

function handleError(
  err: unknown,
  fallback: string,
): TransferenciaActionResult<never> {
  if (
    err instanceof TransferError ||
    err instanceof MovementError ||
    err instanceof UnitError ||
    err instanceof ModuleError ||
    err instanceof PermissionError
  ) {
    return { ok: false, error: err.message };
  }
  console.error("Falha na ação de transferência:", err);
  return { ok: false, error: `${fallback} Tente novamente.` };
}

export async function _criarTransferencia(
  raw: unknown,
): Promise<
  TransferenciaActionResult<{ id: string; transferNumber: string }>
> {
  try {
    const { session, tenantId, role } = await requirePermission(
      "stock.transfer",
    );
    const parsed = criarSchema.safeParse(raw);
    if (!parsed.success) return toFormState(parsed.error.issues);

    const data = await withTenant(tenantId, session.user.id, async (tx) => {
      await requireModule(tx, tenantId, "TRANSFERENCIAS");
      return createTransfer(
        tx,
        { tenantId, userId: session.user.id, role },
        {
          fromWarehouseId: parsed.data.fromWarehouseId,
          toWarehouseId: parsed.data.toWarehouseId,
          settleOn: parsed.data.settleOn,
          notes: parsed.data.notes ?? null,
          immediate: parsed.data.immediate ?? false,
          items: parsed.data.items.map((i) => ({
            productId: i.productId,
            batchNumber: i.batchNumber ?? null,
            quantity: i.quantity,
          })),
        },
      );
    });
    revalidatePath("/transferencias");
    return {
      ok: true,
      data: { id: data.id, transferNumber: data.transferNumber },
    };
  } catch (err) {
    return handleError(err, "Falha ao criar a transferência.");
  }
}

export async function _enviarTransferencia(
  transferId: string,
): Promise<TransferenciaActionResult<{ id: string }>> {
  try {
    const { session, tenantId, role } = await requirePermission(
      "stock.transfer",
    );
    const id = idSchema.safeParse(transferId);
    if (!id.success) return { ok: false, error: "Transferência inválida." };

    await withTenant(tenantId, session.user.id, async (tx) => {
      await requireModule(tx, tenantId, "TRANSFERENCIAS");
      await sendTransfer(
        tx,
        { tenantId, userId: session.user.id, role },
        id.data,
      );
    });
    revalidatePath("/transferencias");
    revalidatePath(`/transferencias/${id.data}`);
    return { ok: true, data: { id: id.data } };
  } catch (err) {
    return handleError(err, "Falha ao enviar a transferência.");
  }
}

export async function _receberTransferencia(
  transferId: string,
): Promise<TransferenciaActionResult<{ id: string }>> {
  try {
    const { session, tenantId, role } = await requirePermission(
      "stock.transfer",
    );
    const id = idSchema.safeParse(transferId);
    if (!id.success) return { ok: false, error: "Transferência inválida." };

    await withTenant(tenantId, session.user.id, async (tx) => {
      await requireModule(tx, tenantId, "TRANSFERENCIAS");
      await receiveTransfer(
        tx,
        { tenantId, userId: session.user.id, role },
        id.data,
      );
    });
    revalidatePath("/transferencias");
    revalidatePath(`/transferencias/${id.data}`);
    return { ok: true, data: { id: id.data } };
  } catch (err) {
    return handleError(err, "Falha ao receber a transferência.");
  }
}

export async function _cancelarTransferencia(
  transferId: string,
): Promise<TransferenciaActionResult<{ id: string }>> {
  try {
    const { session, tenantId, role } = await requirePermission(
      "stock.transfer",
    );
    const id = idSchema.safeParse(transferId);
    if (!id.success) return { ok: false, error: "Transferência inválida." };

    await withTenant(tenantId, session.user.id, async (tx) => {
      await requireModule(tx, tenantId, "TRANSFERENCIAS");
      await cancelTransfer(
        tx,
        { tenantId, userId: session.user.id, role },
        id.data,
      );
    });
    revalidatePath("/transferencias");
    revalidatePath(`/transferencias/${id.data}`);
    return { ok: true, data: { id: id.data } };
  } catch (err) {
    return handleError(err, "Falha ao cancelar a transferência.");
  }
}
