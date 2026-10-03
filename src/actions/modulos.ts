"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PermissionError } from "@/server/rbac/permissions";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import {
  ModuleError,
  setTenantModule,
} from "@/server/modules/tenancy/module.service";

// Gestão de módulos contratados (PROMPT MESTRE §35) — ADMIN via
// Administração → Módulos. Toda mutação audita dentro da transação.

export type ModuloActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const alternarSchema = z.object({
  key: z.string().min(1, "Módulo inválido.").max(40),
  active: z.boolean(),
});

export async function _alternarModulo(
  raw: unknown,
): Promise<ModuloActionResult<{ key: string; active: boolean }>> {
  try {
    const { session, tenantId } = await requirePermission("settings.manage");
    const parsed = alternarSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      };
    }

    await withTenant(tenantId, session.user.id, (tx) =>
      setTenantModule(
        tx,
        { tenantId, userId: session.user.id },
        parsed.data.key,
        parsed.data.active,
      ),
    );
    revalidatePath("/admin/modulos");
    return { ok: true, data: parsed.data };
  } catch (err) {
    if (err instanceof ModuleError || err instanceof PermissionError) {
      return { ok: false, error: err.message };
    }
    console.error("Falha ao alterar módulo:", err);
    return { ok: false, error: "Falha ao alterar o módulo. Tente novamente." };
  }
}
