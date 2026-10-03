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
  createUnit,
  deleteUnit,
  deleteUnitTarget,
  setUnitMembers,
  UnitError,
  updateUnit,
  upsertUnitTarget,
} from "@/server/modules/unidades/warehouse.service";

// Gestão de unidades (E3) — hierarquia MATRIZ/FILIAL/POSTO, acesso por
// usuário e estoque-alvo. Toda mutação audita dentro da transação.

export type UnidadeActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const unitType = z.enum(["MATRIZ", "FILIAL", "POSTO"], {
  message: "Tipo de unidade inválido.",
});

const unidadeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Informe o código.")
    .max(30, "Código muito longo."),
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome.")
    .max(120, "Nome muito longo."),
  type: unitType,
  parentId: z.string().uuid("Unidade pai inválida.").nullable(),
  managerUserId: z.string().uuid("Responsável inválido.").nullable(),
});

const membrosSchema = z.object({
  unitId: z.string().uuid("Unidade inválida."),
  userIds: z.array(z.string().uuid("Usuário inválido.")).max(200),
});

const alvoSchema = z.object({
  unitId: z.string().uuid("Unidade inválida."),
  productId: z.string().uuid("Produto inválido."),
  minQty: z.coerce.number().nullable(),
  maxQty: z.coerce.number().nullable(),
  reorderPoint: z.coerce.number().nullable(),
});

const alvoRemoveSchema = z.object({
  unitId: z.string().uuid("Unidade inválida."),
  productId: z.string().uuid("Produto inválido."),
});

const unitIdSchema = z.string().uuid("Unidade inválida.");

function fieldErrors(
  issues: z.ZodIssue[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const i of issues) {
    const key = i.path.join(".") || "_";
    (out[key] ??= []).push(i.message);
  }
  return out;
}

function toFormState<T>(
  issues: z.ZodIssue[],
): UnidadeActionResult<T> {
  return {
    ok: false,
    error: "Verifique os campos destacados.",
    fieldErrors: fieldErrors(issues),
  };
}

export async function _criarUnidade(
  raw: unknown,
): Promise<UnidadeActionResult<{ id: string }>> {
  try {
    const { session, tenantId } = await requirePermission("units.manage");
    const parsed = unidadeSchema.safeParse(raw);
    if (!parsed.success) return toFormState(parsed.error.issues);

    const data = await withTenant(tenantId, session.user.id, async (tx) => {
      await requireModule(tx, tenantId, "MATRIZ_POSTOS");
      return createUnit(tx, {
        tenantId,
        userId: session.user.id,
        ...parsed.data,
      });
    });
    revalidatePath("/unidades");
    return { ok: true, data };
  } catch (err) {
    return handleError(err, "Falha ao criar a unidade.");
  }
}

export async function _atualizarUnidade(
  unitId: string,
  raw: unknown,
): Promise<UnidadeActionResult<{ id: string }>> {
  try {
    const { session, tenantId } = await requirePermission("units.manage");
    const id = unitIdSchema.safeParse(unitId);
    if (!id.success) return { ok: false, error: "Unidade inválida." };
    const parsed = unidadeSchema.safeParse(raw);
    if (!parsed.success) return toFormState(parsed.error.issues);

    const data = await withTenant(tenantId, session.user.id, async (tx) => {
      await requireModule(tx, tenantId, "MATRIZ_POSTOS");
      return updateUnit(tx, {
        tenantId,
        userId: session.user.id,
        unitId: id.data,
        ...parsed.data,
      });
    });
    revalidatePath("/unidades");
    revalidatePath(`/unidades/${id.data}`);
    return { ok: true, data };
  } catch (err) {
    return handleError(err, "Falha ao salvar a unidade.");
  }
}

export async function _apagarUnidade(
  unitId: string,
): Promise<UnidadeActionResult<{ id: string }>> {
  try {
    const { session, tenantId } = await requirePermission("units.manage");
    const id = unitIdSchema.safeParse(unitId);
    if (!id.success) return { ok: false, error: "Unidade inválida." };

    await withTenant(tenantId, session.user.id, async (tx) => {
      await requireModule(tx, tenantId, "MATRIZ_POSTOS");
      await deleteUnit(tx, {
        tenantId,
        userId: session.user.id,
        unitId: id.data,
      });
    });
    revalidatePath("/unidades");
    return { ok: true, data: { id: id.data } };
  } catch (err) {
    return handleError(err, "Falha ao remover a unidade.");
  }
}

export async function _salvarMembros(
  raw: unknown,
): Promise<UnidadeActionResult<{ unitId: string; total: number }>> {
  try {
    const { session, tenantId } = await requirePermission("units.manage");
    const parsed = membrosSchema.safeParse(raw);
    if (!parsed.success) return toFormState(parsed.error.issues);

    await withTenant(tenantId, session.user.id, async (tx) => {
      await requireModule(tx, tenantId, "MATRIZ_POSTOS");
      await setUnitMembers(tx, {
        tenantId,
        userId: session.user.id,
        unitId: parsed.data.unitId,
        userIds: parsed.data.userIds,
      });
    });
    revalidatePath(`/unidades/${parsed.data.unitId}`);
    return {
      ok: true,
      data: { unitId: parsed.data.unitId, total: parsed.data.userIds.length },
    };
  } catch (err) {
    return handleError(err, "Falha ao salvar o acesso.");
  }
}

export async function _salvarAlvo(
  raw: unknown,
): Promise<UnidadeActionResult<{ unitId: string; productId: string }>> {
  try {
    const { session, tenantId } = await requirePermission("units.manage");
    const parsed = alvoSchema.safeParse(raw);
    if (!parsed.success) return toFormState(parsed.error.issues);

    await withTenant(tenantId, session.user.id, async (tx) => {
      await requireModule(tx, tenantId, "MATRIZ_POSTOS");
      await upsertUnitTarget(tx, {
        tenantId,
        userId: session.user.id,
        ...parsed.data,
      });
    });
    revalidatePath(`/unidades/${parsed.data.unitId}`);
    return {
      ok: true,
      data: { unitId: parsed.data.unitId, productId: parsed.data.productId },
    };
  } catch (err) {
    return handleError(err, "Falha ao salvar o estoque-alvo.");
  }
}

export async function _apagarAlvo(
  raw: unknown,
): Promise<UnidadeActionResult<{ unitId: string; productId: string }>> {
  try {
    const { session, tenantId } = await requirePermission("units.manage");
    const parsed = alvoRemoveSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: "Dados inválidos." };
    }

    await withTenant(tenantId, session.user.id, async (tx) => {
      await requireModule(tx, tenantId, "MATRIZ_POSTOS");
      await deleteUnitTarget(tx, {
        tenantId,
        userId: session.user.id,
        ...parsed.data,
      });
    });
    revalidatePath(`/unidades/${parsed.data.unitId}`);
    return { ok: true, data: parsed.data };
  } catch (err) {
    return handleError(err, "Falha ao remover o estoque-alvo.");
  }
}

function handleError(err: unknown, fallback: string): UnidadeActionResult<never> {
  if (
    err instanceof UnitError ||
    err instanceof ModuleError ||
    err instanceof PermissionError
  ) {
    return { ok: false, error: err.message };
  }
  console.error("Falha na ação de unidade:", err);
  return { ok: false, error: `${fallback} Tente novamente.` };
}
