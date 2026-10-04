"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { tenantSettings } from "@/server/db/schema";
import { PermissionError } from "@/server/rbac/permissions";
import { requirePermission } from "@/server/rbac/require-permission";
import { withTenant } from "@/server/tenant/with-tenant";
import { audit } from "@/server/audit/log";

// Configuração da janela de alerta de validade (E5): dias antes do
// vencimento em que o lote aparece como CRITICO/PROXIMO em /lotes.

export type AlertaActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const diasSchema = z.object({
  dias: z
    .array(z.coerce.number().int().min(1, "Use dias positivos.").max(3650))
    .max(6, "Máximo de 6 janelas de alerta.")
    .transform((arr) => [...new Set(arr)].sort((a, b) => a - b)),
});

export async function _salvarAlertaValidade(
  raw: unknown,
): Promise<AlertaActionResult<{ dias: number[] }>> {
  try {
    const { session, tenantId } = await requirePermission("settings.manage");
    const parsed = diasSchema.safeParse(raw);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const i of parsed.error.issues) {
        const key = i.path.join(".") || "_";
        (fieldErrors[key] ??= []).push(i.message);
      }
      return {
        ok: false,
        error: "Verifique os campos destacados.",
        fieldErrors,
      };
    }

    await withTenant(tenantId, session.user.id, async (tx) => {
      const [existing] = await tx
        .select({ dias: tenantSettings.diasAlertaValidade })
        .from(tenantSettings)
        .where(eq(tenantSettings.tenantId, tenantId))
        .limit(1);

      await tx
        .insert(tenantSettings)
        .values({ tenantId, diasAlertaValidade: parsed.data.dias })
        .onConflictDoUpdate({
          target: tenantSettings.tenantId,
          set: { diasAlertaValidade: parsed.data.dias },
        });

      await audit(tx, {
        action: "ALTERACAO_CONFIGURACAO",
        module: "lotes",
        entityType: "tenant_settings",
        entityId: tenantId,
        before: { diasAlertaValidade: existing?.dias ?? [] },
        after: { diasAlertaValidade: parsed.data.dias },
        userId: session.user.id,
      });
    });

    revalidatePath("/lotes");
    return { ok: true, data: { dias: parsed.data.dias } };
  } catch (err) {
    if (err instanceof PermissionError) {
      return { ok: false, error: err.message };
    }
    console.error("Falha ao salvar alerta de validade:", err);
    return {
      ok: false,
      error: "Falha ao salvar a configuração. Tente novamente.",
    };
  }
}
