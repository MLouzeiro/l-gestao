"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { inventories } from "@/server/db/schema";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { audit } from "@/server/audit/log";
import {
  applyInventory,
  createInventory,
  InventoryError,
  saveCounts,
  type CountEntry,
} from "@/server/modules/estoque/inventory.service";

// Inventário (Fase 9): abrir → contar → aplicar. Toda ação exige
// stock.inventory, roda dentro de withTenant() (RLS) e o saldo só muda
// via applyMovement() (dentro do serviço).

export type InventarioFormState =
  | { ok?: boolean; error?: string; message?: string }
  | null;

const abrirSchema = z.object({
  warehouseId: z.string().uuid("Selecione o depósito."),
  notes: z.string().trim().max(500).optional(),
});

const contagemSchema = z.object({
  inventoryId: z.string().uuid("Inventário inválido."),
});

/** Campos `count:<itemId>` do formulário → contagens validadas. */
function parseCounts(formData: FormData): CountEntry[] {
  const counts: CountEntry[] = [];
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("count:") || typeof raw !== "string") continue;
    const itemId = key.slice("count:".length);
    const value = raw.trim();
    if (value === "") {
      counts.push({ itemId, countedQty: null });
      continue;
    }
    const n = parseFloat(value.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      throw new InventoryError(
        `Contagem inválida para o item ${itemId}: use um valor maior ou igual a zero.`,
      );
    }
    counts.push({ itemId, countedQty: n });
  }
  return counts;
}

export async function _abrirInventario(
  _prev: InventarioFormState,
  formData: FormData,
): Promise<InventarioFormState> {
  const { tenantId, session } = await requirePermission("stock.inventory");

  const parsed = abrirSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  try {
    await withTenant(tenantId, session.user.id, (tx) =>
      createInventory(tx, {
        tenantId,
        warehouseId: parsed.data.warehouseId,
        userId: session.user.id,
        notes: parsed.data.notes ?? null,
      }),
    );
  } catch (err) {
    if (err instanceof InventoryError) return { error: err.message };
    return { error: "Falha ao abrir o inventário." };
  }

  revalidatePath("/estoque/inventario");
  return { ok: true, message: "Inventário aberto — conte os itens abaixo." };
}

export async function _salvarContagem(
  _prev: InventarioFormState,
  formData: FormData,
): Promise<InventarioFormState> {
  const { tenantId, session } = await requirePermission("stock.inventory");

  const parsed = contagemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Inventário inválido." };
  }

  let counts: CountEntry[];
  try {
    counts = parseCounts(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Contagem inválida." };
  }

  try {
    await withTenant(tenantId, session.user.id, (tx) =>
      saveCounts(tx, {
        tenantId,
        inventoryId: parsed.data.inventoryId,
        counts,
      }),
    );
  } catch (err) {
    if (err instanceof InventoryError) return { error: err.message };
    return { error: "Falha ao salvar a contagem." };
  }

  revalidatePath("/estoque/inventario");
  return { ok: true, message: "Contagem salva." };
}

/** Salva a contagem e aplica os ajustes na MESMA transação. */
export async function _aplicarContagem(
  _prev: InventarioFormState,
  formData: FormData,
): Promise<InventarioFormState> {
  const { tenantId, session } = await requirePermission("stock.inventory");

  const parsed = contagemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Inventário inválido." };
  }

  let counts: CountEntry[];
  try {
    counts = parseCounts(formData);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Contagem inválida." };
  }

  let applied = 0;
  try {
    await withTenant(tenantId, session.user.id, async (tx) => {
      await saveCounts(tx, {
        tenantId,
        inventoryId: parsed.data.inventoryId,
        counts,
      });
      const result = await applyInventory(tx, {
        tenantId,
        inventoryId: parsed.data.inventoryId,
        userId: session.user.id,
      });
      applied = result.applied;
    });
  } catch (err) {
    if (err instanceof InventoryError) return { error: err.message };
    return { error: "Falha ao aplicar o inventário." };
  }

  revalidatePath("/estoque/inventario");
  revalidatePath("/estoque");
  return {
    ok: true,
    message:
      applied === 0
        ? "Inventário aplicado: nenhuma diferença encontrada."
        : `Inventário aplicado: ${applied} ajuste(s) registrado(s).`,
  };
}

/** Descarta um inventário em aberto (nenhum movimento foi gravado). */
export async function _descartarInventario(
  _prev: InventarioFormState,
  formData: FormData,
): Promise<InventarioFormState> {
  const { tenantId, session } = await requirePermission("stock.inventory");

  const parsed = contagemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Inventário inválido." };
  }

  try {
    await withTenant(tenantId, session.user.id, async (tx) => {
      const removed = await tx
        .delete(inventories)
        .where(
          and(
            eq(inventories.tenantId, tenantId),
            eq(inventories.id, parsed.data.inventoryId),
            isNull(inventories.appliedAt),
          ),
        )
        .returning({ id: inventories.id });
      if (removed.length === 0) {
        throw new InventoryError(
          "Inventário não encontrado ou já aplicado.",
        );
      }
      await audit(tx, {
        action: "DESCARTE_INVENTARIO",
        module: "inventario",
        entityType: "inventory",
        entityId: parsed.data.inventoryId,
      });
    });
  } catch (err) {
    if (err instanceof InventoryError) return { error: err.message };
    return { error: "Falha ao descartar o inventário." };
  }

  revalidatePath("/estoque/inventario");
  return { ok: true, message: "Inventário descartado." };
}
